import {readLibraryUsageReport,summariseLibraryUsage} from "../../engine/sharing/library-usage";
import type {SupabaseClient} from "@supabase/supabase-js";
import {decodePublishedLibrary} from "../../engine/file-format";
import {ONLINE_ARCHIVE_BYTES} from "../../engine/sharing/publication";
import {onlineSnapshotPath} from "./online-files";
import {keepHostArchive} from "./publication";

export class TeamLibraryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function verifyGrant(writer: SupabaseClient, file: string, hash: string, edit: boolean) {
  const response = await writer.from("online_file_links").select("access_level").eq("file_id",file)
    .eq("token_hash",hash).maybeSingle();
  if (response.error) throw response.error;
  if (!response.data) throw new TeamLibraryError("The invite is unavailable",403);
  if (edit && response.data.access_level !== "edit") throw new TeamLibraryError("Publishing a team library requires an edit link",403);
}

export async function publishTeamLibrary(user: SupabaseClient, writer: SupabaseClient, file: string, hash: string, submission: string) {
  await verifyGrant(writer,file,hash,true);
  const claims = await user.auth.getClaims();
  const actor = claims.data?.claims.sub;
  if (!actor || claims.error) throw new TeamLibraryError("Sign in to publish a library",401);
  const policy = await user.rpc("online_host_information",{target:null}).single<{file_mb:number;open_publish:boolean}>();
  if (policy.error) throw policy.error;
  if (policy.data.open_publish) {
    const listing = await writer.from("online_files").select("owner_id").eq("id",file).single();
    if (listing.error) throw listing.error;
    if (listing.data.owner_id !== null) throw new TeamLibraryError("Only files published with the server key can hold a team library on this public server",403);
  }
  const limit = policy.data.file_mb * 1048576;
  const storage = user.storage.from("figcraft-files");
  const staged = await storage.download(onlineSnapshotPath(actor,submission));
  if (staged.error) throw new TeamLibraryError("The staged library is unavailable",422);
  if (staged.data.size > Math.min(limit,ONLINE_ARCHIVE_BYTES)) throw new TeamLibraryError("The library exceeds the host file size limit",413);
  let publication;
  try { publication = await decodePublishedLibrary(staged.data,limit); }
  catch { throw new TeamLibraryError("The library archive could not be read within the server limits",422); }
  if (!publication) throw new TeamLibraryError("That file has no published library",422);
  if (Object.keys(publication.document.nodes).length > 5_000_000) throw new TeamLibraryError("The library has more than 5000000 layers",422);
  const snapshot = await keepHostArchive(writer,"library",file,staged.data);
  const {id,name,version} = publication.manifest;
  const reply = await writer.rpc("keep_team_library",{target:file,presented_hash:hash,snapshot,submission_id:submission,
    identity:id,title:name,revision:version,measured:staged.data.size});
  if (reply.error) {
    const status = {FC002:413,FC003:409,"42501":403,"22023":422}[reply.error.code];
    if (status) throw new TeamLibraryError(reply.error.message,status);
    throw reply.error;
  }
  if (reply.data !== version) throw new Error("Unexpected library publication receipt");
  return version;
}

export async function readTeamLibraryUsage(writer:SupabaseClient,file:string,hash:string,days:number,maxAssetRows=Infinity) {
  const reply=await writer.rpc("read_library_usage",{target:file,presented_hash:hash,days});
  if (reply.error?.code==="42501") throw new TeamLibraryError("The invite is unavailable",403);
  if (reply.error) throw reply.error;
  return summariseLibraryUsage(reply.data,maxAssetRows);
}

export async function fetchTeamLibrary(writer: SupabaseClient, file: string, hash: string, have: string | null, address: string, usage?:unknown) {
  if (usage!==undefined) {
    let report;
    try {report=readLibraryUsageReport(usage);} catch {throw new TeamLibraryError("Invalid library usage report",422);}
    const kept=await writer.rpc("report_library_usage",{target:file,presented_hash:hash,report});
    if (kept.error?.code==="42501") throw new TeamLibraryError("The invite is unavailable",403);
    if (kept.error) throw kept.error;
  }
  const {data,error} = await writer.rpc("fetch_team_library",{target:file,presented_hash:hash,have,address});
  if (error?.code === "42501") throw new TeamLibraryError("The invite is unavailable",403);
  if (error) throw error;
  if (data?.state === "empty") return {state:"empty" as const};
  if (data?.state === "unchanged" && have !== null && data.version===have) return {state:"unchanged" as const,version:have};
  if (data?.state === "busy") throw new TeamLibraryError("Too many downloads from your address or from everyone right now: try again in a minute",429);
  if (data?.state !== "available" || typeof data.path !== "string" || typeof data.version !== "string") throw new Error("Invalid library metadata");
  const result = await writer.storage.from("figcraft-files").download(data.path);
  if (result.error) throw result.error;
  await verifyGrant(writer,file,hash,false);
  return {state:"available" as const,version:data.version,archive:result.data};
}
