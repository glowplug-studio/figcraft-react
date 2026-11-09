// Native glass.rs computes Euclidean distances on pixel centres. Equal
// distances select the earlier column, then the earlier row within it.
const FAR = 1e20;
export const NO_GLASS_SITE = 0xffffffff;

function transformLine(input: Float64Array, length: number, sites: Uint32Array,
  starts: Float64Array, nearest: Uint32Array, distance: Float64Array) {
  let last = 0;
  sites[0] = 0;
  starts[0] = -Infinity;
  starts[1] = Infinity;
  for (let q = 1; q < length; q++) {
    let boundary: number;
    for (;;) {
      const p = sites[last];
      boundary = ((input[q] + q * q) - (input[p] + p * p)) / (2 * (q - p));
      if (!last || boundary > starts[last]) break;
      last--;
    }
    sites[++last] = q;
    starts[last] = boundary;
    starts[last + 1] = Infinity;
  }
  let k = 0;
  for (let q = 0; q < length; q++) {
    while (starts[k + 1] < q) k++;
    const p = sites[k];
    nearest[q] = p;
    distance[q] = (q - p) ** 2 + input[p];
  }
}

export function nearestGlassSites(mask: Uint8Array, width: number, height: number) {
  const length = Math.max(width, height);
  const input = new Float64Array(length), distances = new Float64Array(length);
  const sites = new Uint32Array(length), nearest = new Uint32Array(length);
  const starts = new Float64Array(length + 1);
  const columnDistances = new Float64Array(width * height);
  const columnRows = new Uint32Array(width * height);
  const result = new Uint32Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) input[y] = mask[y * width + x] ? 0 : FAR;
    transformLine(input, height, sites, starts, nearest, distances);
    for (let y = 0; y < height; y++) {
      columnDistances[y * width + x] = distances[y];
      columnRows[y * width + x] = nearest[y];
    }
  }
  for (let y = 0; y < height; y++) {
    const start = y * width;
    input.set(columnDistances.subarray(start, start + width));
    transformLine(input, width, sites, starts, nearest, distances);
    for (let x = 0; x < width; x++) {
      const sx = nearest[x];
      result[start + x] = distances[x] < FAR / 2 ? columnRows[start + sx] * width + sx : NO_GLASS_SITE;
    }
  }
  return result;
}

/** Distance inside the half-covered outline, in device pixels. */
export function glassInsideDistance(alpha: Uint8Array, width: number, height: number) {
  const sites = nearestGlassSites(alpha.map(a => Number(a < 128)), width, height);
  const result = new Float32Array(sites.length);
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    if (site === i) continue;
    const dx = i % width - site % width;
    const dy = Math.floor(i / width) - Math.floor(site / width);
    result[i] = Math.sqrt(site === NO_GLASS_SITE ? FAR : dx * dx + dy * dy) - 0.5;
  }
  return result;
}

function boxPass(source: Float32Array, dest: Float32Array, lines: number, length: number,
  stride: number, across: number, radius: number) {
  const f = Math.fround, scale = f(1 / (2 * radius + 1));
  for (let line = 0; line < lines; line++) {
    const base = line * across;
    let sum = 0;
    for (let j = 0; j <= Math.min(radius, length - 1); j++) sum = f(sum + source[base + j * stride]);
    for (let i = 0; i < length; i++) {
      dest[base + i * stride] = sum * scale;
      if (i + radius + 1 < length) sum = f(sum + source[base + (i + radius + 1) * stride]);
      if (i >= radius) sum = f(sum - source[base + (i - radius) * stride]);
    }
  }
}

function smoothUnits(x: Float32Array, y: Float32Array, width: number, height: number, radius: number, passes: number) {
  const scratch = new Float32Array(x.length);
  for (const component of [x, y]) {
    for (let i = 0; i < passes; i++) {
      boxPass(component, scratch, height, width, 1, width, radius);
      boxPass(scratch, component, width, height, width, 1, radius);
    }
  }
  for (let i = 0; i < x.length; i++) {
    const length = Math.hypot(x[i], y[i]);
    x[i] = length > 1e-4 ? x[i] / length : 0;
    y[i] = length > 1e-4 ? y[i] / length : 0;
  }
  return { x, y };
}

export function glassNormals(distance: Float32Array, width: number, height: number, radius: number) {
  const gx = new Float32Array(distance.length), gy = new Float32Array(distance.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      gx[i] = (distance[i + 1] - distance[i - 1]) / 2;
      gy[i] = (distance[i + width] - distance[i - width]) / 2;
    }
  }
  return smoothUnits(gx, gy, width, height, radius, 2);
}

export function glassBendDirections(distance: Float32Array, width: number, height: number, reach: number, radius: number) {
  // Native ridge window is always five by five. Two separable max passes
  // keep scratch storage to one field and avoid a deque per line.
  const rowMax = new Float32Array(distance.length);
  const core = new Uint8Array(distance.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let max = distance[i];
      for (let j = Math.max(0, x - 2); j <= Math.min(width - 1, x + 2); j++) max = Math.max(max, distance[y * width + j]);
      rowMax[i] = max;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let max = rowMax[i];
      for (let j = Math.max(0, y - 2); j <= Math.min(height - 1, y + 2); j++) max = Math.max(max, rowMax[j * width + x]);
      core[i] = Number(distance[i] > 0 && (distance[i] >= reach - .001 || distance[i] >= max - 1.001));
    }
  }
  const near = nearestGlassSites(core, width, height);
  const gx = new Float32Array(distance.length), gy = new Float32Array(distance.length);
  for (let i = 0; i < near.length; i++) {
    const site = near[i];
    if (site === NO_GLASS_SITE || distance[i] <= 0 || site === i) continue;
    const dx = site % width - i % width, dy = Math.floor(site / width) - Math.floor(i / width);
    const length = Math.hypot(dx, dy);
    gx[i] = dx / length;
    gy[i] = dy / length;
  }
  return smoothUnits(gx, gy, width, height, radius, 1);
}
