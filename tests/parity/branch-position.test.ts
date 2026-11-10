import { expect, it } from "vitest";
import oracle from "../fixtures/native-branch-position-keys.json";
import { positionKeys, siblingPositions } from "../../src/engine/branch-position";

it.each(oracle)("replays pinned native positions between $lower and $upper for $count siblings", check => {
  const run = () => positionKeys(check.lower ?? undefined, check.upper ?? undefined, check.count);
  if (check.error) expect(run).toThrow(check.error);
  else expect(run()).toEqual(check.keys);
});

it("retains the longest run when peers reorder siblings or insert between the same neighbours", () => {
  const original = new Map([["1", "a0"], ["2", "a1"], ["3", "a2"], ["4", "a3"]]);
  const positions = (ids: string[]) => siblingPositions(ids, id => original.get(id));
  expect([...positions(["1", "3", "4", "2"])]).toEqual([["1", "a0"], ["3", "a2"], ["4", "a3"], ["2", "a4"]]);
  expect(positions(["1", "5", "2"]).get("5")).toBe(positions(["1", "6", "2"]).get("6"));
});
