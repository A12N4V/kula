#!/usr/bin/env python3
"""Cut the launch film to its score.

Every shot starts on a bar line of promo/out/score.wav (90 BPM, 8/3 s a bar),
so the edit is the music: one line of the problem a bar in the intro, the mark
on the build, a cut on every bar through the drops, one card in the break.
A shot names a window of its clip; the window is stretched or squeezed to fill
its bars exactly, and frame boundaries come from the bar grid, so nothing drifts.

  python3 promo/cut.py   → promo/out/kula-promo.mp4      1080p, the film
                           docs/assets/promo.mp4         720p, for the README
                           docs/assets/promo.gif         the drop, 1-bit dithered
"""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "promo/out"
CLIPS = OUT / "clips"
FPS = 30
cues = json.loads((OUT / "cues.json").read_text())
BAR = cues["bar"]

# (clip, bars, window start in the clip, window length or None for "exactly the slot")
EDL = [
    # intro – the problem
    ("problem", 4, 0.0, None),
    # build – the mark assembles and falls into itself
    ("mark", 2, 0.0, None),
    # drop A – the map
    ("graph", 2, 3.5, 4.5),   # the loader hands over to the map mid-shot
    ("impact", 1, 4.0, None),
    ("contrast", 2, 1.5, None),
    ("report", 1, 1.0, None),
    ("query", 1, 1.2, None),
    ("console", 1, 1.8, None),
    # break – agents, on your terms
    ("agents-card", 1, 0.0, None),
    ("fences", 2, 2.0, None),
    ("hook", 1, 1.6, None),
    # drop B – workflows, fences, memory, any agent
    ("agents", 2, 0.4, None),
    ("workflows", 1, 1.0, None),
    ("fence-edit", 1, 1.5, 4.0),
    ("memory", 1, 1.0, None),
    ("autofill", 1, 3.0, None),
    ("connect", 1, 0.9, None),
    ("finale", 1, 5.4, None),
    # outro – kula 1.0
    ("outro", 4, 0.0, None),
]
assert sum(b for _, b, _, _ in EDL) == cues["bars"], "the edit must fill the score"


def ff(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True)


def main():
    seg_dir = OUT / "segments"
    seg_dir.mkdir(parents=True, exist_ok=True)
    bar, listing = 0, ""
    for i, (clip, bars, start, span) in enumerate(EDL):
        f0, f1 = round(bar * BAR * FPS), round((bar + bars) * BAR * FPS)
        frames = f1 - f0
        slot = frames / FPS
        span = span or slot
        seg = seg_dir / f"{i:02d}-{clip}.mp4"
        ff("-ss", f"{start:.3f}", "-t", f"{span + 0.5:.3f}", "-i", CLIPS / f"{clip}.mp4",
           "-vf", f"setpts={slot / span:.6f}*PTS,fps={FPS},tpad=stop_mode=clone:stop_duration=2,format=yuv420p",
           "-frames:v", frames, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "14", seg)
        listing += f"file '{seg}'\n"
        print(f"bar {bar:2d}  {clip:12} {bars} bar{'s' if bars > 1 else ' '}  {slot:5.2f}s  ×{span / slot:.2f}")
        bar += bars
    (seg_dir / "list.txt").write_text(listing)
    silent = OUT / "picture.mp4"
    ff("-f", "concat", "-safe", 0, "-i", seg_dir / "list.txt", "-c", "copy", silent)

    # Picture holds black while the last chord rings out.
    film = OUT / "kula-promo.mp4"
    ff("-i", silent, "-i", OUT / "score.wav",
       "-vf", f"tpad=stop_mode=add:stop_duration={cues['duration'] - cues['bars'] * BAR:.3f}:color=black",
       "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
       "-c:a", "aac", "-b:a", "192k", "-shortest", film)

    assets = ROOT / "docs/assets"
    ff("-i", film, "-vf", "scale=1280:-2:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "26",
       "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k", assets / "promo.mp4")

    # The README loop: drop A, in a 1-bit-feeling palette with Bayer dither.
    a = next(s for s in cues["sections"] if s["name"] == "dropA")
    gif = assets / "promo.gif"
    ff("-ss", a["start"], "-t", 20, "-i", film,
       "-vf", "fps=10,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
       "-loop", 0, gif)
    for p in (film, assets / "promo.mp4", gif):
        print(f"→ {p.relative_to(ROOT)}  {p.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
