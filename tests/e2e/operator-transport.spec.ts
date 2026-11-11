import {expect,test} from "@playwright/test";
import {build} from "vite";
type OperatorRequests=typeof import("../../examples/nextjs/lib/sharing/operator-request");

test("operator keys use TLS or loopback and cannot follow a browser redirect",async({page})=>{
  const bundle=await build({configFile:false,logLevel:"silent",define:{"process.env.NODE_ENV":JSON.stringify("production")},
    build:{write:false,lib:{entry:"examples/nextjs/lib/sharing/operator-request.ts",name:"FigcraftOperatorRequests",formats:["iife"]}}});
  const output=(Array.isArray(bundle)?bundle[0]:bundle) as {output:{type:string;code?:string}[]};
  const script=output.output.find(item=>item.type==="chunk")?.code;
  if(!script)throw new Error("Operator request fixture failed to build");
  const posted:{url:string;hasKey:boolean}[]=[];
  await page.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==="POST"){
      posted.push({url:url.href,hasKey:Object.hasOwn(request.postDataJSON(),"serverKey")});
      if(url.pathname==="/redirect")return route.fulfill({status:307,headers:{location:"http://other.test/forwarded"}});
      return route.fulfill({status:204});
    }
    await route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><title>Operator request fixture</title>"});
  });
  for(const [origin,allowed] of [["http://office.test",false],["https://office.test",true],["http://127.0.0.1:9123",true],
      ["http://localhost:9123",true],["http://[::1]:9123",true]] as const){
    await page.goto(origin);await page.addScriptTag({content:script});
    const send=(path:string,key?:string)=>page.evaluate(async ({path,key})=>{
      const {postOperatorRequest}=(window as unknown as {FigcraftOperatorRequests:OperatorRequests}).FigcraftOperatorRequests;
      try{return (await postOperatorRequest(path,{operation:"fixture"},key)).status;}
      catch(error){return error instanceof Error ? error.message : String(error);}
    },{path,key});
    posted.length=0;
    expect(await send("/key","fixture")).toEqual(allowed ? 204 : "The server key requires an encrypted connection or a server on this machine");
    expect(posted).toEqual(allowed ? [{url:origin+"/key",hasKey:true}] : []);
    expect(await send("/public")).toBe(204);
    expect(posted.at(-1)).toEqual({url:origin+"/public",hasKey:false});
    if(allowed){
      await page.evaluate(() => {
        const base = document.createElement("base");
        base.href = "http://other.test/";
        document.head.append(base);
      });
      expect(await send("/key","fixture")).toBe(204);
      expect(posted.at(-1)).toEqual({url:origin+"/key",hasKey:true});
      expect(await send("http://other.test/forwarded","fixture")).toBe("Unexpected operator request origin");
      expect(await send("/redirect","fixture")).toBe("Failed to fetch");
      expect(posted.at(-1)).toEqual({url:origin+"/redirect",hasKey:true});
      expect(posted.map(row=>row.url)).not.toContain("http://other.test/forwarded");
    }
  }
});
