import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {unzipSync} from "fflate";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";
import {SupabaseOnlineFileStore} from "../../src/backends/supabase/online-files";
import {createPublishedLinks,publishedLinkDigests} from "../../src/backends/published-links";
import {finaliseOnlineFile} from "../../src/backends/supabase/publication";
import {readSharedDrawing} from "../../examples/nextjs/lib/sharing/join";
import {manageIndividualLinks} from "../../examples/nextjs/lib/sharing/individual-links";
import {localSupabase} from "../support/localSupabase";
import {localOperatorSql} from "../support/localOperatorSql";

const enabled=process.env.FIGCRAFT_LOCAL_INTEGRATION==="1";
const bucket="figcraft-files";
type ManagementReceipt=Awaited<ReturnType<typeof manageIndividualLinks>>;
type CreatedLink=Extract<ManagementReceipt,{token:string}>;
type LinkList={links:Array<{id:string;access:"edit"|"view"|"comment";label:string;created:string|number}>};

describe.skipIf(!enabled)("individual online links on real local Supabase",()=>{
  const local=enabled?localSupabase():undefined;
  const users:string[]=[];
  const paths:string[]=[];
  let ingress:string;
  let archive:Uint8Array<ArrayBuffer>;

  beforeEach(()=>{
    const entropy=randomUUID().replaceAll("-","");
    ingress="fd"+entropy.slice(0,2)+":"+entropy.slice(2,6)+":"+entropy.slice(6,10)+"::1";
  });

  async function account() {
    const email=`individual-links-${randomUUID()}@example.test`;
    const password=randomUUID()+"Aa1!";
    const created=await local!.admin.auth.admin.createUser({email,password,email_confirm:true});
    if(created.error)throw created.error;
    users.push(created.data.user.id);
    const client=createClient(local!.url,local!.key,{auth:{persistSession:false,autoRefreshToken:false}});
    const login=await client.auth.signInWithPassword({email,password});
    if(login.error)throw login.error;
    return {id:created.data.user.id,client};
  }

  async function publish(client:SupabaseClient,actor:string) {
    const id=randomUUID();
    paths.push(actor+"/"+id+".figcraft");
    const links=createPublishedLinks();
    const proof=await publishedLinkDigests(links);
    const store=new SupabaseOnlineFileStore(client,actor,
      file=>finaliseOnlineFile(client,local!.admin,file,proof,{address:ingress}));
    await store.publish(id,new Blob([archive]));
    return {id,links};
  }

  async function manage(actor:string,file:string,request:Parameters<typeof manageIndividualLinks>[3],address=ingress) {
    return manageIndividualLinks(local!.admin,actor,file,request,address);
  }
  async function createLink(actor:string,file:string,access:"edit"|"view"|"comment",label:string,address=ingress):Promise<CreatedLink> {
    const receipt=await manage(actor,file,{action:"createLink",access,label},address);
    if(!("token" in receipt))throw new Error("Invalid create-link receipt");
    return receipt;
  }
  async function listLinks(actor:string,file:string,address=ingress):Promise<LinkList> {
    const receipt=await manage(actor,file,{action:"links"},address);
    if(!("links" in receipt)||!Array.isArray(receipt.links))throw new Error("Invalid link-list receipt");
    return {links:receipt.links};
  }

  let owner:Awaited<ReturnType<typeof account>>;
  let stranger:Awaited<ReturnType<typeof account>>;
  beforeAll(async()=>{
    owner=await account();
    stranger=await account();
    const fixture=await readFile(new URL("../fixtures/native-pdf-print-dialog.zip",import.meta.url));
    archive=new Uint8Array(unzipSync(fixture)["Cover.figcraft"]);
  });
  afterAll(async()=>{
    if(!local)return;
    if(paths.length)await local.admin.storage.from(bucket).remove(paths);
    for(const id of users)await local.admin.auth.admin.deleteUser(id);
  });

  it("lists in creation order with metadata only and cleans Unicode labels",async()=>{
    const {id,links}=await publish(owner.client,owner.id);
    const expected=[
      ...(["edit","view"] as const).map(access=>({id:links[access].id,access,label:"Published ("+access+")"})),
    ];
    const specs=[
      {access:"view",label:"  Café ☕\n\u202eReview\u0000  ",clean:"Café ☕Review"},
      {access:"comment",label:"漢".repeat(300),clean:"漢".repeat(256)},
      {access:"edit",label:"\u0001‏ Final ",clean:" Final"},
    ] as const;
    const made:Array<CreatedLink & {label:string}> = [];
    for(const spec of specs){
      const link=await createLink(owner.id,id,spec.access,spec.label);
      expect(link).toMatchObject({access:spec.access,token:expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),id:expect.stringMatching(/^[0-9a-f]{16}$/)});
      made.push({...link,label:spec.clean});
    }
    const listed=await listLinks(owner.id,id);
    expect(listed.links).toHaveLength(5);
    expect(listed.links.map(({id:linkId,access,label})=>({id:linkId,access,label})))
      .toEqual([...expected,...made.map(({id:linkId,access,label})=>({id:linkId,access,label}))]);
    expect(listed.links.every(link=>Number.isSafeInteger(Number(link.created))&&Number(link.created)>1_700_000_000)).toBe(true);
    expect(listed.links.every(link=>!("token" in link)&&!("token_hash" in link)&&!("code" in link))).toBe(true);
    const stored=await local!.admin.from("online_file_links").select("*").eq("file_id",id);
    if(stored.error)throw stored.error;
    for(const link of made){
      const row=stored.data.find(candidate=>candidate.id===link.id);
      expect(row?.token_hash).toBe(createHash("sha256").update(link.token).digest("hex"));
      expect(JSON.stringify(stored.data)).not.toContain(link.token);
    }
  });

  it("denies stranger ownership and raw authenticated or anonymous RPC access",async()=>{
    const {id}=await publish(owner.client,owner.id);
    await expect(manage(stranger.id,id,{action:"links"})).rejects.toMatchObject({status:403});
    const args={actor:owner.id,target:id,operation:"links",link_id:null,new_link:null,address:ingress};
    expect((await owner.client.rpc("manage_online_link",args)).error).toBeTruthy();
    expect((await stranger.client.rpc("manage_online_link",args)).error).toBeTruthy();
    expect((await local!.client.rpc("manage_online_link",args)).error).toBeTruthy();
    expect((await owner.client.from("online_file_links").select("*").eq("file_id",id)).error).toBeTruthy();
  });

  it("revokes only the selected link and refuses a repeated revoke",async()=>{
    const {id,links}=await publish(owner.client,owner.id);
    const guest=await stranger.client.auth.getClaims();
    const session=guest.data?.claims.session_id;
    if(typeof session!=="string")throw new Error("Guest session claim missing");
    const first=await createLink(owner.id,id,"view","Guest one");
    const second=await createLink(owner.id,id,"comment","Guest two");
    const admitted=await readSharedDrawing(stranger.client,local!.admin,stranger.id,session,randomUUID(),id,first.token);
    expect(admitted.access).toBe("view");
    expect(new Uint8Array(await admitted.bytes.arrayBuffer())).toEqual(archive);
    await expect(manage(owner.id,id,{action:"revoke",link:first.id})).resolves.toEqual({done:true});
    await expect(readSharedDrawing(stranger.client,local!.admin,stranger.id,session,randomUUID(),id,first.token)).rejects.toBeTruthy();
    const remaining=await readSharedDrawing(stranger.client,local!.admin,stranger.id,session,randomUUID(),id,second.token);
    expect(remaining.access).toBe("comment");
    const original=await readSharedDrawing(stranger.client,local!.admin,stranger.id,session,randomUUID(),id,links.view.token);
    expect(original.access).toBe("view");
    await expect(manage(owner.id,id,{action:"revoke",link:first.id})).rejects.toMatchObject({status:422});
  });

  it("does not silently issue another link when a successful creation reply is lost",async()=>{
    const {id}=await publish(owner.client,owner.id);
    let calls=0;
    const unreliable=new Proxy(local!.admin,{get(target,property,receiver){
      if(property==="rpc")return async(name:string,args:Record<string,unknown>)=>{
        calls++;
        const reply=await target.rpc(name,args);
        if(reply.error)throw reply.error;
        throw new Error("Lost successful creation reply");
      };
      return Reflect.get(target,property,receiver);
    }});
    await expect(manageIndividualLinks(unreliable,owner.id,id,{action:"createLink",access:"view",label:"Lost reply"},ingress))
      .rejects.toThrow("Lost successful creation reply");
    expect(calls).toBe(1);
    const before=await listLinks(owner.id,id);
    expect(before.links.filter(link=>link.label==="Lost reply")).toHaveLength(1);
    const retry=await createLink(owner.id,id,"view","Explicit retry");
    const after=await listLinks(owner.id,id);
    expect(after.links).toHaveLength(before.links.length+1);
    expect(after.links.at(-1)?.id).toBe(retry.id);
    expect(before.links.some(link=>link.id===retry.id)).toBe(false);
  });

  it("serialises creation at the 100-link limit and charges refused mutations while listing stays free",async()=>{
    const {id}=await publish(owner.client,owner.id);
    const seeded=await local!.admin.rpc("manage_online_link",{
      actor:owner.id,target:id,operation:"createLink",link_id:null,
      new_link:{id:"0000000000000001",access_level:"view",label:"seed",token_hash:"a".repeat(64),code_hash:null,wrapped_token:null},address:ingress,
    });
    // Seed remaining rows through the service-role connection so the RPC calls below
    // exercise the precise one-slot concurrent boundary without spending its budget.
    if(seeded.error)throw seeded.error;
    const seeds=Array.from({length:96},(_,index)=>({
      id:(index+2).toString(16).padStart(16,"0"),file_id:id,access_level:"view",label:"seed",
      token_hash:createHash("sha256").update("seed-"+index).digest("hex"),
    }));
    const inserted=await local!.admin.from("online_file_links").insert(seeds);
    if(inserted.error)throw inserted.error;
    const [a,b]=await Promise.allSettled([
      createLink(owner.id,id,"view","race one"),
      createLink(owner.id,id,"edit","race two"),
    ]);
    expect([a,b].filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect([a,b].filter(result=>result.status==="rejected")).toHaveLength(1);
    const count=await local!.admin.from("online_file_links").select("id",{count:"exact",head:true}).eq("file_id",id);
    expect(count.count).toBe(100);
    // Freeze refill for this fixture's address blocks so slow machines measure
    // refusal charging, rather than elapsed wall-clock replenishment.
    localOperatorSql(local!,"update figcraft_private.online_code_budgets set admin_tokens=57,admin_used_at=clock_timestamp()+interval '1 minute' where block in (select block from figcraft_private.publication_blocks(:'address'::inet))",{address:ingress});
    for(let attempt=0;attempt<57;attempt++){
      await expect(createLink(owner.id,id,"view","full"))
        .rejects.toMatchObject({status:422,message:"A file has at most 100 links: revoke one first"});
    }
    await expect(listLinks(owner.id,id)).resolves.toMatchObject({links:expect.any(Array)});
    await expect(createLink(owner.id,id,"view","over budget"))
      .rejects.toMatchObject({status:429});
  });
});
