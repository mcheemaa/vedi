import { chQuery } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

type PerceptRow = {
  frame_id: string;
  ts: string;
  region_id: number;
  keyframe: number;
  embedding: number[];
};

/** The brain as geometry: recent embeddings projected to 3D with PCA
 * computed here on the sample. Honest coordinates from the real
 * vectors; no decorative randomness. */
export async function GET() {
  const rows = await chQuery<PerceptRow>(`
    SELECT frame_id, ts, region_id, keyframe, embedding
    FROM vedi.percepts
    WHERE ts > now() - INTERVAL 24 HOUR
    ORDER BY ts DESC LIMIT 1600`);

  if (rows.length < 8) return Response.json({ points: [], latest: null });

  const dim = rows[0].embedding.length;
  const n = rows.length;

  const mean = new Float64Array(dim);
  for (const row of rows) {
    for (let i = 0; i < dim; i++) mean[i] += row.embedding[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= n;

  const centered = rows.map((row) => {
    const v = new Float64Array(dim);
    for (let i = 0; i < dim; i++) v[i] = row.embedding[i] - mean[i];
    return v;
  });

  const axes = principalAxes(centered, dim, 3);
  const points = rows.map((row, index) => {
    const v = centered[index];
    return {
      id: row.frame_id,
      ts: row.ts,
      region: row.region_id,
      keyframe: row.keyframe === 1,
      p: axes.map((axis) => round(dot(v, axis))),
    };
  });

  // Region anchors: labeled centroids in the projected space, so the
  // constellations can introduce themselves.
  const labels = await chQuery<{ region_id: number; label: string }>(
    "SELECT region_id, label FROM vedi.regions FINAL WHERE label != ''",
  );
  const labelMap = new Map(labels.map((row) => [row.region_id, row.label]));
  const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
  for (const point of points) {
    const sum = sums.get(point.region) ?? { x: 0, y: 0, z: 0, n: 0 };
    sum.x += point.p[0];
    sum.y += point.p[1];
    sum.z += point.p[2];
    sum.n += 1;
    sums.set(point.region, sum);
  }
  const anchors = [...sums.entries()]
    .filter(([region, sum]) => labelMap.has(region) && sum.n >= 12)
    .map(([region, sum]) => ({
      region,
      label: labelMap.get(region) as string,
      p: [round(sum.x / sum.n), round(sum.y / sum.n), round(sum.z / sum.n)],
    }));

  // Chronological order for the replay scrub.
  points.sort((a, b) => a.ts.localeCompare(b.ts));
  return Response.json({ points, latest: rows[0]?.frame_id ?? null, anchors });
}

/** Top eigenvectors by power iteration with deflation: exact enough
 * for layout, dependency-free, and linear in sample size. */
function principalAxes(centered: Float64Array[], dim: number, count: number): Float64Array[] {
  const axes: Float64Array[] = [];
  for (let a = 0; a < count; a++) {
    let axis = seeded(dim, a);
    for (let iter = 0; iter < 24; iter++) {
      const next = new Float64Array(dim);
      for (const v of centered) {
        let projection = dot(v, axis);
        for (const prior of axes) {
          projection -= dot(v, prior) * dot(axis, prior);
        }
        for (let i = 0; i < dim; i++) next[i] += projection * v[i];
      }
      for (const prior of axes) {
        const overlap = dot(next, prior);
        for (let i = 0; i < dim; i++) next[i] -= overlap * prior[i];
      }
      axis = normalize(next);
    }
    axes.push(axis);
  }
  return axes;
}

function seeded(dim: number, offset: number): Float64Array {
  const v = new Float64Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(i * 12.9898 + offset * 78.233) * 43758.5453 % 1;
  return normalize(v);
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function normalize(v: Float64Array): Float64Array {
  const norm = Math.sqrt(dot(v, v)) || 1;
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
