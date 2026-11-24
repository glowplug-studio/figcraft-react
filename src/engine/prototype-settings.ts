import { toCssHex, type Colour } from "./colour";

// Native `to_hex`: RRGGBB, alpha dropped.
const hex = (c: Colour) => "#" + toCssHex({ ...c, a: 1 }).slice(1, 7);

/** Source: upstream doc/src/proto.rs `PrototypeSettings`, `Device`, `DeviceColor`. */
export type DeviceRotation = "portrait" | "landscape";
export interface DeviceColour { readonly name: string; readonly rgb: readonly [number, number, number] }
export interface Device { readonly name: string; readonly width: number; readonly height: number; readonly rotates: boolean; readonly colors: readonly DeviceColour[] }
/** A page's prototype device settings other than its background (all default when absent). */
export interface PrototypeDevice {
  readonly device: string;
  readonly rotation: DeviceRotation;
  readonly color: string;
  readonly customSize: readonly [number, number];
  readonly responsive: boolean;
}
export const customDevice = "Custom size";
export const customDefault: readonly [number, number] = Object.freeze([1280, 720]);
export const customMax = 10_000;
export const defaultPrototypeDevice: PrototypeDevice = Object.freeze({ device: "None", rotation: "portrait", color: "", customSize: customDefault, responsive: false });

const c = (name: string, r: number, g: number, b: number): DeviceColour => Object.freeze({ name, rgb: Object.freeze([r, g, b] as const) });
const black1 = c("Black", 0x38, 0x39, 0x3d), silver1 = c("Silver", 0xd7, 0xd7, 0xd5);
const black2 = c("Black", 0x3a, 0x3b, 0x3f), white2 = c("White", 0xee, 0xed, 0xe8);
const black3 = c("Black", 0x3b, 0x3a, 0x38), white3 = c("White", 0xec, 0xeb, 0xe6);
const phone = (name: string, width: number, height: number, colors: DeviceColour[]): Device => Object.freeze({ name, width, height, rotates: true, colors: Object.freeze(colors) });
/** Native `PrototypeSettings::DEVICES`: the devices to pick from, screens in points held upright. */
export const devices: readonly Device[] = Object.freeze([
  phone("iPhone 17", 402, 874, [black1, c("White", 0xe9, 0xe9, 0xe5)]),
  phone("iPhone 17 Pro", 402, 874, [black1, silver1]),
  phone("iPhone 17 Pro Max", 440, 956, [black1, silver1]),
  phone("iPhone Air", 420, 912, [black1, silver1]),
  phone("iPhone 16", 393, 852, [black2, white2, c("Pink", 0xec, 0xbf, 0xcb), c("Teal", 0xa3, 0xcf, 0xc6), c("Blue", 0x72, 0x84, 0xd4)]),
  phone("iPhone 16 Pro", 402, 874, [black3, white3]),
  phone("iPhone 16 Pro Max", 440, 956, [black3, white3, c("Natural", 0xbf, 0xb9, 0xaf), c("Sand", 0xc6, 0xac, 0x8f)]),
  phone("iPhone 16 Plus", 430, 932, [black2, white2]),
  phone("iPhone 15 Pro", 393, 852, [black3, silver1]),
  phone("iPhone 15 Pro Max", 430, 932, [black3, silver1]),
  phone("iPhone 15 Plus", 430, 932, [black2, white2]),
  phone("iPhone 14 Pro", 393, 852, [black3, silver1]),
  phone("iPhone 14 Pro Max", 430, 932, [black3, silver1]),
  phone("iPhone 14", 390, 844, [black2, white2]),
  phone("Android Compact", 412, 917, [c("Black", 0x2e, 0x2f, 0x33), c("Silver", 0xd6, 0xd8, 0xdb), c("Green", 0xa6, 0xc0, 0xa3)]),
  phone("Android Medium", 700, 840, [c("Black", 0x2e, 0x2f, 0x33), c("Silver", 0xd6, 0xd8, 0xdb)]),
  phone("iPad mini", 744, 1133, [c("Grey", 0x6a, 0x6b, 0x6f), c("Silver", 0xe0, 0xe1, 0xe3), c("Blue", 0x9c, 0xb1, 0xc9), c("Purple", 0xc6, 0xbc, 0xd7)]),
  Object.freeze({ name: "MacBook Air", width: 1280, height: 832, rotates: false, colors: Object.freeze([c("Silver", 0xc9, 0xca, 0xce), c("Grey", 0x7b, 0x7c, 0x80), c("Dark blue", 0x2e, 0x33, 0x3d), c("Cream", 0xe0, 0xd9, 0xcb)]) }),
  Object.freeze({ name: "Desktop", width: 1440, height: 1024, rotates: false, colors: Object.freeze([c("Silver", 0xb8, 0xb9, 0xbd), c("Black", 0x2c, 0x2c, 0x2e)]) }),
]);

/** Native `custom_side`: finite, at least 1, at most 10,000, rounded. */
export function customSide(v: number): number | undefined {
  return Number.isFinite(v) && v >= 1 ? Math.round(Math.min(v, customMax)) : undefined;
}
/** Native `DeviceRotation::parse`. */
export function parseRotation(v: string): DeviceRotation | undefined {
  const t = v.trim().toLowerCase();
  return t === "portrait" || t === "0" || t === "none" ? "portrait" : t === "landscape" || t === "90" || t === "ccw_90" ? "landscape" : undefined;
}
/** Native `model`: the chosen device held upright. */
export function deviceModel(s: PrototypeDevice): Device | undefined {
  if (s.device === customDevice) {
    return { name: customDevice, width: customSide(s.customSize[0]) ?? customDefault[0], height: customSide(s.customSize[1]) ?? customDefault[1], rotates: false, colors: [] };
  }
  return devices.find(d => d.name === s.device);
}
export function deviceColour(s: PrototypeDevice): DeviceColour | undefined {
  const colors = deviceModel(s)?.colors ?? [];
  return colors.find(x => x.name === s.color) ?? colors[0];
}
/** Native `device`: as presented, wider than tall when a device that turns is turned. */
export function presentedDevice(s: PrototypeDevice): Device | undefined {
  const d = deviceModel(s);
  if (!d) return undefined;
  return s.rotation === "landscape" && d.rotates ? { ...d, width: d.height, height: d.width } : d;
}
/** Native `known_device`: "None", "Custom size" or a device, any case, spaces trimmed. */
export function knownDevice(name: string): string | undefined {
  const t = name.trim().toLowerCase();
  return ["None", customDevice, ...devices.map(d => d.name)].find(d => d.toLowerCase() === t);
}
/** Native `settings_json`. */
export function settingsJson(s: PrototypeDevice, background: Colour) {
  const screen = presentedDevice(s);
  return { ok: true, device: s.device, background: hex(background), rotation: s.rotation, color: deviceColour(s)?.name ?? null,
    screen: screen ? { width: screen.width, height: screen.height } : null, customSize: { width: s.customSize[0], height: s.customSize[1] }, responsive: s.responsive };
}

export const samePrototypeDevice = (a: PrototypeDevice, b: PrototypeDevice) =>
  a.device === b.device && a.rotation === b.rotation && a.color === b.color && a.customSize[0] === b.customSize[0] && a.customSize[1] === b.customSize[1] && a.responsive === b.responsive;
