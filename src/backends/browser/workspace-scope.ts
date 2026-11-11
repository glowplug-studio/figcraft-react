/** Browser equivalent of locking an open native process's recovery folder. */
export interface WorkspaceScope {
  current:string;
  adopted:string[];
  release():void;
}

export async function claimWorkspaceScope(database:string,principal:string,stored:()=>Promise<string[]>):Promise<WorkspaceScope> {
  const locks=typeof window!=="undefined" && globalThis.navigator?.locks;
  if(!locks)return {current:"",adopted:[],release(){}};
  const preference=JSON.stringify(["figcraft-workspace",database,principal]);
  let previous:string|null=null;
  try {previous=sessionStorage.getItem(preference);}catch{/* Storage can be disabled. */}
  const releases:(()=>void)[]=[];
  const claim=(scope:string)=>new Promise<boolean>((resolve,reject)=>{
    void locks.request(JSON.stringify([preference,scope]),{ifAvailable:true},lock=>{
      if(!lock){resolve(false);return;}
      return new Promise<void>(release=>{releases.push(release);resolve(true);});
    }).catch(reject);
  });
  try{
    const occupied=await stored();
    const choices=new Set([...(previous===null?[]:[previous]),"",...occupied]);
    let current:string|undefined;
    const adopted:string[]=[];
    for(const scope of choices){
      if(current!==undefined && !occupied.includes(scope))continue;
      if(await claim(scope)){
        if(current===undefined)current=scope;
        else adopted.push(scope);
      }
    }
    if(current===undefined){
      current=crypto.randomUUID();
      if(!await claim(current))throw new Error("Could not claim this window’s recovery workspace");
    }
    try{sessionStorage.setItem(preference,current);}catch{/* A fresh window can still discover its copy. */}
    return {current,adopted,release:()=>releases.forEach(release=>release())};
  }catch(error){releases.forEach(release=>release());throw error;}
}
