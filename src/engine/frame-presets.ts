import { pageOf, type Document } from "./document";
import { boundsOf, type Viewport } from "./viewport";
import { parseNodeId, parseNumber, parseString } from "./parameters";
import { pixelRound } from "./geometry";

export interface FramePreset { readonly category: string; readonly name: string; readonly width: number; readonly height: number }
/** Static data ported from cmd/create.rs FRAME_PRESETS at 0b97f3f; no runtime reference dependency. */
export const framePresets: readonly FramePreset[] = Object.freeze([
  Object.freeze({"category": "Phone", "name": "iPhone 17", "width": 402.0, "height": 874.0}),
  Object.freeze({"category": "Phone", "name": "iPhone 17 Pro", "width": 402.0, "height": 874.0}),
  Object.freeze({"category": "Phone", "name": "iPhone 17 Pro Max", "width": 440.0, "height": 956.0}),
  Object.freeze({"category": "Phone", "name": "iPhone Air", "width": 420.0, "height": 912.0}),
  Object.freeze({"category": "Phone", "name": "iPhone 16", "width": 393.0, "height": 852.0}),
  Object.freeze({"category": "Phone", "name": "iPhone 16 Pro", "width": 402.0, "height": 874.0}),
  Object.freeze({"category": "Phone", "name": "iPhone 16 Pro Max", "width": 440.0, "height": 956.0}),
  Object.freeze({"category": "Phone", "name": "iPhone 16 Plus", "width": 430.0, "height": 932.0}),
  Object.freeze({"category": "Phone", "name": "iPhone SE", "width": 320.0, "height": 568.0}),
  Object.freeze({"category": "Phone", "name": "Android Compact", "width": 412.0, "height": 917.0}),
  Object.freeze({"category": "Phone", "name": "Android Medium", "width": 700.0, "height": 840.0}),
  Object.freeze({"category": "Tablet", "name": "iPad mini 8.3", "width": 744.0, "height": 1133.0}),
  Object.freeze({"category": "Tablet", "name": "iPad Pro 11\"", "width": 834.0, "height": 1194.0}),
  Object.freeze({"category": "Tablet", "name": "iPad Pro 12.9\"", "width": 1024.0, "height": 1366.0}),
  Object.freeze({"category": "Tablet", "name": "Surface Pro 8", "width": 1440.0, "height": 960.0}),
  Object.freeze({"category": "Tablet", "name": "Android Expanded", "width": 1280.0, "height": 800.0}),
  Object.freeze({"category": "Desktop", "name": "MacBook Air", "width": 1280.0, "height": 832.0}),
  Object.freeze({"category": "Desktop", "name": "MacBook Pro 14\"", "width": 1512.0, "height": 982.0}),
  Object.freeze({"category": "Desktop", "name": "MacBook Pro 16\"", "width": 1728.0, "height": 1117.0}),
  Object.freeze({"category": "Desktop", "name": "Desktop", "width": 1440.0, "height": 1024.0}),
  Object.freeze({"category": "Desktop", "name": "Wireframe", "width": 1440.0, "height": 1024.0}),
  Object.freeze({"category": "Desktop", "name": "TV", "width": 1280.0, "height": 720.0}),
  Object.freeze({"category": "Presentation", "name": "Slide 16:9", "width": 1920.0, "height": 1080.0}),
  Object.freeze({"category": "Presentation", "name": "Slide 4:3", "width": 1024.0, "height": 768.0}),
  Object.freeze({"category": "Watch", "name": "Apple Watch Series 10 42mm", "width": 187.0, "height": 223.0}),
  Object.freeze({"category": "Watch", "name": "Apple Watch 41mm", "width": 176.0, "height": 215.0}),
  Object.freeze({"category": "Watch", "name": "Apple Watch 45mm", "width": 198.0, "height": 242.0}),
  Object.freeze({"category": "Paper", "name": "A4", "width": 595.0, "height": 842.0}),
  Object.freeze({"category": "Paper", "name": "A5", "width": 420.0, "height": 595.0}),
  Object.freeze({"category": "Paper", "name": "A6", "width": 297.0, "height": 420.0}),
  Object.freeze({"category": "Paper", "name": "Letter", "width": 612.0, "height": 792.0}),
  Object.freeze({"category": "Paper", "name": "Tabloid", "width": 792.0, "height": 1224.0}),
  Object.freeze({"category": "Social media", "name": "Instagram post", "width": 1080.0, "height": 1350.0}),
  Object.freeze({"category": "Social media", "name": "Instagram story", "width": 1080.0, "height": 1920.0}),
  Object.freeze({"category": "Social media", "name": "Facebook post", "width": 1200.0, "height": 630.0}),
  Object.freeze({"category": "Social media", "name": "X post", "width": 1200.0, "height": 675.0}),
  Object.freeze({"category": "Social media", "name": "LinkedIn post", "width": 1200.0, "height": 1200.0}),
  Object.freeze({"category": "Social media", "name": "YouTube thumbnail", "width": 1280.0, "height": 720.0}),
  Object.freeze({"category": "Social media", "name": "Dribbble shot", "width": 1600.0, "height": 1200.0}),
]);

export function presetParameters(document: Document, view: Viewport, params: Record<string, unknown>): Record<string, unknown> {
  if (params.preset === undefined) return params;
  const name = parseString(params.preset);
  const preset = framePresets.find(item => item.name.toLowerCase() === name?.toLowerCase());
  if (!preset) throw new Error(`Unknown frame preset: ${String(params.preset)}`);
  const { preset: ignored, ...rest } = params;
  const result: Record<string, unknown> = { width: preset.width, height: preset.height, name: preset.name, ...rest };
  const numeric = (value: unknown) => { try { return parseNumber(value); } catch { return undefined; } };
  if (numeric(params.x) === undefined && numeric(params.y) === undefined && parseNodeId(params.parent) === undefined) {
    let rightmost: ReturnType<typeof boundsOf>;
    for (const id of pageOf(document).children) {
      const bounds = boundsOf(document, [id]);
      if (bounds && (!rightmost || bounds.x + bounds.width >= rightmost.x + rightmost.width)) rightmost = bounds;
    }
    result.x = pixelRound(rightmost ? rightmost.x + rightmost.width + 100 : view.cx - preset.width / 2);
    result.y = pixelRound(rightmost ? rightmost.y : view.cy - preset.height / 2);
  }
  return result;
}
