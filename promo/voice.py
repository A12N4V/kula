#!/usr/bin/env python3
"""The film's voiceover: one line per beat of the story, placed on the score.

Each line names the section it belongs to and a time into it, in seconds; the
cues come from the score (cues.json), so moving a section moves its lines.
Lines are spoken by Kokoro when it is installed (`pip install kokoro soundfile`,
voice af_heart), otherwise by macOS `say` (KULA_VOICE, default Samantha), then
cleaned up with ffmpeg: high-pass, gentle compression, loudness to -16 LUFS.
A line that runs past the next one is spoken faster until it fits.

usage: python3 promo/voice.py promo/film/public   → vo/NN.wav and vo.json there
"""

import json
import os
import subprocess
import sys
import wave
from pathlib import Path

# (section, seconds into it, the line). Spelled for the ear: "koola", "one point oh".
LINES = [
    ("intro", 0.5, "Your AI writes more of your code every day."),
    ("intro", 3.7, "But it can't see the shape of it, it touches what it shouldn't, and it forgets."),
    ("build", 0.3, "This is koola."),
    ("dropA", 0.35, "Your repository, as a map. Every symbol. Every call."),
    ("dropA", 5.6, "See what breaks before you change it, and what a branch does to your architecture."),
    ("dropA", 11.4, "Ask it anything. And it's still just git."),
    ("break", 0.3, "Now, let your agents in. On your terms."),
    ("dropB", 0.3, "Workflows tell every agent how work gets done here."),
    ("dropB", 5.5, "Fences lock what they must not touch, down to a single function."),
    ("dropB", 10.8, "And memory stays pinned to the code, so it knows when it's stale."),
    ("outro", 0.6, "Koola, one point oh. Git, with a map. For you, and your agents."),
]


def ff(*a):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, a)], check=True)


def duration(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def speak_kokoro(text, out, speed):
    from kokoro import KPipeline  # noqa: optional
    import numpy as np
    import soundfile as sf

    pipe = KPipeline(lang_code="a")
    audio = np.concatenate([a for _, _, a in pipe(text, voice=os.environ.get("KULA_VOICE", "af_heart"), speed=speed)])
    sf.write(out, audio, 24000)


def speak_say(text, out, speed):
    aiff = out.with_suffix(".aiff")
    subprocess.run(["say", "-v", os.environ.get("KULA_VOICE", "Samantha"), "-r", str(int(178 * speed)), "-o", aiff, text], check=True)
    ff("-i", aiff, out)
    aiff.unlink()


def engine():
    try:
        import kokoro  # noqa: F401
        import soundfile  # noqa: F401
        return "kokoro", speak_kokoro
    except ImportError:
        return "say", speak_say


def main():
    dest = Path(sys.argv[1] if len(sys.argv) > 1 else "promo/film/public")
    cues = json.loads((dest / "cues.json").read_text())
    start_of = {s["name"]: s["start"] for s in cues["sections"]}
    (dest / "vo").mkdir(parents=True, exist_ok=True)
    name, speak = engine()
    starts = [start_of[s] + o for s, o, _ in LINES]
    out = []
    for i, (sec, off, text) in enumerate(LINES):
        room = (starts[i + 1] if i + 1 < len(starts) else cues["duration"]) - starts[i] - 0.25
        raw, final = dest / "vo" / f"{i:02d}.raw.wav", dest / "vo" / f"{i:02d}.wav"
        speed = 1.0
        for _ in range(6):
            speak(text, raw, speed)
            if duration(raw) <= room:
                break
            speed *= min(1.25, duration(raw) / room * 1.02)
        # clean, even, broadcast-ish: no rumble, a little compression, -16 LUFS, a short tail fade
        ff("-i", raw, "-af", "highpass=f=90,lowpass=f=12000,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7",
           "-ar", 48000, "-ac", 2, final)
        raw.unlink()
        d = duration(final)
        out.append({"file": f"vo/{i:02d}.wav", "start": round(starts[i], 3), "duration": round(d, 3), "section": sec, "text": text.replace("koola", "kula").replace("Koola", "Kula")})
        print(f"{starts[i]:6.2f}s  {d:4.2f}s  ×{speed:.2f}  {text}")
    (dest / "vo.json").write_text(json.dumps({"engine": name, "lines": out}, indent=1))
    print(f"→ {dest / 'vo.json'} ({name})")


if __name__ == "__main__":
    main()
