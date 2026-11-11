// The meaning layout: the map lays out what the code is *for*, not where it
// lives. Sections are grouped into intent zones by what they say they do
// (their plain words, sentences, journeys and function names) and by how much
// work flows between them; directory and language play no part.
//
//   1. Words → vectors. Each section's text (its plain name and sentence, the
//      plain words of every block inside it, its journeys, its theme and its
//      function names) is tokenised, stop words dropped, lightly stemmed and
//      weighted TF-IDF, so words every section shares count for little.
//   2. Affinity. sim(a, b) = 0.6 · cosine(words) + 0.4 · flow(a, b), where
//      flow is the two-way flow weight between them over the map's heaviest
//      flow. Code that means the same thing or works together sits together.
//   3. Zones. When the model named product areas (the kula-map skill's
//      `area`, what the person is trying to get done), those areas are the
//      zones – intent as the model read it – and a section without one joins
//      the zone it is most like. Otherwise: average-linkage agglomerative clustering on sim until k zones
//      remain (k ≈ √(0.8 n), 3–9) or no pair is similar enough to merge.
//      Tests always form their own zone. A zone is named by its medoid – the
//      member most like the rest – so the name is one of the model's own.
//   4. Order. Zones read left to right in the direction work flows: each
//      zone's net outflow (out – in) ranks it, so where things start is on
//      the left and where they end up is on the right. Zones that barely
//      talk to the rest (< 8% of the busiest zone's outside flow) follow
//      the main line; tests sit last.
//   5. Neat wires. Within a zone, members are sorted by the barycentre of
//      the zones they talk to (two sweeps, left then right), so a wire leaves
//      a square on the side it heads towards and crossings drop.
//   6. Colour = zone. Hues step round the wheel by the golden angle, so
//      neighbouring zones never share a colour; every square, frame and wire
//      of a zone carries it.

export interface MeaningSection { id: string; text: string; role: string; plain?: string; area?: string }
export interface MeaningFlow { from: string; to: string; weight: number }
export interface Zone { id: string; name: string; hue: string; members: string[]; rank: number }

const STOP = new Set(("the a an and or of to in on for with from by is are be it its this that as at into your you our their " +
  "each every all any one two its what when how which who will can may lets let gets get set sets makes make uses use " +
  "kula code part parts thing things shows show small shared helpers helper inner mod src web views view lib pkg app new main data file files work works keep keeps").split(" "));

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** First surface form seen per stem, so zone names read as real words. */
const surface = new Map<string, string>();
export function tokens(text: string): string[] {
  // split camelCase and snake_case function names into words as well
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOP.has(w)).map((w) => { const t = stem(w); if (!surface.has(t)) surface.set(t, w); return t; });
}

const GOLDEN = 137.508;
export const zoneHue = (i: number) => `oklch(0.74 0.13 ${Math.round((28 + i * GOLDEN) % 360)})`;

