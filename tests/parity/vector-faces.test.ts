import { describe, expect, it } from "vitest";
import { vectorFaceAt, vectorFaces } from "../../src/engine/vector-faces";
import { networkFromPoints, vectorLine, vectorVertex, type VectorNetwork } from "../../src/engine/vector-network";

function square(x: number, y: number, size: number): VectorNetwork {
  return networkFromPoints([{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }], true);
}
function combine(...pieces: VectorNetwork[]): VectorNetwork {
  const vertices = [], segments = [];
  for (const piece of pieces) {
    const offset = vertices.length;
    vertices.push(...piece.vertices);
    segments.push(...piece.segments.map(s => ({ ...s, a: s.a + offset, b: s.b + offset })));
  }
  return { vertices, segments, regions: [] };
}
describe("native bounded vector faces", () => {
  it("walks both sides of a diagonal and ignores the exterior", () => {
    const net = square(0, 0, 100);
    expect(vectorFaces(net)[0].area).toBeCloseTo(10000, 8);
    const faces = vectorFaces({ ...net, segments: [...net.segments, vectorLine(0, 2)] });
    expect(faces).toHaveLength(2);
    faces.forEach(face => expect(face.area).toBeCloseTo(5000, 8));
    expect(vectorFaceAt(faces, { x: 75, y: 25 })).not.toBe(vectorFaceAt(faces, { x: 25, y: 75 }));
    expect(vectorFaceAt(faces, { x: 150, y: 50 })).toBeUndefined();
  });
  it("subtracts only the immediately nested piece", () => {
    const faces = vectorFaces(combine(square(0, 0, 100), square(25, 25, 50), square(45, 45, 10)));
    expect(faces).toHaveLength(3);
    for (const [x, area, loops] of [[10, 7500, 2], [30, 2400, 2], [50, 100, 1]]) {
      const face = vectorFaceAt(faces, { x, y: x });
      expect(face?.area).toBeCloseTo(area, 8);
      expect(face?.loops).toHaveLength(loops);
    }
  });
  it("drops twice-walked bridges and spurs from a face", () => {
    const net = combine(square(0, 0, 100), square(60, 60, 20));
    const faces = vectorFaces({ ...net, vertices: [...net.vertices, vectorVertex(50, 50)],
      segments: [...net.segments, vectorLine(0, 8), vectorLine(8, 4)] });
    const ring = vectorFaceAt(faces, { x: 10, y: 90 });
    expect(ring?.area).toBeCloseTo(9600, 8);
    expect(ring?.loops.map(loop => loop.length)).toEqual([4, 4]);
  });
  it("integrates a curved self-loop and skips a broken endpoint", () => {
    const faces = vectorFaces({ vertices: [vectorVertex(0, 0)], segments: [
      { a: 0, b: 0, ta: [100, 0], tb: [0, 100] }, vectorLine(0, 99)], regions: [] });
    expect(faces).toHaveLength(1);
    expect(faces[0].area).toBeCloseTo(1500, 8);
    expect(vectorFaceAt(faces, { x: 10, y: 10 })).toBe(faces[0]);
  });
});
