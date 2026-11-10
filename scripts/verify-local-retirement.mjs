import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";
import {createClient} from "@supabase/supabase-js";

// Dedicated local maintenance gate. Restarting PostgreSQL also tests that the
// request queue can be lost while the immutable retirement survives.
const cwd = new URL("../", import.meta.url);
const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}));
assert.equal(status.API_URL, "http://127.0.0.1:55321", "requires the local Figcraft stack");
const container = "supabase_db_figcraft-react";
function sql(statement) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1",
    "-U", "postgres", "-d", "postgres"], {input:statement, encoding:"utf8", stdio:["pipe","pipe","pipe"]}).trim();
}
assert.equal(sql("select (select count(*) from auth.users)+(select count(*) from storage.objects)"), "0",
  "run this restart gate on an idle, empty Figcraft test stack");
assert.equal(sql("select count(*) from cron.job where active and jobname='figcraft-online-expiry' and schedule='*/10 * * * *'"), "1");
assert.equal(sql("select count(*) from cron.job where active and jobname='figcraft-online-expiry-startup' and schedule='@reboot'"), "1");
execFileSync(process.execPath, ["scripts/configure-local-retirement.mjs"], {cwd, stdio:"pipe"});
const options = {auth:{persistSession:false,autoRefreshToken:false}};
const admin = createClient(status.API_URL, status.SECRET_KEY, options);
const user = createClient(status.API_URL, status.PUBLISHABLE_KEY, options);
const email = randomUUID()+"@example.test", password = randomUUID()+"Aa1!";
const check = response => { if(response.error) throw new Error(response.error.message); return response.data; };
const owner = check(await admin.auth.admin.createUser({email,password,email_confirm:true})).user.id;
const paths = [];
const archive = JSON.parse(readFileSync(new URL("../tests/fixtures/native-rest-documents.json",import.meta.url),"utf8"))[0].archive;
async function expired() {
  const id=randomUUID(), path=owner+"/"+id+".figcraft";
  paths.push(path);
  const object=check(await user.storage.from("figcraft-files").upload(path, Buffer.from(archive,"base64"), {contentType:"application/octet-stream"}));
  check(await admin.from("online_files").insert({id,owner_id:owner,snapshot_id:object.id,name:"Timed fixture",created_at:"2000-01-01T00:00:00Z"}));
  return {id,path,snapshot:object.id};
}
async function awaitDeletion(fixture, job, since, timeout) {
  const until = Date.now()+timeout;
  while (Date.now() < until) {
    // During restart the database and API become reachable independently.
    let observed = false;
    try {
      observed = sql(`select exists(select from cron.job_run_details d join cron.job j on d.jobid=j.jobid
        where j.jobname='${job}' and d.start_time >= '${since}'::timestamptz and d.status='succeeded')
        and not exists(select from storage.objects where id='${fixture.snapshot}')
        and not exists(select from figcraft_private.online_retirements where snapshot_id='${fixture.snapshot}')
        and exists(select from net._http_response where status_code=200 and created >= '${since}'::timestamptz
            and position('${fixture.path}' in content)>0)`) === "t";
    } catch { /* PostgreSQL is restarting. */ }
    if (observed) {
      const gone = await admin.storage.from("figcraft-files").download(fixture.path);
      if (gone.error && Number(gone.error.statusCode ?? gone.error.status) === 404) return;
      if (gone.error && /not found|does not exist/i.test(gone.error.message)) return;
    }
    await delay(1000);
  }
  throw new Error(job+" did not complete a confirmed Storage deletion before its deadline");
}
try {
  check(await user.auth.signInWithPassword({email,password}));
  const periodic = await expired(), began = new Date().toISOString();
  console.log("Waiting for the installed ten-minute cron job.");
  await awaitDeletion(periodic,"figcraft-online-expiry",began,11*60_000);
  console.log("Periodic cleanup passed.");
  const restart = await expired();
  const receipt=check(await admin.rpc("claim_online_retirement",{target:restart.snapshot}));
  assert.equal(receipt.length,1,"the interrupted worker must leave a committed claim");
  const restarting = new Date().toISOString();
  execFileSync("docker", ["restart", container], {stdio:"pipe"});
  await awaitDeletion(restart,"figcraft-online-expiry-startup",restarting,120_000);
  console.log("Startup cleanup recovered the committed claim and confirmed Storage deletion.");
} finally {
  if (paths.length) check(await admin.storage.from("figcraft-files").remove(paths));
  check(await admin.auth.admin.deleteUser(owner));
}
