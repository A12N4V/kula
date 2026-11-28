// Atlas layout: a squarified treemap of domains by code size, then files as
// parcels inside each district, stations as dots at their file. Deterministic:
// sizes sort desc with id as the tiebreak, no Math.random, no map iteration
// order dependence. Same model in, identical rectangles out.
//
// Sizes come from the model itself: a station is a symbol, so a file's symbol
// count is the number of stations that name it (see atlasSizes). Files with no
// stations still count 1, so every parcel has area.

import type { MapDomain, MapModel } from "../model";
import { hashSeed } from "../layout-common";

export const ATLAS_WORLD = { w: 1600, h: 1000 };
/** World-space inset around the whole treemap. */
const PAD = 16;
/** Inset inside a district for its label. */
const LABEL_PAD = { x: 8, top: 24, bottom: 8 };
/** Districts smaller than this on a side hold no parcels. */
const MIN_DISTRICT = 44;

export interface AtlasRect { x: number; y: number; w: number; h: number }
export interface AtlasDistrict extends AtlasRect { domain: number }
export interface AtlasParcel extends AtlasRect { domain: number; file: string }
export interface AtlasStation { id: string; x: number; y: number; file: string | null }
export interface AtlasLayout {
  districts: AtlasDistrict[];
  parcels: AtlasParcel[];
  stations: AtlasStation[];
  byDistrict: Map<number, AtlasDistrict>;
  /** Parcels grouped per district, so the draw path never scans all parcels
   * for each district (O(D·P) per frame at kula's own scale). */
  parcelsByDistrict: Map<number, AtlasParcel[]>;
  parcelByFile: Map<string, AtlasParcel>;
  stationById: Map<string, AtlasStation>;
  /** Station metadata indexed by id: name and degree, so the draw path never
   * does model.stations.find (O(S²) per frame). */
  stationMeta: Map<string, { name: string; degree: number }>;
  domainById: Map<number, MapDomain>;
}

/** Symbol count per file, from the model: a station is a symbol. */
export function atlasSizes(model: MapModel): Map<string, number> {
  const m = new Map<string, number>();
  for (const st of model.stations) for (const f of st.files) m.set(f, (m.get(f) ?? 0) + 1);
  return m;
}

/** Squarified treemap (Bruls, Huizing, van Wijk): rows along the shorter
 * side, greedily extended while the worst aspect ratio improves. */
function squarify(items: { key: string; size: number }[], x: number, y: number, w: number, h: number): AtlasRect[] {
  const out: AtlasRect[] = [];
  const total = items.reduce((s, i) => s + i.size, 0);
  if (total <= 0 || w <= 0 || h <= 0) return out;
  // Normalise to area units first, so row thickness and item lengths come
  // from one consistent unit – raw sizes with a separate scale factor drift.
  const k = (w * h) / total;
  const norm = items.map((i) => ({ key: i.key, size: i.size * k }));
  let rx = x, ry = y, rw = w, rh = h;
  let i = 0;
  while (i < norm.length) {
    const side = Math.min(rw, rh);
    // Zero or negative space left (a zero-size item or float drift) would
    // explode the row math – stop cleanly with the space already placed.
    if (!(side > 0) || !Number.isFinite(side)) break;
    const row = [norm[i]];
    let rowSum = norm[i].size;
    let worst = rowWorst(rowSum, side, row);
    let j = i + 1;
    while (j < norm.length) {
      const next = rowSum + norm[j].size;
      const nextRow = row.concat(norm[j]);
      const nextWorst = rowWorst(next, side, nextRow);
      if (nextWorst > worst) break;
      rowSum = next;
      row.push(norm[j]);
      worst = nextWorst;
      j++;
    }
    const thick = rowSum / side;
    if (rw >= rh) {
      let yy = ry;
      for (const it of row) {
        const hh = it.size / thick;
        out.push({ x: rx, y: yy, w: thick, h: hh });
        yy += hh;
      }
      rx += thick;
      rw -= thick;
    } else {
      let xx = rx;
      for (const it of row) {
        const ww = it.size / thick;
        out.push({ x: xx, y: ry, w: ww, h: thick });
        xx += ww;
      }
      ry += thick;
      rh -= thick;
    }
    i = j;
  }
  return out;
}

/** Worst aspect ratio of a row laid along `side`. */
function rowWorst(sum: number, side: number, row: { size: number }[]): number {
  const thick = sum / side;
  let worst = 0;
  for (const it of row) {
    const len = (it.size * side) / sum;
    worst = Math.max(worst, len / thick, thick / len);
  }
  return worst;
}

/** District size: the code it holds, in symbols (files with none count 1).
 * A domain with no files still counts 1 so its row math stays finite. */
function districtSize(files: string[], sizes: Map<string, number>): number {
  let s = 0;
  for (const f of files) s += Math.max(1, sizes.get(f) ?? 1);
  return Math.max(1, s);
}

