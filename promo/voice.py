#!/usr/bin/env python3
"""The film's voices: a narrator, and the two agents in the session.

Each line names the section it belongs to, a time into it in seconds, and who
speaks it; the cues come from the score (cues.json), so moving a section moves
its lines. Kokoro-82M (Apache-2.0, hexgrad/Kokoro-82M on Hugging Face) speaks
when it is installed – `uv venv promo/.venv && uv pip install kokoro soundfile`
– each speaker in their own voice; otherwise macOS `say` stands in. Lines are
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

# Who sounds like whom: Kokoro voice, and the macOS fallback.
VOICES = {
    "narrator": ("af_heart", "Samantha"),
    "claude": ("bf_emma", "Kate"),
    "cursor": ("am_michael", "Alex"),
}

# (section, seconds into it, speaker, the line). Spelled for the ear: "koola", "one point oh".
LINES = [
    ("intro", 0.4, "narrator", "Your AI writes more of your code every day."),
    ("intro", 3.6, "narrator", "But it can't see the shape of it. It touches what it shouldn't. And it forgets."),
    ("build", 0.2, "narrator", "Install koola. Run init."),
    ("build", 2.8, "narrator", "It maps your code, and connects your agents."),
    ("build", 5.9, "narrator", "This is koola."),
    ("dropA", 0.4, "narrator", "Every symbol, every call, every directory. A map you can walk through."),
    ("dropA", 8.2, "narrator", "Click a function, and see what breaks before you touch it."),
    ("dropA", 13.6, "narrator", "Compare a branch by what it does to your architecture, not just its lines."),
    ("dropA", 21.6, "narrator", "The whole graph is RDF. Ask it anything."),
    ("dropA", 26.9, "narrator", "And underneath, it's still just git."),
    ("break", 0.3, "narrator", "Now, let the agents in. On your terms."),
    ("break", 5.5, "narrator", "Claude Code and Cursor, on one repository, through one map."),
    ("dropB", 1.0, "claude", "There's no workflow for releases. I'll propose one."),
    ("dropB", 4.9, "claude", "A release agent: version, packaging, changelog. Source stays locked."),
    ("dropB", 10.0, "claude", "And I'll remember how releases work here."),
    ("dropB", 13.6, "narrator", "A person accepts it. Now it's a mode for every agent."),
    ("dropB", 18.9, "cursor", "Shipping one point oh point one, in release mode."),
    ("dropB", 23.0, "cursor", "Claude left a note: bump Cargo, packaging and the changelog together."),
    ("dropB", 28.3, "cursor", "I reached into store dot R S. Koola stopped me: source is locked."),
    ("dropB", 33.2, "cursor", "Version bumped. Nothing else touched."),
    ("dropB", 37.5, "claude", "Verified. Nothing fenced was touched."),
    ("dropB", 40.7, "narrator", "Every workflow brings its own fences. You see them on the map."),
    ("dropB", 45.0, "narrator", "And what agents learn stays with the code."),
    ("outro", 0.6, "narrator", "Koola one point oh. Git, with a map. For you, and your agents."),
]


def ff(*a):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, a)], check=True)


def duration(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


_pipes = {}


def speak_kokoro(text, out, speed, who):
    from kokoro import KPipeline  # noqa: optional
    import numpy as np
    import soundfile as sf

    voice = os.environ.get(f"KULA_VOICE_{who.upper()}", VOICES[who][0])
    lang = voice[0]  # a: American, b: British
    if lang not in _pipes:
        _pipes[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    audio = np.concatenate([a for _, _, a in _pipes[lang](text, voice=voice, speed=speed)])
    sf.write(out, audio, 24000)


def speak_say(text, out, speed, who):
    aiff = out.with_suffix(".aiff")
    subprocess.run(["say", "-v", VOICES[who][1], "-r", str(int(178 * speed)), "-o", aiff, text], check=True)
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
    starts = [start_of[s] + o for s, o, _, _ in LINES]
    out = []
    for i, (sec, off, who, text) in enumerate(LINES):
        room = (starts[i + 1] if i + 1 < len(starts) else cues["duration"]) - starts[i] - 0.25
        raw, final = dest / "vo" / f"{i:02d}.raw.wav", dest / "vo" / f"{i:02d}.wav"
        speed = 1.0
        for _ in range(6):
            speak(text, raw, speed, who)
            if duration(raw) <= room:
                break
            speed *= min(1.25, duration(raw) / room * 1.02)
        # clean, even, broadcast-ish: no rumble, a little compression, -16 LUFS, a short tail fade
        ff("-i", raw, "-af", "highpass=f=90,lowpass=f=12000,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7",
           "-ar", 48000, "-ac", 2, final)
        raw.unlink()
        d = duration(final)
        out.append({"file": f"vo/{i:02d}.wav", "start": round(starts[i], 3), "duration": round(d, 3), "section": sec, "speaker": who, "text": text.replace("koola", "kula").replace("Koola", "Kula").replace("dot R S", ".rs")})
        print(f"{starts[i]:6.2f}s  {d:4.2f}s  ×{speed:.2f}  {who:8} {text}")
    (dest / "vo.json").write_text(json.dumps({"engine": name, "lines": out}, indent=1))
    print(f"→ {dest / 'vo.json'} ({name})")


if __name__ == "__main__":
    main()
