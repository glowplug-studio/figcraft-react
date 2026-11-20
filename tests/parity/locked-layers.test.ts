import { describe, it } from "vitest";
import fixture from "../fixtures/native-locked-layers.json";
import { replaySession, type SessionCase } from "../support/native-session";

// Locked layers: the canvas never selects one or a locked frame's child, the arrow keys leave it alone, its
// properties still edit, a child of a locked frame can't be locked or unlocked on its own, and Select layer lists
// locked layers with a flag. Observed through the native engine at bad07e44 (upstream 24cf7032, 6cb015d4; #1560;
// tests/fixtures/native-locked-layers.provenance.md). The sequences restate
// crates/engine/src/lock_behaviour_tests.rs and crates/engine/src/selection_depth_tests.rs.

const cases = fixture.cases as unknown as SessionCase[];

describe("native locked layers", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    replaySession(c, command => command === "node.get" || command === "object.toggleLock" || command === "object.toggleVisible" || command === "select.layersAt");
  });
});
