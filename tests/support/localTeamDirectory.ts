import type {localSupabase} from "./localSupabase";

import {localOperatorSql} from "./localOperatorSql";

/** The production settings table is operator-only. These fixtures use the local database operator. */
export function enableLocalTeamDirectory(local: ReturnType<typeof localSupabase>, access: "view" | "comment" | "edit", web: string) {
  const table = "figcraft_private.team_directory_settings";
  // Inserting preserves any pre-existing operator configuration.
  localOperatorSql(local, "insert into " + table + "(access_level,web_url) values (:'access',:'web')", {access,web});
  return () => localOperatorSql(local, "delete from " + table + " where web_url=:'web'", {web});
}
