#!/usr/bin/env python3
"""Score kula's warm reindex: cold run, then N warm runs, wall time each.

usage: score.py [--kula PATH] [--repo PATH] [--runs N] [--max-ms MS]
The acceptance bar is a warm reindex of kula itself under 400 ms, so --max-ms
defaults to 400 and the script exits 1 if any warm run over it. Cold time is
printed for context only. Warm runs reuse .kula/pcache.db and the live
graph.db, which is exactly what the parse cache plus the publish-skip buy.
"""
import os, subprocess, sys, time

here = os.path.dirname(os.path.abspath(__file__))
kula = "kula"
repo = os.getcwd()
runs = 3
max_ms = 400.0
a = sys.argv[1:]
while a:
    k = a.pop(0)
    if k == "--kula": kula = a.pop(0)
    elif k == "--repo": repo = a.pop(0)
    elif k == "--runs": runs = int(a.pop(0))
    elif k == "--max-ms": max_ms = float(a.pop(0))
if os.sep in kula: kula = os.path.abspath(kula)
repo = os.path.abspath(repo)

def run():
    t0 = time.perf_counter()
    subprocess.run([kula, "index"], cwd=repo, check=True, capture_output=True)
    return (time.perf_counter() - t0) * 1e3

cold = run()
warm = [run() for _ in range(runs)]
best = min(warm)
print(f"cold {cold:.0f} ms  warm {best:.0f} ms  (runs: {', '.join(f'{w:.0f}' for w in warm)})")
if best > max_ms:
    print(f"WARM REINDEX {best:.0f} ms over the {max_ms:.0f} ms bar")
    sys.exit(1)
