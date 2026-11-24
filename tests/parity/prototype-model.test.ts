import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { PrototypeEasing, PrototypeTransition } from "../../src/engine/prototype-data";
import { easingNames } from "../../src/engine/prototype-data";
import { acceptsDrag, customBezier, customSpring, easingSeconds, easingSpring, evalEasing, firesOnKey, gamepadButton, gamepadButtons, keyCombo, noMods, reversedTransition, splitKey, triggerLabel, usesGamepad, type KeyMods } from "../../src/engine/prototype-model";

// Restated from native engine/src/proto_behaviour_tests.rs and proto_tail_tests.rs at bad07e44.
describe("prototype model rules, as native's tests pin them", () => {
  it("starts an on drag animation only for a drag its way", () => {
    const push = (direction: "left" | "right"): PrototypeTransition => ({ type: "push", direction });
    const cases: [PrototypeTransition, number, number, boolean][] = [
      [push("left"), -40, 5, true], [push("left"), 40, 0, false], [push("left"), -10, 30, false], [push("right"), 25, -3, true],
      [{ type: "moveIn", direction: "top" }, 0, -25, true], [{ type: "moveOut", direction: "top" }, 0, 25, false],
      [{ type: "slideOut", direction: "bottom" }, 3, 25, true], [{ type: "slideIn", direction: "right" }, 20, -20, true],
      [{ type: "smartAnimate" }, 0, 30, true], [{ type: "dissolve" }, -30, 0, true], [{ type: "instant" }, 7, 0, true],
    ];
    for (const [t, dx, dy, want] of cases) expect(acceptsDrag(t, dx, dy), JSON.stringify([t, dx, dy])).toBe(want);
  });

  it("fires key triggers for their key or combination", () => {
    const shift = { ...noMods, shift: true }, ctrlShift = { ...noMods, ctrl: true, shift: true }, altCmd = { ...noMods, alt: true, cmd: true };
    const cases: [string, string, KeyMods, boolean][] = [
      ["K", "K", noMods, true], ["k", "K", noMods, true], ["K", "K", shift, false], ["Shift+K", "K", shift, true], ["Shift+K", "K", noMods, false],
      ["Ctrl+Shift+K", "K", ctrlShift, true], ["Ctrl+Shift+K", "K", shift, false], ["Command+Option+K", "K", altCmd, true],
      ["Space", "Space", noMods, true], ["space", "Space", noMods, true], ["Return", "Enter", noMods, true], ["←", "ArrowLeft", noMods, true],
      ["Shift+Space", "Space", shift, true], ["J", "K", noMods, false],
    ];
    for (const [want, key, mods, fires] of cases) expect(firesOnKey({ type: "keyPress", key: want }, key, mods), `${want} vs ${key}`).toBe(fires);
    expect(firesOnKey({ type: "onClick" }, "K", noMods)).toBe(false);
    for (let bits = 0; bits < 16; bits++) {
      const m = { ctrl: !!(bits & 1), alt: !!(bits & 2), shift: !!(bits & 4), cmd: !!(bits & 8) };
      expect(splitKey(keyCombo(m, "K"))).toEqual([m, "K"]);
    }
    expect(keyCombo(ctrlShift, "K")).toBe("Ctrl+Shift+K");
    expect(splitKey("Ctrl++")).toEqual([{ ...noMods, ctrl: true }, "+"]);
    expect(splitKey("+")).toEqual([noMods, "+"]);
    expect(splitKey("Hyper+K")).toEqual([noMods, "Hyper+K"]);
  });

  it("eases with curves and physical springs", () => {
    const all: PrototypeEasing[] = [...easingNames, customBezier, customSpring];
    for (const e of all) expect(Math.abs(evalEasing(e, 0)) < 1e-9 && Math.abs(evalEasing(e, 1) - 1) < 1e-9, JSON.stringify(e)).toBe(true);
    expect(evalEasing("linear", 0.3)).toBe(0.3);
    expect(evalEasing("easeIn", 0.25)).toBeLessThan(0.25);
    expect(evalEasing("easeOut", 0.25)).toBeGreaterThan(0.25);
    expect(Math.abs(evalEasing("easeInOut", 0.5) - 0.5)).toBeLessThan(1e-9);
    const curve = (e: PrototypeEasing) => Array.from({ length: 101 }, (_, i) => evalEasing(e, i / 100));
    expect(curve("easeInBack").some(v => v < -0.05)).toBe(true);
    expect(curve("easeOutBack").some(v => v > 1.05)).toBe(true);
    const springs: [PrototypeEasing, number, number, number][] = [["gentle", 0.75, 0.028, 0.92], ["quick", 0.577, 0.108, 0.69], ["bouncy", 0.306, 0.36, 0.92], ["slow", 1.118, 0, 1.66]];
    for (const [e, zeta, overshoot, secs] of springs) {
      const [m, k, c] = easingSpring(e)!;
      expect(Math.abs(c / (2 * Math.sqrt(k * m)) - zeta)).toBeLessThan(1e-3);
      const peak = Math.max(0, ...curve(e)) - 1;
      expect(Math.abs(Math.max(peak, 0) - overshoot), String(e)).toBeLessThan(0.01);
      expect(Math.abs(easingSeconds(e, 300) - secs), String(e)).toBeLessThan(0.01);
      expect(easingSeconds(e, 300)).toBe(easingSeconds(e, 5000));
      expect(Math.abs(evalEasing(e, 0.98) - 1)).toBeLessThan(0.005);
    }
    expect(easingSeconds("easeOut", 300)).toBe(0.3);
    expect(easingSeconds(customBezier, 1200)).toBe(1.2);
    for (const e of [{ customSpring: { mass: 0, stiffness: -1, damping: NaN } }, { customSpring: { mass: 1e300, stiffness: 1e-300, damping: 0 } }, { customSpring: { mass: 1, stiffness: 100, damping: 1e9 } }]) {
      const s = easingSeconds(e, 300);
      expect(s >= 0.05 && s <= 10, JSON.stringify(e)).toBe(true);
      expect(curve(e).every(Number.isFinite)).toBe(true);
    }
  });

  it("plays Back and reverting states the other way", () => {
    const cases: [PrototypeTransition, PrototypeTransition][] = [
      [{ type: "moveIn", direction: "left" }, { type: "moveOut", direction: "right" }], [{ type: "moveOut", direction: "top" }, { type: "moveIn", direction: "bottom" }],
      [{ type: "push", direction: "left" }, { type: "push", direction: "right" }], [{ type: "slideIn", direction: "top" }, { type: "slideOut", direction: "bottom" }],
      [{ type: "slideOut", direction: "left" }, { type: "slideIn", direction: "right" }], [{ type: "dissolve" }, { type: "dissolve" }],
      [{ type: "smartAnimate" }, { type: "smartAnimate" }], [{ type: "instant" }, { type: "instant" }],
    ];
    for (const [fwd, back] of cases) { expect(reversedTransition(fwd)).toEqual(back); expect(reversedTransition(back)).toEqual(fwd); }
  });

  it("fires key triggers for controller buttons, and polls only prototypes that use them", () => {
    const shift = { ...noMods, shift: true };
    const cases: [string, string, KeyMods, boolean][] = [
      ["Gamepad A", "Gamepad A", noMods, true], ["gamepad a", "Gamepad A", noMods, true], ["Gamepad A", "Gamepad B", noMods, false],
      ["Gamepad A", "A", noMods, false], ["A", "Gamepad A", noMods, false], ["Gamepad Up", "ArrowUp", noMods, false], ["Gamepad A", "Gamepad A", shift, false],
    ];
    for (const [want, key, mods, fires] of cases) expect(firesOnKey({ type: "keyPress", key: want }, key, mods), `${want} vs ${key}`).toBe(fires);
    expect(gamepadButton(0)).toBe("Gamepad A");
    expect(gamepadButton(16)).toBe("Gamepad Home");
    expect(gamepadButton(17)).toBeUndefined();
    expect(new Set(gamepadButtons).size).toBe(gamepadButtons.length);
    const e = new EditorEngine();
    const a = Number((e.execute("frame.create", { x: 0, y: 0, width: 100, height: 100 }) as { id: string }).id);
    expect(usesGamepad(e.getSnapshot().document)).toBe(false);
    e.execute("proto.interaction.add", { id: a, trigger: { type: "keyPress", key: "Gamepad Menu" }, action: { type: "back" } });
    expect(e.getSnapshot().document.nodes[String(a)].interactions![0].trigger).toEqual({ type: "keyPress", key: "Gamepad Menu" });
    expect(usesGamepad(e.getSnapshot().document)).toBe(true);
    expect(triggerLabel({ type: "keyPress", key: "Gamepad Menu" })).toBe("Gamepad Menu");
    expect(triggerLabel({ type: "keyPress", key: "K" })).toBe("Key/Gamepad K");
  });
});
