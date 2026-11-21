import { describe, it } from "vitest";
import fixture from "../fixtures/native-escape.json";
import { replaySession, type SessionCase } from "../support/native-session";

// Escape clears the selection whatever its nesting; it never selects the parent. It still leaves vector editing,
// ends moving the rotation origin and returns to the Move tool first. Observed through the native engine at
// bad07e44 (upstream a285fd29, 92cf9849; tests/fixtures/native-escape.provenance.md). The sessions restate
// crates/engine/src/selection_behaviour_tests.rs.

const cases = fixture.cases as unknown as SessionCase[];

describe("native Escape", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    replaySession(c, command => command === "node.get");
  });
});
