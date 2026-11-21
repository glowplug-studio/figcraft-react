import { describe, it } from "vitest";
import fixture from "../fixtures/native-snap-distance.json";
import { replaySession, type SessionCase } from "../support/native-session";

// Objects snap within 4.5 screen pixels: a move, a resize, a drawn shape and a dragged vector point snap at a gap of
// 4.4 and 4.5 and not at 4.6, at 100% and at 200% zoom. Observed through the native engine at bad07e44 (upstream
// a1980463, ebe0a8c2; tests/fixtures/native-snap-distance.provenance.md).

const cases = fixture.cases as unknown as SessionCase[];

describe("native object snap distance", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    replaySession(c, command => command === "node.get", true);
  });
});
