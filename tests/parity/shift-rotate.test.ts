import { describe, it } from "vitest";
import fixture from "../fixtures/native-shift-rotate.json";
import { replaySession, type SessionCase } from "../support/native-session";

// Shift while rotating lands the rotation on a multiple of 15 degrees, not on 15 degree steps from where the drag
// began: a layer at 7 degrees turned by 37 ends at 45. The rotation is the one on the page, so it holds inside a
// rotated frame, and layers that share no rotation round the turn as before. Observed through the native engine at
// bad07e44 (upstream a1ac22f1, da81d55a; tests/fixtures/native-shift-rotate.provenance.md). The sessions restate
// crates/engine/src/transform_behaviour_tests.rs.

const cases = fixture.cases as unknown as SessionCase[];

describe("native Shift while rotating", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    replaySession(c, command => command === "node.get", true);
  });
});
