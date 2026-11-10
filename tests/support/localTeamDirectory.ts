import {execFileSync} from "node:child_process";
import type {localSupabase} from "./localSupabase";

/** The production settings table is operator-only. These fixtures use the local database operator. */
export function enableLocalTeamDirectory(local: ReturnType<typeof localSupabase>, access: "view" | "comment" | "edit", web: string) {
  if (local.url !== "http://127.0.0.1:55321") throw new Error("Requires the local Figcraft test stack");
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  const table = "figcraft_private.team_directory_settings";
  const run = (sql: string) => execFileSync("docker", ["exec","-i","supabase_db_figcraft-react","psql","-XqAt",
    "-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"], {input:sql,stdio:["pipe","pipe","pipe"]});
  // Inserting preserves any pre-existing operator configuration.
  run("insert into " + table + "(access_level,web_url) values (" + literal(access) + "," + literal(web) + ")");
  return () => run("delete from " + table + " where web_url=" + literal(web));
}
