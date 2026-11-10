import { archiveJsonText } from "../archive-json";

export function parseSketchJson(buffer: ArrayBuffer, name: string): unknown {
  return JSON.parse(archiveJsonText(buffer, "not a valid FigCraft file: Sketch file: " + name));
}
