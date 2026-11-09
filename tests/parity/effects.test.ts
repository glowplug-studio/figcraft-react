import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { effectTypes } from "../../src/engine/effects";

const black = { r: 0, g: 0, b: 0, a: .25 }, white = { r: 1, g: 1, b: 1, a: .25 };
const shadow = {color: black, offset: [0,4], radius: 4, spread: 0, blend: "normal", showBehind: false};
const blur = {radius: 4, blurType: "uniform", startRadius: 0, start: [.5,0], end: [.5,1]};
const defaults = [shadow, shadow, blur, blur,
  {mode: "mono", size: .5, density: .5, color: black, secondary: white, opacity: .25, blend: "normal"},
  {size: .5, radius: 4, clipToShape: false},
  {lightAngle: -45, lightIntensity: .8, refraction: .8, depth: 20, dispersion: .5, frost: 4, splay: 0}];

describe("native effect records and stacks", () => {
  it.each(effectTypes)("creates %s with the native defaults and protects retained values", type => {
    const e = new EditorEngine(), {id} = e.execute("shape.rectangle", {props: {effects: [{type}]}});
    const effects = e.getSnapshot().document.nodes[String(id)].effects!;
    expect(e.execute("node.get", {id, fields: ["effects"]})?.effects).toEqual([{type, visible: true, ...defaults[effectTypes.indexOf(type)]}]);
    expect(Object.isFrozen(effects)).toBe(true);
    for (const value of [effects[0], ...Object.values(effects[0]).filter(v => typeof v === "object")]) expect(Object.isFrozen(value)).toBe(true);
  });

  it("writes native field names, reads aliases and retains raw lengths, relative handles and u64 IDs", async () => {
    const e = new EditorEngine(), {id} = e.execute("shape.rectangle");
    const file = JSON.parse(strFromU8(unzipSync(await encodeFigcraft(e.getSnapshot().document))["document.json"]));
    file.nodes[String(id)].effects = [
      {type:"innerShadow",color:"#f00",showBehind:true,offset:[-2,3],blend:"multiply"},
      {type:"backgroundBlur",blurType:"PROGRESSIVE",startRadius:7,startOffset:[2,-4],endOffset:[3,8]},
      {type:"noise",sizeY:null,opacity:.1,secondary:[1,0,0],unknownFutureField:20},
      {type:"texture",sizeY:8,clipToShape:true}, {type:"glass",visible:false,lightIntensity:2,frost:150},
    ];
    file.nodes["1"].effects = [{type:"layerBlur"}];
    file.next_id = "MAX_ID";
    const decoded = await decodeFigcraft(strToU8(JSON.stringify(file).replace('"MAX_ID"','18446744073709551615')));
    const archive = await encodeFigcraft(decoded.document, decoded.nextId);
    const raw = strFromU8(unzipSync(archive)["document.json"]);
    expect(raw).toContain('"next_id":18446744073709551615');
    const wire = JSON.parse(raw).nodes[String(id)].effects;
    expect(wire[0]).toMatchObject({show_behind:true,color:{r:1,g:0,b:0,a:1}});
    expect(wire[1]).toMatchObject({blur_type:"progressive",start_radius:7,start:[2,-4],end:[3,8]});
    expect(wire[2]).not.toHaveProperty("size_y");
    expect(wire[2].opacity).toBe(Math.fround(.1));
    expect(wire[3]).toMatchObject({size_y:8,clip_to_shape:true});
    expect(wire[4]).toMatchObject({light_intensity:2,frost:150,visible:false});
    expect(await decodeFigcraft(archive)).toEqual(decoded);
    for (const invalid of [null,{},[{type:"invalid"}],[{type:"glass",frost:null}],[{type:"texture",sizeY:2,size_y:3}]]) {
      file.nodes[String(id)].effects = invalid;
      file.next_id = 3;
      await expect(decodeFigcraft(strToU8(JSON.stringify(file)))).rejects.toThrow(/effect/i);
    }
  });

  it("validates all properties before publishing changes to a selection", () => {
    const e = new EditorEngine(), ids = [e.execute("shape.rectangle").id, e.execute("shape.ellipse").id];
    const before = e.getSnapshot().document;
    for (const record of [{type:"dropShadow",offsetY:2},{type:"dropShadow",offset:[1]},{type:"innerShadow",color:[]},
      {type:"noise",mode:"DUO"},{type:"texture",size:"2"},{type:"glass",visible:null},{type:"layerBlur",startOffset:[0,0]},
      {type:"layerBlur",blurType:"Normal"},{type:"glass",...Object.fromEntries(Array.from({length:32},(_,i)=>["unused"+i,null]))}]) {
      expect(() => e.execute("node.set",{ids,props:{name:"wrong",effects:[{type:"glass"},record]}})).toThrow();
      expect(e.getSnapshot().document).toBe(before);
    }
    e.execute("node.set",{ids,props:{effects:[{type:"layerBlur",blurType:"NORMAL",unknown:null}]}});
    const doc = e.getSnapshot().document;
    e.execute("node.set",{ids,props:{effects:[{type:"layerBlur"}]}});
    expect(e.getSnapshot().document).toBe(doc);
    e.execute("node.set",{ids,props:{effects:[]}});
    for (const id of ids) expect(e.execute("node.get",{id,fields:["effects"]})).not.toHaveProperty("effects");
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(doc);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
  });

  it("copies the first target's top effect, reorders bottom first and pastes atomically", () => {
    const e = new EditorEngine(), a = e.execute("shape.rectangle").id, b = e.execute("shape.rectangle").id;
    const stack = (id: unknown) => e.getSnapshot().document.nodes[String(id)].effects?.map(effect => effect.type) ?? [];
    expect(() => e.execute("effect.paste",{id:a})).toThrow(/copied/i);
    e.execute("effect.add",{ids:[a,b],effect:null});
    e.execute("effect.add",{id:a,type:"INNER_SHADOW"});
    e.execute("effect.add",{id:a,type:"blur"});
    e.execute("effect.set",{id:a,index:"2",effect:{type:"layerBlur",startOffset:[.2,.8],startRadius:7}});
    expect(e.execute("effect.copy",{ids:["invalid",a,b]})).toMatchObject({type:"layerBlur",start:[.2,.8],start_radius:7});
    e.execute("effect.paste",{id:b,index:0});
    e.execute("effect.move",{ids:[a,b],from:2,to:0});
    expect(stack(a)).toEqual(["layerBlur","dropShadow","innerShadow"]);
    expect(stack(b)).toEqual(["layerBlur"]);
    e.execute("effect.remove",{ids:[a,b],index:1});
    expect(stack(a)).toEqual(["layerBlur","innerShadow"]);
    const before = e.getSnapshot().document;
    for (const command of ["effect.add","effect.remove","effect.set","effect.paste"]) {
      expect(() => e.execute(command,{ids:[a,999],index:0,effect:{type:"glass"}})).toThrow();
      expect(e.getSnapshot().document).toBe(before);
    }
    e.execute("effect.paste",{ids:[a,b]}); e.execute("edit.undo");
    expect(e.getSnapshot().document).toBe(before);
    e.setEditable(false); e.setEditable(true);
    expect(() => e.execute("effect.paste",{id:a})).toThrow(/copied/i);
  });

  it("scales native lengths throughout the subtree and clamps legacy glass frost before scaling", () => {
    const e = new EditorEngine(), parent = e.execute("node.create",{type:"frame"}).id;
    const {id} = e.execute("shape.rectangle",{parent,props:{effects:[
      {type:"dropShadow",offset:[4,-6],spread:-4},{type:"innerShadow",visible:false},
      {type:"layerBlur",startRadius:2,start:[.2,.5]},{type:"backgroundBlur"},
      {type:"noise",sizeY:6},{type:"texture",size:8},{type:"glass",frost:150}]}});
    e.execute("transform.scale",{id:parent,factor:.5});
    expect(e.getSnapshot().document.nodes[String(id)].effects).toMatchObject([
      {offset:[2,-3],spread:-2,radius:2},{visible:false,offset:[0,2]}, {startRadius:1,start:[.2,.5]}, {radius:2},
      {size:.25,sizeY:3},{size:4,radius:2},{depth:10,frost:50},
    ]);
  });
});
