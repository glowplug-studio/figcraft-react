import { describe, it } from "vitest";
import fixture from "../fixtures/native-marquee.json";
import { replaySession, type SessionCase } from "../support/native-session";

// Marquee selection follows the rules upstream measured in the target application: each top-level layer the marquee
// touches is selected whole, a partly covered frame or section gives the layers in it the marquee touches, an
// enclosed one is selected itself, the frame the drag started in comes whole only when another top-level frame is
// taken, and a rotated shape is touched by its outline. Observed through the native engine at bad07e44 (upstream
// cb526214, 604c7846; tests/fixtures/native-marquee.provenance.md). The sessions restate
// crates/engine/src/marquee_behaviour_tests.rs.

const cases = fixture.cases as unknown as SessionCase[];

describe("native marquee selection", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    replaySession(c, command => command === "node.get");
  });
});
