export interface TeamFile {
  file: string;
  name: string;
  updated: string;
  people: number;
  access: "edit" | "comment" | "view";
}
export type TeamDirectory = {state: "none"} | {state: "listed"; web: string; files: TeamFile[]};

export function teamFileLink(server: string, file: string) {
  return "figcraft://join?server=" + server.split("?", 1)[0].trim() + "&file=" + file + "&team=1";
}

export function teamWebLink(web: string, link: string) {
  const escaped = encodeURIComponent(link).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return web + "#join=" + escaped;
}

export function validTeamWeb(value: string) {
  return /^https?:\/\//.test(value) && new TextEncoder().encode(value).length <= 500 && !/[#\p{White_Space}\p{Cc}]/u.test(value);
}

export function readTeamDirectory(value: unknown): TeamDirectory {
  if (!value || typeof value !== "object" || !("state" in value)) throw new Error("Invalid team directory");
  if (value.state === "none") return {state:"none"};
  if (value.state !== "listed" || !("files" in value) || !Array.isArray(value.files)) throw new Error("Invalid team directory");
  const files: TeamFile[] = [];
  for (const row of value.files as unknown[]) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.file !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.file)) continue;
    if (typeof item.name !== "string" || typeof item.updated !== "string" || !/^\d{1,20}$/.test(item.updated)
        || BigInt(item.updated) > 0xffffffffffffffffn || typeof item.people !== "number" || !Number.isInteger(item.people) || item.people < 0 || item.people > 0xffffffff
        || (item.access !== "edit" && item.access !== "comment" && item.access !== "view")) throw new Error("Invalid team file");
    const name = [...item.name.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "").replace(/\p{Cc}/gu, "")].slice(0,256).join("");
    files.push({file:item.file, name, updated:item.updated, people:item.people, access:item.access});
    if (files.length === 500) break;
  }
  const web = "web" in value && typeof value.web === "string" && validTeamWeb(value.web) ? value.web : "";
  return {state:"listed", web, files};
}
