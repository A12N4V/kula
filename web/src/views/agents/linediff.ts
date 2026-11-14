// A line diff for the Architect review: an LCS over lines, then hunks with a
// little context. kula.toml is small, so the quadratic table is fine.

export type DiffLine = { k: " " | "+" | "-"; t: string } | { k: "…"; t: "" };

export function lineDiff(a: string, b: string, context = 2): DiffLine[] {
  const x = a.split("\n"), y = b.split("\n");
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const all: { k: " " | "+" | "-"; t: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { all.push({ k: " ", t: x[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) all.push({ k: "-", t: x[i++] });
    else all.push({ k: "+", t: y[j++] });
  }
  while (i < n) all.push({ k: "-", t: x[i++] });
  while (j < m) all.push({ k: "+", t: y[j++] });
  // keep the changes and `context` lines around each; fold the rest
  const keep = all.map(() => false);
  all.forEach((l, idx) => { if (l.k !== " ") for (let d = -context; d <= context; d++) if (all[idx + d]) keep[idx + d] = true; });
  const out: DiffLine[] = [];
  all.forEach((l, idx) => {
    if (keep[idx]) out.push(l);
    else if (out.length && out[out.length - 1].k !== "…") out.push({ k: "…", t: "" });
  });
  if (out.length && out[out.length - 1].k === "…") out.pop();
  return out;
}
