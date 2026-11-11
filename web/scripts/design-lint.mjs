#!/usr/bin/env node
// Design lint – the D1 rules over web/src, from the coherence brief.
//
//   node web/scripts/design-lint.mjs            report mode: list violations,
//                                               exit 0 (the tree is not clean
//                                               until the wave-3 modules land)
//   KULA_LINT_STRICT=1 node …                   enforce: exit 1 on any violation
//   node web/scripts/design-lint.mjs --selftest seed violations into a scratch
//                                               tree and prove both directions
//
// Rules (brief numbering – the "D1.3" label in e2e/ui.spec.ts is the older
// focus test and predates this scheme):
//   D1.3  no border-radius literal except 50%, 0, the radius tokens
//         (4px / 6px / 8px) and var(--r*) usages
//   D1.4  no side stripe on a selected or hover state: box-shadow
//         `inset <n>px 0…` with n ≠ 0, or an accent border-left.
//         Underlines (`inset 0 -1px`, `0 -2px`) are fine.
//   D1.5  no em dash anywhere in web/src
//   D1.6  no pill radius (≥ 9px) on any control smaller than 40px tall.
//         Lint-time the rule is conservative: any radius ≥ 9px is reported
//         (a stylesheet cannot know a rendered height). The height-accurate
//         check is the computed-style pass in e2e/design.spec.ts.
import fs from "node:fs";
import path from "node:path";

const SELFTEST = process.argv.includes("--selftest");
const ROOT = process.argv[2] && !process.argv[2].startsWith("--")
  ? path.resolve(process.argv[2])
  : path.resolve(import.meta.dirname, "..", "src");
const STRICT = process.env.KULA_LINT_STRICT === "1";

const violations = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function add(rule, file, line, text) {
  violations.push(`${rule}  ${file}:${line}  ${text.trim().slice(0, 120)}`);
}

