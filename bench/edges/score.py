#!/usr/bin/env python3
"""Score kula's CALLS edges against hand-labelled truth.

usage: score.py [--kula PATH] [--min-precision 0.0]
Truth is (caller, callee) names per fixture in truth.json. Prints precision and
recall overall and per confidence tier. Exits 1 if precision < --min-precision.
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile

here = os.path.dirname(os.path.abspath(__file__))
kula = "kula"
min_p = 0.0
a = sys.argv[1:]
while a:
    k = a.pop(0)
    if k == "--kula": kula = a.pop(0)
    elif k == "--min-precision": min_p = float(a.pop(0))
truth = json.load(open(os.path.join(here, "truth.json")))
tot = {"tp": 0, "fp": 0, "fn": 0}
tier = {}
langs = {}
for lang, edges in truth.items():
    d = tempfile.mkdtemp()
    try:
        shutil.copytree(os.path.join(here, "fixtures", lang), d, dirs_exist_ok=True)
        subprocess.run(["git", "init", "-q"], cwd=d, check=True)
        subprocess.run(["git", "add", "-A"], cwd=d, check=True)
        subprocess.run(["git", "-c", "user.email=a@b", "-c", "user.name=x", "commit", "-qm", "f"], cwd=d, check=True)
        subprocess.run([kula, "index"], cwd=d, check=True, capture_output=True)
        con = sqlite3.connect(os.path.join(d, ".kula", "graph.db"))
        rows = con.execute(
            "SELECT s.name, t.name, e.confidence FROM edges e JOIN nodes s ON s.id=e.src JOIN nodes t ON t.id=e.dst "
            "WHERE e.kind='CALLS' AND s.kind!='file' AND t.kind!='file'").fetchall()
        want = {tuple(e) for e in edges}
        got = {}
        for s, t, c in rows:
            got[(s, t)] = c
        for e, c in got.items():
            ok = e in want
            tot["tp" if ok else "fp"] += 1
            t = tier.setdefault(c, {"tp": 0, "fp": 0})
            t["tp" if ok else "fp"] += 1
        miss = want - set(got)
        tot["fn"] += len(miss)
        for m in sorted(miss): print(f"  [{lang}] missed {m[0]} -> {m[1]}")
        for e, c in sorted(got.items()):
            if e not in want: print(f"  [{lang}] wrong  {e[0]} -> {e[1]} ({c})")
        langs[lang] = {"tp": tot["tp"] - sum(v["tp"] for v in langs.values()),
                       "fp": tot["fp"] - sum(v["fp"] for v in langs.values()),
                       "fn": tot["fn"] - sum(v["fn"] for v in langs.values())}
    finally:
        shutil.rmtree(d, ignore_errors=True)
p = tot["tp"] / max(1, tot["tp"] + tot["fp"])
r = tot["tp"] / max(1, tot["tp"] + tot["fn"])
print(f"overall precision {p:.2f} recall {r:.2f}  (tp {tot['tp']} fp {tot['fp']} fn {tot['fn']})")
for c, v in sorted(tier.items()):
    print(f"  {c:9} precision {v['tp']/max(1,v['tp']+v['fp']):.2f}  ({v['tp']}/{v['tp']+v['fp']})")
for lang, v in langs.items():
    lp = v["tp"] / max(1, v["tp"] + v["fp"])
    lr = v["tp"] / max(1, v["tp"] + v["fn"])
    print(f"  {lang:4} precision {lp:.2f} recall {lr:.2f}  (tp {v['tp']} fp {v['fp']} fn {v['fn']})")
sys.exit(1 if p < min_p else 0)
