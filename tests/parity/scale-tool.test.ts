import { describe, it } from "vitest";
import fixture from "../fixtures/native-scale-tool.json";
import { replaySession, type SessionCase } from "../support/native-session";

// A Scale tool handle drag pivots on the opposite handle's point, or on the centre with Alt, whatever the origin
// grid says; the origin is used by the Scale field only and starts at the centre. Observed through the native
// engine at bad07e44 (upstream f0d39197; tests/fixtures/native-scale-tool.provenance.md). The sessions restate
// crates/engine/src/scale_tool_tests.rs.

const cases = fixture.cases as unknown as SessionCase[];

describe("native Scale tool drags and origin", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    replaySession(c, command => command === "node.get" || command === "tool.scaleAnchor", true);
  });
});
