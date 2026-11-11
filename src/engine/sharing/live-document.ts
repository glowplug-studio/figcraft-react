import { parse } from "lossless-json";
import { readComments } from "../comments";
import type { Document } from "../document";
import { fileData } from "../file-bytes";
import { readDocumentMetadata } from "../file-format";
import { imageHash, imageResource, MAX_IMAGE_BYTES, readImageResource, validImageKey } from "../image-resource";
import { id, number } from "../native-values";
import { readSharedStyles } from "../shared-styles";
import { emptyVariables, readVariables } from "../variables";
import type { LiveChange } from "./live-changes";

type Change = Extract<LiveChange,{type:"setDoc" | "put" | "remove"}>;

function entryList<T extends {readonly id: string}>(previous: readonly T[], change: Change, read: (raw: unknown) => readonly T[]) {
  if (change.type === "remove") return previous.filter(item => item.id !== change.key);
  const raw = parse(change.value);
  if (change.type === "put") {
    const [item] = read([raw]);
    if (!item || item.id !== change.key) throw new Error("Entry ID does not match its key");
    const index = previous.findIndex(old => old.id === item.id);
    return index === -1 ? [...previous,item] : previous.map((old,i) => i === index ? item : old);
  }
  if (!change.prop.endsWith("Order")) return read(raw);
  if (!Array.isArray(raw)) throw new Error("Entry order must be an array");
  const byId = new Map<string,{indices: number[]; cursor: number}>();
  previous.forEach((item,i) => {
    const group = byId.get(item.id);
    if (group) group.indices.push(i);
    else byId.set(item.id,{indices:[i],cursor:0});
  });
  const used = new Set<number>(), sorted: T[] = [];
  for (const token of raw) {
    const key = change.prop === "commentOrder" ? id(token,"comment order") : token;
    if (typeof key !== "string") throw new Error("Invalid entry order");
    const group = byId.get(key);
    if (group && group.cursor < group.indices.length) {
      const index = group.indices[group.cursor++];
      used.add(index);
      sorted.push(previous[index]);
    }
  }
  return [...sorted,...previous.filter((_,i) => !used.has(i))];
}

async function changeImage(doc: Document, change: Extract<Change,{type:"put" | "remove"}>) {
  const key = change.key, images = Object.assign(Object.create(null),doc.images) as Record<string,NonNullable<Document["images"]>[string]>;
  if (change.type === "remove") {
    if (!Object.hasOwn(images,key)) return doc;
    delete images[key];
  } else {
    if (!validImageKey(key)) throw new Error("Invalid image key");
    const value = parse(change.value);
    if (!value || typeof value !== "object" || !("bytes" in value) || !("width" in value) || !("height" in value)) throw new Error("Invalid image");
    const {bytes} = value, width = number(value.width,"image width"), height = number(value.height,"image height");
    if (![width,height].every(n => Number.isInteger(n) && n >= 0 && n <= 65535)) throw new Error("Invalid image dimensions");
    if (typeof bytes !== "string" || bytes.length > 4 * Math.ceil(MAX_IMAGE_BYTES/3) || bytes.length % 4 ||
        /[^a-zA-Z0-9+/=]/.test(bytes)) throw new Error("Invalid image base64");
    const data = fileData(bytes, MAX_IMAGE_BYTES);
    // Rust's standard decoder requires canonical trailing bits.
    const tail = bytes.endsWith("==") ? 2 : bytes.endsWith("=") ? 1 : 0;
    if (tail && btoa(String.fromCharCode(...data.subarray(data.length-(3-tail)))) !== bytes.slice(-4)) throw new Error("Invalid image padding");
    const digest = await imageHash(data);
    if (/^[\da-fA-F]{64}$/.test(key) && digest !== key) throw new Error("Image bytes do not match their hash");
    const old = images[key];
    if (old && (old.digest ?? await imageHash(old.bytes)) !== digest) throw new Error("The image key already holds different bytes");
    const resource = old ?? await readImageResource(data,imageResource(data));
    images[key] = Object.freeze({...resource,width,height,digest});
  }
  const {images:_old,...rest} = doc;
  return Object.freeze({...rest,...(Object.keys(images).length && {images:Object.freeze(images)})});
}

const listFamilies: Record<string,string> = {
  styles:"style",styleOrder:"style",comments:"comment",commentOrder:"comment",
  collections:"collection",collectionOrder:"collection",variables:"variable",variableOrder:"variable",
};

export async function applyLiveDocumentChange(doc: Document, change: Change): Promise<Document> {
  const family = change.type === "setDoc" ? listFamilies[change.prop] : change.entry;
  switch (family) {
    case "style": {
      const {styles,...rest} = doc;
      const result = entryList(styles ?? [],change,readSharedStyles);
      return Object.freeze({...rest,...(result.length && {styles:Object.freeze(result)})});
    }
    case "comment": {
      const {comments,...rest} = doc;
      const result = entryList(comments ?? [],change,raw => readComments(raw) ?? []);
      return Object.freeze({...rest,...(result.length && {comments:Object.freeze(result)})});
    }
    case "collection":
    case "variable": {
      const {variables:prior,...rest} = doc;
      const data = prior ?? emptyVariables;
      const collections = family === "collection" ? entryList(data.collections,change,raw => readVariables({collections:raw}).collections) : data.collections;
      const variables = family === "variable" ? entryList(data.variables,change,raw => readVariables({variables:raw}).variables) : data.variables;
      return Object.freeze({...rest,...((collections.length || variables.length) && {
        variables:Object.freeze({collections:Object.freeze(collections),variables:Object.freeze(variables)})})});
    }
    case "image": if (change.type !== "setDoc") return changeImage(doc,change);
  }
  if (change.type !== "setDoc") throw new Error("Unknown live document entry");
  const raw = parse(change.value);
  switch (change.prop) {
    case "name":
      if (typeof raw !== "string") throw new Error("Invalid document name");
      return Object.freeze({...doc,name:raw});
    case "currentPage":
      return Object.freeze({...doc,currentPage:raw === null ? doc.pages[0] : id(raw,"current page")});
    case "documentColors": {
      const {documentColours:_old,...rest} = doc;
      return Object.freeze({...rest,...readDocumentMetadata({document_colors:raw}).metadata});
    }
    case "colorProfile": {
      const {colourProfile:_old,...rest} = doc;
      return Object.freeze({...rest,...readDocumentMetadata({color_profile:raw}).metadata});
    }
    case "imagePresets": {
      const {imagePresets:_old,...rest} = doc;
      return Object.freeze({...rest,...readDocumentMetadata({image_presets:raw}).metadata});
    }
    case "libraries": {
      const {libraryLinks:_links,libraryRecords:_records,libraryStore:_store,...rest} = doc;
      const {metadata,teamLibraryInvites} = readDocumentMetadata({libraries:raw});
      if (teamLibraryInvites.size) throw new Error("Private library invites cannot be shared in document changes");
      return Object.freeze({...rest,...metadata});
    }
    default: throw new Error("Unsupported live document property " + change.prop);
  }
}
