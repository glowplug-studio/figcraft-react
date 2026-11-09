let generation=0;
const listeners=new Set<(loaded:boolean)=>void>();
export const fontGeneration=()=>generation;
export function subscribeFonts(listener:(loaded:boolean)=>void) {
  listeners.add(listener);
  return ()=>{listeners.delete(listener);};
}
export function fontsChanged(loaded=false) {
  generation++;
  for (const listener of listeners) listener(loaded);
}

/** Keep immutable layer caches valid when externally supplied fonts change their geometry. */
export function fontGeometryCache<K extends object,V>() {
  let values=new WeakMap<K,V>();
  subscribeFonts(()=>{values=new WeakMap();});
  return {
    get:(key:K)=>values.get(key),
    set:(key:K,value:V)=>{values.set(key,value);},
    delete:(key:K)=>values.delete(key),
  };
}
