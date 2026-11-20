import { describe, it } from "vitest";
import fixture from "../fixtures/native-count-handle.json";
import { replaySession, type SessionCase } from "../support/native-session";

// A selected polygon or star has a Count handle on its first point clockwise from the top. Dragging it sets the
// point count from the pointer's angle about the centre: round(360 / angle), 3 to 60. Observed through the native
// engine at bad07e44 (upstream 89d8b50e, d773ab29; tests/fixtures/native-count-handle.provenance.md). The sessions
// restate crates/engine/src/shape_handles_tests.rs.

const cases = fixture.cases as unknown as SessionCase[];

describe("native Count handle of polygons and stars", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    // Nine decimals: a radius drag in one session differs from native in the fifteenth digit.
    replaySession(c, command => command === "node.get", true);
  });
});
