import type { Document } from "./document";
import { parseString } from "./parameters";
import type { SharedStyle } from "./shared-styles";

export const styleOrderSpecs = {
  "style.duplicate": {label:"Duplicate style",undo:true},
  "style.move": {label:"Move styles",undo:true},
  "style.renameFolder": {label:"Rename style folder",undo:true},
} as const;

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = parseString(params[key]);
  if (value === undefined) throw new Error(key + " must be a string");
  return value;
}

function normalisePath(name: string): string {
  return name.split("/").map(part => part.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")).filter(Boolean).join("/");
}

function cleanName(name: string): string {
  const joined = normalisePath(name);
  if (!joined) throw new Error("name can't be empty");
  return Array.from(joined).slice(0, 500).join("");
}

function styleIndex(styles: readonly SharedStyle[], key: string): number {
  const index = styles.findIndex(style => style.id === key || style.name === key);
  if (index < 0) throw new Error("no style `" + key + "`");
  return index;
}

// The native single-user document starts at the catalogue length + 1 and skips IDs or names in use.
function newStyleId(styles: readonly SharedStyle[]) {
  const used = new Set(styles.flatMap(style => [style.id, style.name]));
  let n = styles.length + 1;
  while (used.has("S:" + n)) n++;
  return "S:" + n;
}

function copyName(styles: readonly SharedStyle[], name: string) {
  const names = new Set(styles.map(style => style.name));
  const base = name + " copy";
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? base : base + " " + i;
    if (!names.has(candidate)) return candidate;
  }
  return base;
}

function moveStyles(styles: readonly SharedStyle[], p: Record<string, unknown>) {
  if (!Array.isArray(p.styles)) throw new Error("styles must be a list of style ids");
  const picked = new Set(p.styles.filter((key): key is string => typeof key === "string").map(key => styleIndex(styles, key)));
  if (!picked.size) throw new Error("no styles to move");
  const folder = parseString(p.folder), before = parseString(p.before);
  const destination = folder === undefined ? undefined : Array.from(normalisePath(folder)).slice(0, 500).join("");
  const beforeId = before === undefined ? undefined : styles[styleIndex(styles, before)].id;
  const rest: SharedStyle[] = [], moved: SharedStyle[] = [];
  for (const [index, style] of styles.entries()) {
    if (!picked.has(index)) {
      rest.push(style);
      continue;
    }
    const leaf = style.name.slice(style.name.lastIndexOf("/") + 1);
    const name = destination === undefined ? style.name : destination ? destination + "/" + leaf : leaf;
    moved.push(name === style.name ? style : Object.freeze({...style, name}));
  }
  const at = rest.findIndex(style => style.id === beforeId);
  const split = at < 0 ? rest.length : at;
  return [...rest.slice(0, split), ...moved, ...rest.slice(split)];
}

function renameFolder(styles: readonly SharedStyle[], p: Record<string, unknown>) {
  const folder = cleanName(requiredString(p, "folder")), destination = cleanName(requiredString(p, "name"));
  const prefix = folder + "/";
  if (!styles.some(style => style.name.startsWith(prefix))) throw new Error("no styles in folder `" + folder + "`");
  return styles.map(style => {
    if (folder === destination || !style.name.startsWith(prefix)) return style;
    return Object.freeze({...style, name: destination + "/" + style.name.slice(prefix.length)});
  });
}

export function orderStyles(document: Document, command: string, params: Record<string, unknown>) {
  const styles = document.styles ?? [];
  let result: Record<string, unknown> = {ok:true};
  let next: SharedStyle[];
  switch (command) {
    case "style.duplicate": {
      const index = styleIndex(styles, requiredString(params, "style"));
      const original = styles[index], id = newStyleId(styles);
      const copy = Object.freeze({...original, id, name:copyName(styles, original.name)});
      next = [...styles.slice(0, index + 1), copy, ...styles.slice(index + 1)];
      result = {id};
      break;
    }
    case "style.move": next = moveStyles(styles, params); break;
    case "style.renameFolder": next = renameFolder(styles, params); break;
    default: throw new Error("Unknown style command " + command);
  }
  if (next.length === styles.length && next.every((style, index) => style === styles[index])) return { document, result };
  return {document:Object.freeze({...document, styles:Object.freeze(next)}), result};
}
