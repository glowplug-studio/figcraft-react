import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Configure only the local Figcraft Docker stack. A hosted operator supplies
// that project's own Storage URL and publishable key through Vault.
const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
const project = config.match(/^project_id = "([^"]+)"$/m)?.[1];
if (project !== "figcraft-react") throw new Error("Unexpected local Supabase project");
const cwd = new URL("../", import.meta.url);
const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}));
if (status.API_URL !== "http://127.0.0.1:55321" || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(status.PUBLISHABLE_KEY ?? "")) {
  throw new Error("The local Figcraft gateway and publishable key are required");
}
const sql = `begin;
create temporary table config_input(name text, value text) on commit drop;
copy config_input from stdin;
figcraft_storage_api_url\thttp://supabase_kong_${project}:8000/storage/v1
figcraft_storage_publishable_key\t${status.PUBLISHABLE_KEY}
\\.
do $configure$
declare entry record; prior uuid;
begin
  for entry in select * from config_input loop
    select id into prior from vault.secrets where name = entry.name;
    if prior is null then perform vault.create_secret(entry.value, entry.name);
    else perform vault.update_secret(prior, entry.value); end if;
  end loop;
end;
$configure$;
commit;
select figcraft_private.sweep_online_files();
`;
const result = execFileSync("docker", ["exec", "-i", "supabase_db_" + project,
  "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
  input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
}).trim();
console.log("Local Figcraft Storage cleanup configured. Dispatched requests:", Number(result));
