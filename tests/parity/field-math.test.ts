import {expect,it} from "vitest";
import {fieldValue,parseFieldEdit,steppedField} from "../../src/engine/field-math";

it.each([
  ["3px + 2 px",5], ["10 °",10], ["+(4*3)",32], ["50%",10], ["+10%",22], ["-10%",18], ["*50%",10],
  ["/50%",40], ["2,5*(4-1)",7.5], ["--2",2], ["1/0",undefined], ["/0",undefined], ["2e5",undefined],
  ["1+2 3",undefined],["(",undefined],["+".repeat(257),undefined],
] as const)("interprets %s like the native field at 20", (expression, expected) => {
  expect(fieldValue(parseFieldEdit(expression),20)).toBe(expected);
});
it("settles a mixed additive field and preserves percentage units, bounds and very large steps", () => {
  expect(fieldValue(parseFieldEdit("+4"))).toBe(4);
  expect(fieldValue(parseFieldEdit("*4"))).toBeUndefined();
  expect(fieldValue(parseFieldEdit("50 %",true),20)).toBe(50);
  expect(parseFieldEdit("(".repeat(33)+"4"+")".repeat(33))).toBeUndefined();
  expect(steppedField(.2,-3,.1)).toBe(-.1);
  expect(steppedField(1e305,1,1)).toBe(1e305);
});

it("accepts Unicode White_Space and rejects a byte-order mark like Rust", () => {
  expect(fieldValue(parseFieldEdit("\u00851\u0085+ 2"))).toBe(3);
  expect(parseFieldEdit("\ufeff1")).toBeUndefined();
});
