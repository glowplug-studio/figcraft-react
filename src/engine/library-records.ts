import type {ImportedRecord,PublishedLibrary} from "./published-library";

function localKey(lib:string,key:string,taken:Set<string>) {
  const base=lib+":"+key;
  let name=base;
  for (let n=2;taken.has(name) && n<10000;n++) name=base+"#"+n;
  return taken.has(name) ? base : name;
}

export function planLibraryRecords<T extends {id:string}>(lib:PublishedLibrary,list:readonly T[],rows:readonly ImportedRecord[],assets:readonly {id:string;version:string}[],wanted:readonly string[],update:boolean) {
  const taken=new Set(list.map(x=>x.id)),versions=new Map(assets.map(a=>[a.id,a.version]));
  const previous=new Map(rows.filter(r=>r.library===lib.manifest.id).map(r=>[r.key,r]));
  const map=new Map<string,string>(),pending=new Map<string,ImportedRecord>();
  for (const key of wanted) {
    const record=previous.get(key),exists=record && taken.has(record.local),version=versions.get(key) ?? lib.manifest.version;
    const local=exists ? record.local : localKey(lib.manifest.id,key,taken);
    map.set(key,local);taken.add(local);
    if (!exists || update && BigInt(version)>BigInt(record.version)) pending.set(key,{library:lib.manifest.id,key,local,version});
  }
  function write(make:(key:string,local:string)=>T) {
    if (!pending.size) return {list,rows};
    const items=new Map([...pending].map(([key,r])=>[r.local,make(key,r.local)]));
    const next=list.map(x=>{const replacement=items.get(x.id);items.delete(x.id);return replacement ?? x;});
    for (const value of items.values()) next.push(value);
    const remaining=new Map(pending);
    const records=rows.map(r=>{
      const replacement=r.library===lib.manifest.id && remaining.get(r.key);
      if (replacement) {remaining.delete(r.key);return replacement;}
      return r;
    });
    for (const r of remaining.values()) records.push(r);
    return {list:next,rows:records};
  }
  return {map,pending,write};
}
