import {execFileSync} from "node:child_process";
import type {localSupabase} from "./localSupabase";

/** Operator-only fixtures, scoped to the local Figcraft database. Bind all supplied values. */
export function localOperatorSql(local: ReturnType<typeof localSupabase>, sql: string, values: Record<string,string> = {}) {
  if (local.url !== "http://127.0.0.1:55321") throw new Error("Requires the local Figcraft test stack");
  const bindings = Object.entries(values).flatMap(([name,value]) => ["-v", name + "=" + value]);
  return execFileSync("docker", ["exec","-i","supabase_db_figcraft-react","psql","-XqAt",
    "-v","ON_ERROR_STOP=1",...bindings,"-U","postgres","-d","postgres"],
    {input:sql,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();
}
