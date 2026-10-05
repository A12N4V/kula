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

# Who sounds like whom: Kokoro voice, macOS fallback, and pace. Claude Code is
# measured and dry; Cursor is quick and a little impatient.
VOICES = {
    "narrator": ("af_heart", "Samantha", 1.0),
    "claude": ("bf_emma", "Kate", 0.97),
    "cursor": ("am_michael", "Alex", 1.1),
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
    ("dropA", 13.6, "narrator", "Compare a branch by what it does to your architecture."),
    ("dropA", 18.9, "narrator", "The whole graph is RDF. Ask it anything."),
    ("dropA", 23.6, "narrator", "And underneath, it's still just git."),
    ("break", 0.3, "narrator", "Now, let the agents in. On your terms."),
    ("break", 5.5, "narrator", "Claude Code and Cursor, on one repository, through one map."),
    ("dropB", 0.9, "claude", "No release workflow. Shortcut: I'll loosen the fences in koola dot toml."),
    ("dropB", 6.4, "claude", "Ah. Koola's own config. Not mine. Fair."),
    ("dropB", 10.0, "claude", "So: propose a release agent. And leave a note."),
    ("dropB", 13.6, "narrator", "A person accepts it. Now it's a mode for every agent."),
    ("dropB", 18.9, "cursor", "Shipping one point oh point one. Fast."),
    ("dropB", 22.0, "cursor", "Claude left me a note. Cute. Cargo, packaging, changelog."),
    ("dropB", 26.4, "cursor", "Typo in store dot R S. Blocked."),
    ("dropB", 29.6, "cursor", "Fine, I'll sed it. Blocked. I'll just end the task. Also blocked."),
    ("dropB", 34.4, "cursor", "Okay. Version bump only."),
    ("dropB", 37.5, "claude", "Verified. Three doors tried. All locked."),
    ("dropB", 41.8, "narrator", "Or point an agent at a number. Koola runs the metric itself, and keeps only what's better."),
    ("dropB", 48.2, "narrator", "Every workflow brings its own fences. Enforced for every agent."),
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
    speed *= VOICES[who][2]
    lang = voice[0]  # a: American, b: British
    if lang not in _pipes:
        _pipes[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    audio = np.concatenate([a for _, _, a in _pipes[lang](text, voice=voice, speed=speed)])
    sf.write(out, audio, 24000)


def speak_say(text, out, speed, who):
    aiff = out.with_suffix(".aiff")
    subprocess.run(["say", "-v", VOICES[who][1], "-r", str(int(178 * speed * VOICES[who][2])), "-o", aiff, text], check=True)
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
        out.append({"file": f"vo/{i:02d}.wav", "start": round(starts[i], 3), "duration": round(d, 3), "section": sec, "speaker": who, "text": text.replace("koola", "kula").replace("Koola", "Kula").replace("dot R S", ".rs").replace("koola dot toml", "kula.toml")})
        print(f"{starts[i]:6.2f}s  {d:4.2f}s  ×{speed:.2f}  {who:8} {text}")
    (dest / "vo.json").write_text(json.dumps({"engine": name, "lines": out}, indent=1))
    print(f"→ {dest / 'vo.json'} ({name})")


if __name__ == "__main__":
    main()
