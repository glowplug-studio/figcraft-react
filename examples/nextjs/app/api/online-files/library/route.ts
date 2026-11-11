import {createHash} from "node:crypto";
import {fetchTeamLibrary,publishTeamLibrary,readTeamLibraryUsage,TeamLibraryError} from "@glowplug-studio/figcraft-react/backends/supabase/team-library";
import {onlinePost} from "../../../../lib/supabase/online-post";
import {ingressAddress} from "../../../../lib/sharing/ingress-address";

const uuid = (s: unknown): s is string => typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
const privateHeaders = {"Cache-Control":"private, no-store"};
const answer = (value: unknown,status=200) => Response.json(value,{status,headers:privateHeaders});

export async function POST(request: Request) {
  const host = await onlinePost(request);
  if (host instanceof Response) return host;
  const body = await request.json().catch(() => null);
  if (!uuid(body?.file) || typeof body.token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(body.token)) {
    return answer({error:"Invalid library invite"},400);
  }
  const hash = createHash("sha256").update(body.token).digest("hex");
  try {
    if (body.action === "publish" && uuid(body.submission)) {
      const version = await publishTeamLibrary(host.user,host.writer,body.file,hash,body.submission);
      return answer({version});
    }
    if (body.action==="usage" && typeof body.days==="number" && Number.isFinite(body.days)) {
      return answer(await readTeamLibraryUsage(host.writer,body.file,hash,Math.min(365,Math.max(1,Math.round(body.days))),8));
    }
    if (body.action !== "fetch" || (body.have !== null && (typeof body.have !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(body.have)))) {
      return answer({error:"Invalid library request"},400);
    }
    const result = await fetchTeamLibrary(host.writer,body.file,hash,body.have,ingressAddress(request.headers,process.env.VERCEL==="1"),body.usage);
    if (result.state !== "available") return answer(result);
    return new Response(result.archive.stream(),{headers:{...privateHeaders,"Content-Type":"application/octet-stream",
      "X-Figcraft-Library-Version":result.version}});
  } catch (error) {
    if (error instanceof TeamLibraryError) return answer({error:error.message},error.status);
    return answer({error:"The team library is temporarily unavailable"},503);
  }
}