/** Build the layout. Pure: same model, same rectangles, every time. */
export function atlasLayout(model: MapModel): AtlasLayout {
  const sizes = atlasSizes(model);
  const districts = [...model.domains]
    .map((d) => ({ key: String(d.id), size: districtSize(d.files, sizes), domain: d.id }))
    .sort((a, b) => b.size - a.size || a.domain - b.domain);
  const rects = squarify(districts, PAD, PAD, ATLAS_WORLD.w - PAD * 2, ATLAS_WORLD.h - PAD * 2);

  const out: AtlasLayout = {
    districts: [],
    parcels: [],
    stations: [],
    byDistrict: new Map(),
    parcelsByDistrict: new Map(),
    parcelByFile: new Map(),
    stationById: new Map(),
    stationMeta: new Map(),
    domainById: new Map(),
  };
  for (const dom of model.domains) out.domainById.set(dom.id, dom);
  rects.forEach((r, i) => {
    const d: AtlasDistrict = { ...r, domain: districts[i].domain };
    out.districts.push(d);
    out.byDistrict.set(d.domain, d);
    out.parcelsByDistrict.set(d.domain, []);
  });

  // Parcels: each district's files, size desc, path asc, inside the district.
  for (const d of out.districts) {
    const dom = model.domains.find((x) => x.id === d.domain);
    if (!dom || d.w < MIN_DISTRICT || d.h < MIN_DISTRICT) continue;
    const files = dom.files
      .map((f) => ({ key: f, size: Math.max(1, sizes.get(f) ?? 1) }))
      .sort((a, b) => b.size - a.size || a.key.localeCompare(b.key));
    const px = d.x + LABEL_PAD.x, py = d.y + LABEL_PAD.top;
    const pw = d.w - LABEL_PAD.x * 2, ph = d.h - LABEL_PAD.top - LABEL_PAD.bottom;
    squarify(files, px, py, pw, ph).forEach((r, i) => {
      const p: AtlasParcel = { ...r, domain: d.domain, file: files[i].key };
      out.parcels.push(p);
      out.parcelsByDistrict.get(d.domain)!.push(p);
      if (!out.parcelByFile.has(p.file)) out.parcelByFile.set(p.file, p);
    });
  }

  // Stations: a dot at its file's parcel. Several stations in one file fan
  // out on a golden-angle spiral so each dot stays legible. A station whose
  // file holds no parcel falls back to the centre of its first flow's district.
  const spiral = new Map<string, number>();
  for (const st of model.stations) {
    let file: string | null = null;
    for (const f of st.files) if (out.parcelByFile.has(f)) { file = f; break; }
    let x: number, y: number;
    if (file) {
      const p = out.parcelByFile.get(file)!;
      x = p.x + p.w / 2;
      y = p.y + p.h / 2;
      const idx = spiral.get(file) ?? 0;
      spiral.set(file, idx + 1);
      if (idx > 0) {
        const r = 5 * Math.sqrt(idx);
        const a = idx * 2.399963229728653;
        x += r * Math.cos(a);
        y += r * Math.sin(a);
      }
    } else {
      const fid = st.flows[0];
      const flow = model.flows.find((f) => f.id === fid);
      const d = flow ? out.byDistrict.get(flow.domain) : undefined;
      x = d ? d.x + d.w / 2 : ATLAS_WORLD.w / 2;
      y = d ? d.y + d.h / 2 : ATLAS_WORLD.h / 2;
    }
    // Clamp every dot into the world so a degenerate rect upstream can never
    // fling a station off-map.
    const cx = Math.min(ATLAS_WORLD.w - 4, Math.max(4, Number.isFinite(x) ? x : ATLAS_WORLD.w / 2));
    const cy = Math.min(ATLAS_WORLD.h - 4, Math.max(4, Number.isFinite(y) ? y : ATLAS_WORLD.h / 2));
    const s: AtlasStation = { id: st.id, x: cx, y: cy, file };
    out.stations.push(s);
    out.stationById.set(st.id, s);
    out.stationMeta.set(st.id, { name: st.name, degree: st.degree });
  }
  return out;
}

/** Memoised per model instance, so drawing never relayouts (live events
 * rebuild overlays, never the layout). */
const cache = new WeakMap<MapModel, AtlasLayout>();
export function getAtlasLayout(model: MapModel): AtlasLayout {
  let lay = cache.get(model);
  if (!lay) {
    lay = atlasLayout(model);
    cache.set(model, lay);
  }
  return lay;
}

/** The selected flow's route: one point per step, in call order, over parcels. */
export function flowRoute(lay: AtlasLayout, model: MapModel, flowId: string): { station: string; x: number; y: number }[] {
  const f = model.flows.find((x) => x.id === flowId);
  if (!f) return [];
  const out: { station: string; x: number; y: number }[] = [];
  for (const step of f.steps) {
    const p = lay.stationById.get(step.station);
    if (p) out.push({ station: step.station, x: p.x, y: p.y });
  }
  return out;
}

/** Deterministic muted colour for an owner seat (owners overlay). */
const OWNER_HUES = ["#8a6a4f", "#4f6a8a", "#5f8a4f", "#8a4f6a", "#6a4f8a", "#8a7a4f"];
export function ownerColor(owner: string): string {
  return OWNER_HUES[hashSeed(owner) % OWNER_HUES.length];
}