export function meaningZones(secs: MeaningSection[], flows: MeaningFlow[]): { zones: Zone[]; zoneOf: Map<string, Zone> } {
  const n = secs.length;
  const idx = new Map(secs.map((s, i) => [s.id, i]));
  // 1. TF-IDF vectors
  const tf = secs.map((s) => { const m = new Map<string, number>(); for (const t of tokens(s.text)) m.set(t, (m.get(t) ?? 0) + 1); return m; });
  const df = new Map<string, number>();
  for (const m of tf) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const vec = tf.map((m) => {
    const v = new Map<string, number>(); let norm = 0;
    for (const [t, c] of m) { const w = (1 + Math.log(c)) * Math.log(1 + n / (df.get(t) ?? 1)); v.set(t, w); norm += w * w; }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
  const cos = (a: number, b: number) => { let s = 0; const [x, y] = vec[a].size < vec[b].size ? [vec[a], vec[b]] : [vec[b], vec[a]]; for (const [t, w] of x) s += w * (y.get(t) ?? 0); return s; };
  // 2. affinity
  const fw = new Map<string, number>(); let maxF = 0;
  for (const f of flows) {
    const a = idx.get(f.from), b = idx.get(f.to);
    if (a == null || b == null || a === b) continue;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    const v = (fw.get(k) ?? 0) + f.weight; fw.set(k, v); maxF = Math.max(maxF, v);
  }
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const f = maxF ? Math.sqrt((fw.get(`${a}|${b}`) ?? 0) / maxF) : 0;
    sim[a][b] = sim[b][a] = 0.75 * cos(a, b) + 0.25 * f;
  }
  // 3. clusters (tests fenced off into their own zone first)
  const isTest = (i: number) => secs[i].role === "test" || /^(checks and )?tests?$/i.test(secs[i].area ?? "");
  const link = (A: number[], B: number[]) => { let s = 0; for (const a of A) for (const b of B) s += sim[a][b]; return s / (A.length * B.length); };
  let clusters: number[][] = secs.map((_, i) => i).filter((i) => !isTest(i)).map((i) => [i]);
  const k = Math.max(3, Math.min(10, Math.round(1.2 * Math.sqrt(clusters.length))));
  const areaKey = (i: number) => secs[i].area?.trim().toLowerCase() || "";
  const withArea = clusters.filter(([i]) => areaKey(i)).length;
  const byArea = clusters.length > 0 && withArea / clusters.length >= 0.6;
  if (byArea) {
    const by = new Map<string, number[]>();
    for (const [i] of clusters) if (areaKey(i)) (by.get(areaKey(i)) ?? by.set(areaKey(i), []).get(areaKey(i))!).push(i);
    const named = [...by.values()];
    for (const [i] of clusters) if (!areaKey(i)) {
      let best = 0, bs = -1;
      named.forEach((c, z) => { const v = link([i], c); if (v > bs) { bs = v; best = z; } });
      named[best].push(i);
    }
    clusters = named;
  }
  while (!byArea && clusters.length > k) {
    let best = -1, bi = 0, bj = 1;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      // a light size penalty keeps one zone from swallowing the map
      const s = link(clusters[i], clusters[j]) / Math.pow(clusters[i].length * clusters[j].length, 0.35);
      if (s > best) { best = s; bi = i; bj = j; }
    }
    if (best < 0.02 && clusters.length <= k + 3) break;
    clusters[bi] = [...clusters[bi], ...clusters[bj]];
    clusters.splice(bj, 1);
  }
  const tests = secs.map((_, i) => i).filter(isTest);
  // 4. order by net outflow
  const zoneOfIdx = new Map<number, number>();
  clusters.forEach((c, z) => c.forEach((i) => zoneOfIdx.set(i, z)));
  const net = clusters.map(() => 0);
  const zflow = new Map<string, number>();
  for (const f of flows) {
    const a = idx.get(f.from), b = idx.get(f.to);
    if (a == null || b == null) continue;
    const za = zoneOfIdx.get(a), zb = zoneOfIdx.get(b);
    if (za == null || zb == null || za === zb) continue;
    net[za] += f.weight; net[zb] -= f.weight;
    zflow.set(`${za}|${zb}`, (zflow.get(`${za}|${zb}`) ?? 0) + f.weight);
  }
  // zones that barely talk to the rest (a promo kit, vendored libraries)
  // are side quests: they sit after the main line, before the tests
  const ext = clusters.map(() => 0);
  for (const [k2, v] of zflow) { const [za, zb] = k2.split("|").map(Number); ext[za] += v; ext[zb] += v; }
  const maxExt = Math.max(1, ...ext);
  const side = (z: number) => ext[z] < 0.08 * maxExt;
  const order = clusters.map((_, z) => z).sort((a, b) => Number(side(a)) - Number(side(b)) || net[b] - net[a] || clusters[b].length - clusters[a].length);
  if (tests.length) { clusters.push(tests); order.push(clusters.length - 1); }
  const rankOf = new Map(order.map((z, r) => [z, r]));
  // 5. barycentre sort within each zone
  const ranked = order.map((z) => [...clusters[z]]);
  const posInZone = new Map<number, number>();
  ranked.forEach((m) => m.forEach((i, p) => posInZone.set(i, p / Math.max(1, m.length - 1))));
  const bary = (i: number) => {
    let s = 0, w = 0;
    for (let j = 0; j < n; j++) {
      if (j === i || !sim[i][j]) continue;
      const zj = zoneOfIdx.get(j); if (zj == null) continue;
      const wt = sim[i][j] * sim[i][j];
      s += wt * ((rankOf.get(zj) ?? 0) + (posInZone.get(j) ?? 0.5)); w += wt;
    }
    return w ? s / w : (rankOf.get(zoneOfIdx.get(i) ?? 0) ?? 0) + 0.5;
  };
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const m of ranked) {
      m.sort((a, b) => bary(a) - bary(b));
      m.forEach((i, p) => posInZone.set(i, p / Math.max(1, m.length - 1)));
    }
  }
  // 6. name + hue
  const zones: Zone[] = ranked.map((m, r) => {
    let medoid = m[0], bestS = -1;
    for (const i of m) { let s = 0; for (const j of m) if (j !== i) s += sim[i][j]; if (s > bestS) { bestS = s; medoid = i; } }
    const isTests = m.every(isTest);
    // the zone's name: its two most distinctive words (zone mean over map
    // mean of the TF-IDF weights), falling back to its medoid's plain name
    const score = new Map<string, number>();
    for (const i of m) for (const [t, w] of vec[i]) score.set(t, (score.get(t) ?? 0) + w / m.length);
    for (let i = 0; i < n; i++) for (const [t, w] of vec[i]) if (score.has(t)) score.set(t, score.get(t)! - (0.6 * w) / n);
    const top = [...score].filter(([t]) => (df.get(t) ?? 0) > 1 || m.length === 1).sort((p, q) => q[1] - p[1]).slice(0, 2).map(([t]) => surface.get(t) ?? t);
    const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
    const areas = new Map<string, number>();
    for (const i of m) if (secs[i].area) areas.set(secs[i].area!, (areas.get(secs[i].area!) ?? 0) + 1);
    const topArea = [...areas].sort((p, q) => q[1] - p[1])[0];
    const name = topArea && topArea[1] * 2 >= m.length ? topArea[0]
      : isTests ? "Checks and tests"
      : m.length > 2 && top.length === 2 ? `${cap(top[0])} and ${top[1]}`
      : secs[medoid].plain || secs[medoid].text.split(/[.\n]/)[0].slice(0, 28);
    return { id: `zone-${r}`, name, hue: zoneHue(r), members: m.map((i) => secs[i].id), rank: r };
  });
  const zoneOf = new Map<string, Zone>();
  for (const z of zones) for (const id of z.members) zoneOf.set(id, z);
  return { zones, zoneOf };
}