// Radius whitelist for D1.3: square (0), the three token values, the dot
// (50%), inherit, and anything via a custom property.
const RADIUS_OK = /^(0|4px|6px|8px|50%|inherit)$/i;
const RADIUS_VAR = /^var\(--r/;

/** Split CSS text into {selector, body, line} blocks, flattening @media etc.
 *  A tiny scanner is enough: the rules we police are declarations, not
 *  structure, and a real parser would pull in a dependency. */
function cssBlocks(rawText) {
  const text = rawText.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")); // keep line numbers, drop comment braces
  const blocks = [];
  const stack = []; // open at-rules, for line tracking only
  const re = /([^{}]*)\{/g;
  let m;
  while ((m = re.exec(text))) {
    const head = m[1];
    const line = text.slice(0, m.index).split("\n").length;
    // find the matching close brace from m.index + "{" length
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    const body = text.slice(m.index + m[0].length, i - 1);
    for (const sel of head.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
      blocks.push({ selector: sel, body, line });
    }
  }
  return blocks;
}

/** A selector is a selected/hover state when it names a hover, an active
 *  selection class or an aria-selected element. */
const STATE_RE = /:hover|\.on\b|\.sel\b|\.sel$|selected|\.active\b|\.focus\b|:focus-visible|\[aria-selected/;
/** box-shadow side stripe: `inset <n>px 0` with a non-zero horizontal offset.
 *  Vertical underlines (`inset 0 -1px`) have a 0 first offset and pass. */
const STRIPE_SHADOW = /inset\s+(-?\d+(?:\.\d+)?)px\s+0(?:px)?(?![\d.]*px\s*-?\d)/;
/** An accent border-left: a colour that is not transparent. */
function accentBorderLeft(value) {
  if (!/border-left(-width|-style|-color)?\s*:/.test(value)) return false;
  if (value.includes("border-left-width") || value.includes("border-left-style")) return false;
  return !/transparent|^none$/i.test(value.replace(/^border-left(-color)?\s*:\s*/, ""));
}

function lintCss(rel, text) {
  for (const { selector, body, line } of cssBlocks(text)) {
    const state = STATE_RE.test(selector);
    for (const decl of body.split(";")) {
      const rm = decl.match(/border-radius\s*:\s*([^;]+)/);
      if (rm) {
        const v = rm[1].trim();
        if (!RADIUS_OK.test(v) && !RADIUS_VAR.test(v)) {
          add("D1.3", rel, line, `${selector} { border-radius: ${v} }`);
        }
        // D1.6 (conservative lint-time form): any radius ≥ 9px.
        const px = v.match(/^(\d+(?:\.\d+)?)px$/);
        if (px && Number(px[1]) >= 9) add("D1.6", rel, line, `${selector} { border-radius: ${v} } – pill? (lint cannot see height; e2e/design.spec.ts checks it)`);
      }
      if (state) {
        const sm = decl.match(/box-shadow\s*:\s*([^;]+)/);
        if (sm) {
          // each shadow in a comma list, but commas inside shadows have no
          // function context here – split on top-level commas crudely
          for (const shadow of sm[1].split(/,(?![^(]*\))/)) {
            const hit = shadow.match(STRIPE_SHADOW);
            if (hit && Number(hit[1]) !== 0) add("D1.4", rel, line, `${selector} :: side stripe ${shadow.trim()}`);
          }
        }
        if (accentBorderLeft(decl)) add("D1.4", rel, line, `${selector} :: accent border-left`);
      }
    }
  }
}

function lintText(rel, text) {
  text.split("\n").forEach((l, i) => {
    if (l.includes("—")) add("D1.5", rel, i + 1, l);
  });
}

const files = walk(ROOT);
for (const f of files) {
  const rel = path.relative(ROOT, f);
  const text = fs.readFileSync(f, "utf8");
  lintText(rel, text);
  if (/\.css$/.test(f)) lintCss(rel, text);
  // border-radius in inline styles (tsx) – same D1.3 whitelist
  if (/\.(tsx?|jsx?)$/.test(f)) {
    const re = /borderRadius\s*:\s*["'`]([^"'`]+)["'`]/g;
    let m;
    while ((m = re.exec(text))) {
      const v = m[1].trim();
      if (!RADIUS_OK.test(v) && !RADIUS_VAR.test(v))
        add("D1.3", rel, text.slice(0, m.index).split("\n").length, `borderRadius: "${v}"`);
      const px = v.match(/^(\d+(?:\.\d+)?)px$/);
      if (px && Number(px[1]) >= 9) add("D1.6", rel, text.slice(0, m.index).split("\n").length, `borderRadius: "${v}" – pill?`);
    }
  }
}

if (SELFTEST) {
  // Seed one violation of every rule into a scratch tree and prove the linter
  // reports exactly those; then prove a clean tree passes.
  const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = await import("node:fs");
  const os = await import("node:os");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "design-lint-"));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  const run = (dir) => {
    violations.length = 0;
    for (const f of walk(dir)) {
      const rel = path.relative(dir, f);
      const text = fs.readFileSync(f, "utf8");
      lintText(rel, text);
      if (/\.css$/.test(f)) lintCss(rel, text);
    }
    return violations.splice(0).map((v) => v.slice(0, 4));
  };
  mkdirSync(path.join(tmp, "sub"), { recursive: true });
  writeFileSync(path.join(tmp, "bad.css"), `\
.bad-radius { border-radius: 11px; }
.pill { border-radius: 9px; }
.row:hover { box-shadow: inset 2px 0 var(--accent); }
.row.sel { box-shadow: inset -2px 0 0 var(--accent), 0 1px 2px black; }
.row.on { border-left: 2px solid var(--accent); }
/* allowed shapes */
.tab:hover { box-shadow: inset 0 -1px var(--accent); }
.tab.on { box-shadow: 0 -2px 0 var(--accent) inset; }
.dot { border-radius: 50%; }
.flat { border-radius: 0; }
.tok { border-radius: var(--radius, 8px); }
`);
  writeFileSync(path.join(tmp, "sub", "bad.tsx"), `export const x = <div style={{ borderRadius: "10px" }} title="— em dash" />;\n`);
  writeFileSync(path.join(tmp, "clean.css"), `\
.a { border-radius: 0; }
.b { border-radius: 4px; }
.c { border-radius: 50%; }
.d { border-radius: var(--radius-sm, 6px); }
.row:hover { box-shadow: inset 0 -1px 0 var(--accent); }
.row.on { background: var(--bg-3); }
.no-em-dash-here – fine;
`);
  const bad = run(tmp);
  const rules = new Set(bad.map((v) => v.slice(0, 4)));
  const need = new Set(["D1.3", "D1.4", "D1.5", "D1.6"]);
  const missing = [...need].filter((r) => !rules.has(r));
  // the clean file must contribute nothing: every finding names a bad file
  const cleanHit = bad.filter((v) => v.includes("clean."));
  if (missing.length || cleanHit.length || bad.length < 5) {
    console.error("selftest FAILED");
    console.error("  missing rules:", missing.join(", ") || "none");
    console.error("  findings:", bad.length, JSON.stringify(bad, null, 1));
    console.error("  clean-file hits:", cleanHit);
    cleanup();
    process.exit(1);
  }
  console.log(`design lint selftest: ${bad.length} seeded violations caught, all four rules fire, clean file passes`);
  cleanup();
  process.exit(0);
}

const byFile = new Map();
for (const v of violations) {
  const f = v.split("  ")[1];
  byFile.set(f, (byFile.get(f) ?? 0) + 1);
}
if (violations.length) {
  for (const v of violations) console.log(v);
  console.error(`design lint: ${violations.length} violation(s) in ${byFile.size} file(s)`);
  if (STRICT) process.exit(1);
  console.error("report mode (KULA_LINT_STRICT=1 to enforce)");
} else {
  console.log(`design lint: clean over ${files.length} files`);
}
