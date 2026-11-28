// Variant C · Storyboard. The program as a storyboard: zoomed out, every
// domain is a panel of flow cards (one card per flow, with a mini step
// strip coloured by layer); a card click – or fit on a flow pick – opens
// the flow as lanes by layer with branch forks and loop curls, and chips
// on shared stations that jump to the other flow calling the same station.
//
// Semantic zoom (detail changes, the view never does):
//   below Z_CARD_TEXT – panels and strips only, no card text
//   above Z_STORY, with a flow open – the flow's board replaces the grid
// Layout comes from layout.ts, cached per model; draw only reads it.

import type { Variant, MapPick, VariantView, DrawOverlays } from "../Map";
import type { MapModel } from "../model";
import { roundRect, withAlpha, clamp } from "../layout-common";
import { storyLayout, Z_CARD_TEXT, Z_STORY, BAND_STEPS, BAND_GAP, LANE_H, type StoryBoard, type StoryCard } from "./layout";

// For the e2e spec and the probe: read the layout without a canvas.
export { storyLayout as __layoutForTest, STORY_WORLD as __world } from "./layout";

// Canvas twin of the map palette: canvas 2D cannot read var() colours, so the
// hues are hardcoded here. Keep in sync by hand with layout-common.ts
// (FLOW_COLORS :8, LAYER_COLORS :15) and tokens.css :64-69, where the light
// mode overrides live – a palette change there must be mirrored here.
const FLOW_HEX = ["#ff6a14", "#00d2dc", "#1fd66a", "#ffc414", "#a45bff", "#2e8bff", "#ff3d8e", "#ff463a"];
// LAYER_HEX shares its hues with FLOW_HEX on purpose: one palette, two roles.
const LAYER_HEX: Record<string, string> = {
  entry: "#ff6a14", handler: "#00d2dc", logic: "#1fd66a", data: "#ffc414", io: "#2e8bff", test: "#a45bff",
};
const FONT_UI = "13px 'Jost Variable', sans-serif";
const FONT_MONO = "11px 'JetBrains Mono Variable', monospace";

const DOT_R = 7;

/** Which board hit answers for, before and between draws: the last flow
 *  fit or drawn. Null means the grid is the answer surface. */
let lastOpen: string | null = null;

const inPanel = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/* ---------------------------------------------------------------- grid ---- */

function drawGrid(
  ctx: CanvasRenderingContext2D, model: MapModel, view: VariantView, overlays: DrawOverlays, sel: MapPick | null,
) {
  const ink = { text: "#f0ebe3", line: "#24201d", line2: "#332d28", bg: "#050505", accent: "#ff6a14" };
  const lay = storyLayout(model);

  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);

  for (const d of lay.grid.domains) {
    ctx.fillStyle = "rgba(240,235,227,0.03)";
    ctx.strokeStyle = ink.line2;
    ctx.lineWidth = 1;
    roundRect(ctx, d.x, d.y, d.w, d.h, 10);
    ctx.fill();
    ctx.stroke();
    if (view.scale >= Z_CARD_TEXT) {
      ctx.fillStyle = ink.text;
      ctx.font = "600 13px 'Jost Variable', sans-serif";
      ctx.fillText(d.label.slice(0, 24), d.x + 10, d.y + 19);
      ctx.fillStyle = withAlpha(ink.text, 0.55);
      ctx.font = "10px 'JetBrains Mono Variable', monospace";
      ctx.fillText(`${d.flows} flows · ${d.files} files`, d.x + 10, d.y + 19 + 14);
    }
  }

  for (const c of lay.grid.cards) {
    const flow = model.flows.find((f) => f.id === c.flowId);
    if (!flow) continue;
    const selected = sel?.kind === "flow" && sel.id === c.flowId;
    ctx.fillStyle = selected ? "rgba(255,106,20,0.10)" : "#191512";
    ctx.strokeStyle = selected ? ink.accent : ink.line2;
    ctx.lineWidth = selected ? 1.5 : 1;
    roundRect(ctx, c.x, c.y, c.w, c.h, 7);
    ctx.fill();
    ctx.stroke();

    // The step strip: one tick per call in order, coloured by layer.
    const pad = 8;
    for (const tick of c.strip) {
      ctx.fillStyle = LAYER_HEX[tick.layer] ?? ink.text;
      ctx.fillRect(c.x + pad + tick.t * (c.w - pad * 2 - 4), c.y + c.h - 10, 4, 5);
    }
    if (view.scale >= Z_CARD_TEXT) {
      ctx.fillStyle = ink.text;
      ctx.font = "12px 'Jost Variable', sans-serif";
      ctx.fillText(c.label, c.x + pad, c.y + 17);
      ctx.fillStyle = withAlpha(ink.text, 0.55);
      ctx.font = "9px 'JetBrains Mono Variable', monospace";
      ctx.fillText(`${c.steps} steps · ${c.entry.slice(0, Math.max(6, Math.round(c.w / 6.4) - 10))}`, c.x + pad, c.y + 30);
    }

    // Overlay marks, every one gated on its toggle: live heat, a fence, churn
    // and the owner seat, judged on the flow's own stations.
    let mx = c.x + c.w - 10;
    const mark = (color: string) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(mx, c.y + 12, 3, 0, Math.PI * 2); ctx.fill(); mx -= 11; };
    if (overlays.show.live && flow.steps.some((s) => (overlays.live[s.station] ?? 0) > 0)) mark("#ff6a14");
    if (overlays.show.fences && flow.steps.some((s) => overlays.fences[s.station])) mark("#ffc414");
    if (overlays.show.churn && flow.steps.some((s) => (overlays.churn[s.station] ?? 0) > 0)) mark("#ff463a");
    if (overlays.show.owners && flow.steps.some((s) => overlays.owners[s.station])) mark("#2e8bff");
  }
  ctx.restore();
}

