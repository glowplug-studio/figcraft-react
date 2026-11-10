import type {LayerNode} from "../../document";
import type {PrototypeAction,PrototypeInteraction} from "../../prototype-data";
import {object} from "../rest/values";
import {interactionFingerprint} from "./prototype";
import {rounded,sourceValue,type Fields,type Warn} from "./write-geometry";
import type {PenpotExportIds} from "./write-pages";

const events:Readonly<Record<string,string>>={onClick:"click",mouseUp:"click",onPress:"mouse-press",mouseDown:"mouse-press",onHover:"mouse-over",
  mouseEnter:"mouse-enter",mouseLeave:"mouse-leave",afterDelay:"after-delay"};
const easingNames:Readonly<Record<string,string>>={linear:"linear",easeIn:"ease-in",easeOut:"ease-out",easeInOut:"ease-in-out"};

export class PenpotPrototypeWriter {
  private exported:Set<string>;
  constructor(private ids:PenpotExportIds,private warn:Warn) {
    this.exported=new Set(ids.layers.values());
  }
  fields(n:LayerNode,shape:Fields) {
    const list=n.interactions ?? [],hash=n.sourceMetadata?.["penpot.fp.interactions"];
    if (hash && hash===interactionFingerprint(list)) {
      const source=sourceValue(n,"interactions");
      const resolves=!Array.isArray(source) || source.every(i=>["destination","positionRelativeTo"].every(k=>{
        const target=object(i)[k];
        return typeof target!=="string" || this.exported.has(target);
      }));
      if (resolves && source!==undefined) {shape.interactions=source;return;}
    }
    if (!list.length) return;
    const out:Fields[]=[];
    for (const i of list) for (const a of i.actions) {
      const action=this.action(n,i,a);
      if (action) out.push(action);
    }
    shape.interactions=out;
  }
  private action(n:LayerNode,i:PrototypeInteraction,a:PrototypeAction) {
    const event=events[i.trigger.type];
    if (!event) {this.warn("Prototype trigger on '"+n.name+"' has no Penpot equivalent and was left out");return;}
    const out:Fields={eventType:event};
    if (i.trigger.type==="afterDelay") out.delay=i.trigger.ms;
    switch(a.type) {
      case "navigate": case "openOverlay": {
        if (a.type==="openOverlay" && a.anchor) this.warn("Overlay anchor on '"+n.name+"' was approximated relative to the screen");
        const dest=this.ids.layers.get(a.dest);
        if (!dest) {this.warn("A prototype link on '"+n.name+"' points at a layer that is not exported; it was left out");return;}
        out.destination=dest;
        if (a.type==="navigate") Object.assign(out,{actionType:"navigate",preserveScroll:a.preserve_scroll ?? false});
        else {
          const [x,y]=a.offset ?? [0,0];
          Object.assign(out,{actionType:"open-overlay",overlayPosType:a.position.replace(/[A-Z]/g,c=>"-"+c.toLowerCase()),
            overlayPosition:{x:rounded(x),y:rounded(y)},closeClickOutside:a.close_on_outside,backgroundOverlay:a.background!==null});
          if (a.position==="manual") out.positionRelativeTo=this.ids.layers.get(n.id);
        }
        break;
      }
      case "closeOverlay": out.actionType="close-overlay";break;
      case "back": return {...out,actionType:"prev-screen"};
      case "openUrl": return {...out,actionType:"open-url",url:a.url};
      default: this.warn("A prototype action on '"+n.name+"' has no Penpot equivalent and was left out");return;
    }
    const t=i.transition,overlay=a.type==="openOverlay";
    if (t.type!=="instant") {
      const animation:Fields={duration:i.duration_ms,easing:typeof i.easing==="string" ? easingNames[i.easing] ?? "ease" : "ease"};
      if ("direction" in t) {
        animation.direction=t.direction==="top" ? "up" : t.direction==="bottom" ? "down" : t.direction;
        if (t.type==="push" && !overlay) animation.animationType="push";
        else Object.assign(animation,{animationType:"slide",way:!overlay && (t.type==="moveOut" || t.type==="slideOut") ? "out" : "in",offsetEffect:false});
      } else {
        if (t.type==="smartAnimate") this.warn("Smart animate has no Penpot equivalent; exported as dissolve");
        animation.animationType="dissolve";
      }
      out.animation=animation;
    }
    return out;
  }
}