/* --------------------------------------------------------------- board ---- */

function drawBoard(
  ctx: CanvasRenderingContext2D, model: MapModel, view: VariantView, overlays: DrawOverlays, sel: MapPick | null,
  board: StoryBoard,
) {
  const ink = { text: "#f0ebe3", line: "#24201d", line2: "#332d28", bg: "#050505", accent: "#ff6a14" };
  const flowIdx = Math.max(0, model.flows.findIndex((f) => f.id === board.flowId));

  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);
  ctx.translate(board.x, board.y);

  // The panel behind the story.
  ctx.fillStyle = "#0d0b0a";
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = 1;
  roundRect(ctx, -18, -18, board.w + 36, board.h + 36, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = ink.text;
  ctx.font = "600 17px 'Jost Variable', sans-serif";
  ctx.fillText(board.title, 0, 14);
  ctx.fillStyle = withAlpha(ink.text, 0.55);
  ctx.font = "10px 'JetBrains Mono Variable', monospace";
  ctx.fillText(board.meta, 0, 30);

  // Lanes: one horizontal band per layer the flow touches, label at left.
  // Long flows wrap onto continuation bands, so the bands repeat downward.
  const bands = Math.max(1, Math.ceil(board.steps.length / BAND_STEPS));
  const bandH = board.lanes.length * LANE_H + BAND_GAP;
  for (let b = 0; b < bands; b++) {
    for (const [li, lane] of board.lanes.entries()) {
      const y = lane.y + b * bandH;
      ctx.strokeStyle = ink.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(board.w - 40, y);
      ctx.stroke();
      if (b === 0) {
        ctx.fillStyle = LAYER_HEX[lane.layer] ?? ink.text;
        ctx.font = "10px 'JetBrains Mono Variable', monospace";
        ctx.fillText(`${lane.layer} ×${lane.count}`, 4, y - 8);
      } else {
        ctx.fillStyle = withAlpha(ink.text, 0.35);
        ctx.font = "10px 'JetBrains Mono Variable', monospace";
        ctx.fillText("cont.", 4, y - 8);
      }
    }
  }

  // Connectors first, dots on top. A fork child drops down from its branch
  // parent with an elbow; a band change wraps around the right edge.
  const steps = board.steps;
  for (let j = 1; j < steps.length; j++) {
    const a = steps[j - 1];
    const b = steps[j];
    ctx.strokeStyle = withAlpha(LAYER_HEX[b.layer] ?? ink.text, 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (Math.floor(j / BAND_STEPS) !== Math.floor((j - 1) / BAND_STEPS)) {
      // Wrap: off the right of the band, down, into the next band's first dot.
      const wrapY = b.y - 18;
      ctx.moveTo(a.x + DOT_R, a.y);
      ctx.lineTo(board.w - 40, a.y);
      ctx.lineTo(board.w - 40, wrapY);
      ctx.lineTo(b.x, wrapY);
      ctx.lineTo(b.x, b.y - DOT_R);
    } else if (b.forkDrop > 0) {
      const elbowX = b.x - 14;
      ctx.moveTo(a.x + DOT_R, a.y);
      ctx.lineTo(elbowX, a.y);
      ctx.lineTo(elbowX, b.y);
      ctx.lineTo(b.x - DOT_R, b.y);
    } else {
      ctx.moveTo(a.x + DOT_R, a.y);
      ctx.lineTo(b.x - DOT_R, b.y);
    }
    ctx.stroke();
  }
  // Loop curls: from the loop step back to the step it repeats, above the lane.
  for (const s of steps) {
    if (s.curlToX == null) continue;
    ctx.strokeStyle = withAlpha(ink.text, 0.7);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - DOT_R - 2);
    ctx.bezierCurveTo(s.x, s.y - 38, s.curlToX, s.y - 38, s.curlToX, s.y - DOT_R - 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead pointing back at the earlier step.
    ctx.beginPath();
    ctx.moveTo(s.curlToX, s.y - DOT_R - 2);
    ctx.lineTo(s.curlToX - 4, s.y - DOT_R - 8);
    ctx.lineTo(s.curlToX + 4, s.y - DOT_R - 8);
    ctx.closePath();
    ctx.fillStyle = withAlpha(ink.text, 0.7);
    ctx.fill();
  }

  for (const s of steps) {
    // Overlay marks around the dot, each gated on its toggle.
    if (overlays.show.fences && overlays.fences[s.station]) {
      const locked = overlays.fences[s.station] === "locked";
      ctx.strokeStyle = "#ffc414";
      ctx.lineWidth = 2;
      if (!locked) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, DOT_R + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (overlays.show.live && (overlays.live[s.station] ?? 0) > 0) {
      ctx.strokeStyle = withAlpha("#ff6a14", Math.min(1, 0.25 + overlays.live[s.station]));
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, DOT_R + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (overlays.show.churn && (overlays.churn[s.station] ?? 0) > 0) {
      ctx.fillStyle = "#ff463a";
      ctx.fillRect(s.x - 2, s.y - DOT_R - 12, 4, 4);
    }
    if (overlays.show.owners && overlays.owners[s.station]) {
      ctx.fillStyle = "#2e8bff";
      ctx.beginPath();
      ctx.arc(s.x + DOT_R + 7, s.y - DOT_R - 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = LAYER_HEX[s.layer] ?? ink.text;
    ctx.strokeStyle = "#050505";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, DOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Branch keyword, tucked left of the dot so names above stay clear.
    if (s.branch) {
      ctx.fillStyle = withAlpha(ink.text, 0.7);
      ctx.font = "8px 'JetBrains Mono Variable', monospace";
      ctx.textAlign = "right";
      ctx.fillText(s.branch, s.x - DOT_R - 4, s.y + 3);
      ctx.textAlign = "left";
    }
    // Station names, from a readable zoom only, short enough that neighbours
    // 96 px apart cannot collide.
    if (view.scale >= 0.8) {
      ctx.fillStyle = ink.text;
      ctx.font = "10px 'JetBrains Mono Variable', monospace";
      ctx.fillText(s.name.length > 13 ? `${s.name.slice(0, 12)}…` : s.name, s.x + DOT_R + 5, s.y - DOT_R - 4);
    }
  }

  // Chips: the other flows that call the same station. One per row under the
  // dot, capped and width-clamped in layout so neighbours never collide.
  for (const chip of board.chips) {
    ctx.fillStyle = "#191512";
    ctx.strokeStyle = ink.line2;
    ctx.lineWidth = 1;
    roundRect(ctx, chip.x, chip.y, chip.w, chip.h, 9);
    ctx.fill();
    ctx.stroke();
    const fi = model.flows.findIndex((f) => f.id === chip.flowId);
    ctx.fillStyle = FLOW_HEX[((fi < 0 ? flowIdx : fi) % FLOW_HEX.length + FLOW_HEX.length) % FLOW_HEX.length];
    ctx.fillRect(chip.x, chip.y + 3, 3, chip.h - 6);
    ctx.fillStyle = ink.text;
    ctx.font = "9px 'JetBrains Mono Variable', monospace";
    ctx.fillText(chip.label, chip.x + 9, chip.y + 12);
  }
  ctx.restore();
}

/* -------------------------------------------------------------- variant ---- */

export const storyVariant: Variant = {
  id: "c",
  draw(ctx, model, view, overlays, sel) {
    const lay = storyLayout(model);
    if (sel?.kind === "flow" && view.scale >= Z_STORY) {
      const board = lay.boards.get(sel.id);
      if (board) {
        lastOpen = sel.id;
        drawBoard(ctx, model, view, overlays, sel, board);
        return;
      }
    }
    lastOpen = null;
    drawGrid(ctx, model, view, overlays, sel);
  },

  hit(x, y, view) {
    const model = (window as unknown as { __kulaMap?: { model?: MapModel } }).__kulaMap?.model;
    if (!model) return null;
    const lay = storyLayout(model);
    const wx = (x - view.ox) / view.scale;
    const wy = (y - view.oy) / view.scale;

    // An open board answers chips first, then station dots.
    const board = view.scale >= Z_STORY && lastOpen ? lay.boards.get(lastOpen) : null;
    if (board) {
      for (const chip of board.chips) {
        if (inPanel(wx, wy, chip)) return { kind: "flow", id: chip.flowId };
      }
      let best: { d: number; id: string } | null = null;
      for (const s of board.steps) {
        const d = Math.hypot(s.x - wx, s.y - wy);
        if (d < DOT_R + 6 && (!best || d < best.d)) best = { d, id: s.station };
      }
      if (best) return { kind: "station", id: best.id };
      // Clicks on open board space still open the panel's domain? No – the
      // board is the flow; empty space is empty. Fall through to the grid
      // only when no board is open, so cards behind never swallow a click.
      return null;
    }

    for (const c of lay.grid.cards) {
      if (inPanel(wx, wy, c)) return { kind: "flow", id: c.flowId };
    }
    for (const d of lay.grid.domains) {
      if (inPanel(wx, wy, d)) return { kind: "domain", id: String(d.id) };
    }
    return null;
  },

  fit(pick, view, set) {
    const model = (window as unknown as { __kulaMap?: { model?: MapModel } }).__kulaMap?.model;
    if (!model) return;
    const lay = storyLayout(model);

    if (pick.kind === "flow") {
      const board = lay.boards.get(pick.id);
      if (!board) return;
      lastOpen = pick.id;
      // Wide boards scale down to the view; very long flows wrap onto bands
      // and can still be taller than the view, so the floor stays above the
      // story threshold (0.7) and the user pans the rest.
      const s = clamp(Math.min(view.w / (board.w + 120), view.h / (board.h + 120)), 0.72, 1.4);
      set({
        w: view.w, h: view.h, scale: s,
        ox: view.w / 2 - (board.x + board.w / 2) * s,
        oy: view.h / 2 - (board.y + board.h / 2) * s,
      });
      return;
    }
    if (pick.kind === "domain") {
      const d = lay.grid.domains.find((x) => String(x.id) === pick.id);
      if (!d) return;
      const s = clamp(Math.min(view.w / d.w, view.h / d.h) * 0.85, 0.3, 1.2);
      set({
        w: view.w, h: view.h, scale: s,
        ox: view.w / 2 - (d.x + d.w / 2) * s,
        oy: view.h / 2 - (d.y + d.h / 2) * s,
      });
      return;
    }
    // A station pick centres the card of the first flow that calls it: the
    // grid is what is on screen when no flow is open.
    if (pick.kind === "station") {
      const card = lay.grid.cards.find((c: StoryCard) =>
        model.flows.find((f) => f.id === c.flowId)?.steps.some((s) => s.station === pick.id));
      if (!card) return;
      const s = clamp(Math.min(view.w / card.w, view.h / card.h) * 0.6, 0.4, 1.2);
      set({
        w: view.w, h: view.h, scale: s,
        ox: view.w / 2 - (card.x + card.w / 2) * s,
        oy: view.h / 2 - (card.y + card.h / 2) * s,
      });
    }
  },
};
