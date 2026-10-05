#!/usr/bin/env python3
"""The launch film's score: boom-bap under Pachelbel.

Pachelbel's Canon in D (c. 1680, public domain) flipped the way hip-hop has
always flipped classical records – its eight-chord ground under a swung
boom-bap beat – but synthesised here from nothing, so the track carries no
licence but kula's own. Strings, a violin line, harpsichord and pizzicato are
plain numpy synthesis (detuned saws, Karplus-Strong plucks, FFT filters); the
drums are synthesised too. Same seed, same file.

The arrangement is the film's structure, bar for bar (90 BPM, 8/3 s a bar):

  intro    4 bars  strings alone, filter opening       the problem
  build    2 bars  riser, a muffled pulse, snare roll  the mark assembles
  drop A   8 bars  beat, sub, strings, harpsichord     the map: graph, contrast, impact
  break    4 bars  beat out, solo violin, space        agents, on your terms
  drop B   8 bars  beat back, pizzicato canon line     workflows, fences, memory
  outro    4 bars  one last hit, the final D major     kula 1.0

usage: python3 promo/score.py [out.wav] [--layout=long|film|launch]  → also writes cues.json beside it
"""

import json
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
BPM = 90
BEAT = 60 / BPM
BAR = 4 * BEAT
SWING = 0.57  # 16ths: the off-beat 16th lands at 57% of the 8th
RNG = np.random.default_rng(1680)

LAYOUTS = {
    # the long cut (promo/cut.py): 30 bars, 80 s
    "long": [("intro", 4), ("build", 2), ("dropA", 8), ("break", 4), ("dropB", 8), ("outro", 4)],
    # the film (promo/film, Remotion): 21 bars, 56 s
    "film": [("intro", 3), ("build", 1), ("dropA", 6), ("break", 2), ("dropB", 6), ("outro", 3)],
    # the launch film with the agent session: 45 bars, 2 minutes
    "launch": [("intro", 4), ("build", 3), ("dropA", 10), ("break", 4), ("dropB", 20), ("outro", 4)],
}
LAYOUT = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--layout=")), "long")
SECTIONS = LAYOUTS[LAYOUT]
OUTRO = dict(SECTIONS)["outro"]
BARS = sum(n for _, n in SECTIONS)
TAIL = 4.0
N = int((BARS * BAR + TAIL) * SR)


def section_of(bar):
    b = 0
    for name, n in SECTIONS:
        if bar < b + n:
            return name, bar - b
        b += n
    return "end", 0


def bar_start(name):
    b = 0
    for s, n in SECTIONS:
        if s == name:
            return b
        b += n
    raise KeyError(name)


# ------------------------------------------------------------------ pitch

NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(name):
    """'F#4' → Hz."""
    n, o = name[:-1], int(name[-1])
    midi = 12 * (o + 1) + NOTE[n]
    return 440.0 * 2 ** ((midi - 69) / 12)


# The ground: eight chords, two beats each, four bars round.
CHORDS = [
    # root (cello), inner voices, the canon's top line
    ("D3", ["A3", "D4", "F#4"], "F#5"),
    ("A2", ["A3", "C#4", "E4"], "E5"),
    ("B2", ["B3", "D4", "F#4"], "D5"),
    ("F#2", ["A3", "C#4", "F#4"], "C#5"),
    ("G2", ["B3", "D4", "G4"], "B4"),
    ("D2", ["A3", "D4", "F#4"], "A4"),
    ("G2", ["B3", "D4", "G4"], "B4"),
    ("A2", ["A3", "C#4", "E4"], "C#5"),
]
SUB = ["D1", "A1", "B1", "F#1", "G1", "D1", "G1", "A1"]
# An eighth-note line over the ground for drop B, chord tones and passing notes.
LINE = [
    ["D5", "F#5", "A5", "F#5"], ["E5", "C#5", "A4", "C#5"], ["D5", "B4", "F#5", "D5"], ["C#5", "A4", "F#5", "E5"],
    ["D5", "B4", "G5", "B5"], ["A5", "F#5", "D5", "F#5"], ["G5", "B5", "D6", "B5"], ["A5", "E5", "C#6", "A5"],
]

# ------------------------------------------------------------------ dsp


def t_of(n):
    return np.arange(n) / SR


def adsr(n, a=0.01, d=0.1, s=0.8, r=0.2):
    env = np.full(n, s, dtype=np.float64)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    env[:na] = np.linspace(0, 1, na, endpoint=False)
    nd2 = min(nd, max(0, n - na))
    env[na:na + nd2] = np.linspace(1, s, nd2, endpoint=False)
    nr = min(nr, n)
    if nr:
        env[-nr:] *= np.linspace(1, 0, nr)
    return env


def saw(f, n, phase=0.0, vib=None):
    """Naive sawtooth; aliasing sits far below the filters that follow."""
    if vib is None:
        ph = phase + np.cumsum(np.full(n, f / SR))
    else:
        ph = phase + np.cumsum(f * vib / SR)
    return 2 * (ph % 1.0) - 1


def shape(x, gain_of_hz):
    """Filter a whole buffer in the frequency domain."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * gain_of_hz(f), len(x))


def lowpass(fc, order=2):
    return lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order))


def highpass(fc, order=2):
    return lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order))


def bandpass(fc, q):
    return lambda f: 1 / np.sqrt(1 + (q * (f / fc - fc / np.maximum(f, 1e-3))) ** 2)


def place(buf, x, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(x))
    buf[i:j] += gain * x[: j - i]


def pan(mono, p):
    """p in -1..1, constant power."""
    a = (p + 1) * np.pi / 4
    return np.stack([mono * np.cos(a), mono * np.sin(a)])


def ks(f, dur, bright=0.5, decay=0.996):
    """Karplus-Strong pluck, vectorised one period at a time."""
    n = int(dur * SR)
    L = max(2, int(SR / f))
    noise = RNG.uniform(-1, 1, L)
    if bright < 1:
        k = max(1, int((1 - bright) * 6))
        noise = np.convolve(noise, np.ones(k) / k, mode="same")
    y = np.zeros(n + L)
    y[:L] = noise
    for s in range(L, n + L, L):
        prev = y[s - L:s]
        seg = 0.5 * (prev + np.roll(prev, 1)) * decay
        e = min(s + L, n + L)
        y[s:e] = seg[: e - s]
    out = y[:n]
    fade = int(0.01 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


# ------------------------------------------------------------------ voices


def string_voice(f, dur, detune=0.08, voices=5, attack=0.35, release=0.6, vibrato=True):
    n = int((dur + release) * SR)
    t = t_of(n)
    out = np.zeros(n)
    vib = 1 + (0.0035 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.3) / 0.6, 0, 1)) if vibrato else None
    for k in range(voices):
        cents = (k - (voices - 1) / 2) / ((voices - 1) / 2 or 1) * detune * 100
        out += saw(f * 2 ** (cents / 1200), n, RNG.uniform(), vib)
    out /= voices
    env = adsr(n, attack, 0.3, 0.85, release)
    return out * env


def violin(f, dur):
    n = int((dur + 0.4) * SR)
    t = t_of(n)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.6 * t + RNG.uniform(0, 6)) * np.clip((t - 0.25) / 0.5, 0, 1)
    x = saw(f, n, 0, vib) * 0.7 + saw(f * 1.002, n, 0.3, vib) * 0.3
    x += RNG.normal(0, 0.03, n)  # bow
    return x * adsr(n, 0.18, 0.2, 0.9, 0.4)


def kick(vel=1.0):
    n = int(0.45 * SR)
    t = t_of(n)
    f = 46 + 90 * np.exp(-t * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    click = RNG.normal(0, 1, n) * np.exp(-t * 400) * 0.25
    return np.tanh((body + click) * 1.6) * vel


def snare(vel=1.0):
    n = int(0.32 * SR)
    t = t_of(n)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 22) * 0.6
    noise = shape(RNG.normal(0, 1, n), bandpass(2400, 0.7)) * np.exp(-t * 15)
    clap = sum(shape(RNG.normal(0, 1, n), bandpass(1400, 1.2)) * np.exp(-np.maximum(t - d, 0) * 60) * (t >= d) for d in (0.0, 0.011, 0.023))
    return np.tanh((tone + noise * 0.9 + clap * 0.35) * 1.3) * vel


def hat(vel=1.0, open_=False):
    n = int((0.28 if open_ else 0.06) * SR)
    t = t_of(n)
    x = shape(RNG.normal(0, 1, n), highpass(7000, 3)) * np.exp(-t * (9 if open_ else 70))
    return x * vel


# ------------------------------------------------------------------ the arrangement


def step_time(bar, step):
    """16th `step` of `bar`, swung."""
    s16 = BEAT / 4
    off = (SWING - 0.5) * 2 * s16 if step % 2 else 0
    return bar * BAR + step * s16 + off


def render():
    strings = np.zeros((2, N))
    lead = np.zeros((2, N))
    plucks = np.zeros((2, N))
    drums = np.zeros((2, N))
    sub = np.zeros((2, N))
    fx = np.zeros((2, N))
    kicks = []

    for bar in range(BARS):
        sec, i = section_of(bar)
        for half in range(2):
            ci = (bar % 4) * 2 + half
            root, inner, top = CHORDS[ci]
            at = bar * BAR + half * 2 * BEAT
            dur = 2 * BEAT
            last = sec == "outro" and i >= OUTRO - 2
            if sec == "outro" and i == OUTRO - 1:
                continue  # the final chord rings through the last two bars
            if last:
                root, inner, top, dur = "D2", ["A3", "D4", "F#4"], "D5", 2 * BAR
                if half:
                    continue
            # strings: cello root, inner voices, top line
            place(strings[0], string_voice(hz(root), dur, voices=3) * 0.5, at)
            place(strings[1], string_voice(hz(root), dur, voices=3) * 0.5, at)
            for j, nname in enumerate(inner):
                v = string_voice(hz(nname), dur)
                p = [-0.5, 0.1, 0.5][j % 3]
                strings[:, int(at * SR):int(at * SR) + len(v)] += pan(v, p)[:, : max(0, min(len(v), N - int(at * SR)))] * 0.32
            if sec in ("intro", "break", "build", "outro"):
                v = violin(hz(top), dur)
                lead[:, int(at * SR):int(at * SR) + len(v)] += pan(v, 0.15)[:, : max(0, min(len(v), N - int(at * SR)))] * (0.42 if sec != "build" else 0.3)
            elif sec == "dropA":
                v = string_voice(hz(top), dur, voices=4, attack=0.12)
                lead[:, int(at * SR):int(at * SR) + len(v)] += pan(v, 0.2)[:, : max(0, min(len(v), N - int(at * SR)))] * 0.22
            # harpsichord arpeggios in the drops (16ths), pizzicato canon line in drop B (8ths)
            if sec in ("dropA", "dropB"):
                tones = [hz(x) * 2 for x in inner] + [hz(top)]
                for s in range(8):
                    tt = step_time(bar, half * 8 + s)
                    f = tones[[0, 1, 2, 3, 2, 1, 2, 3][s]]
                    pl = ks(f, 0.5, bright=0.95, decay=0.993)
                    plucks[:, int(tt * SR):int(tt * SR) + len(pl)] += pan(pl, -0.35 if s % 2 else 0.35)[:, : max(0, min(len(pl), N - int(tt * SR)))] * 0.16
            if sec == "dropB":
                for s, nname in enumerate(LINE[ci]):
                    tt = step_time(bar, half * 8 + s * 2)
                    pl = ks(hz(nname), 0.7, bright=0.6, decay=0.996)
                    plucks[:, int(tt * SR):int(tt * SR) + len(pl)] += pan(pl, 0.05)[:, : max(0, min(len(pl), N - int(tt * SR)))] * 0.42
            # sub bass under the drops
            if sec in ("dropA", "dropB") or (sec == "outro" and i == 0):
                nsub = int(dur * SR)
                t = t_of(nsub)
                s_ = np.sin(2 * np.pi * hz(SUB[ci]) * t) * adsr(nsub, 0.01, 0.2, 0.75, 0.08)
                s_ = np.tanh(s_ * 1.8) * 0.5
                sub[:, int(at * SR):int(at * SR) + nsub] += np.stack([s_, s_])[:, : max(0, min(nsub, N - int(at * SR)))]

        # drums
        if sec in ("dropA", "dropB") or (sec == "outro" and i == 0):
            fill = i % 4 == 3
            kpat = [0, 10] + ([7] if i % 2 else []) + ([13, 15] if fill else [])
            if sec == "outro":
                kpat = [0]
            for s in kpat:
                tt = step_time(bar, s)
                place(drums[0], kick(1.0 if s == 0 else 0.85), tt)
                place(drums[1], kick(1.0 if s == 0 else 0.85), tt)
                kicks.append(tt)
            for s in ([4, 12] if sec != "outro" else [4]):
                sn = snare(1.0)
                place(drums[0], sn * 0.9, step_time(bar, s))
                place(drums[1], sn, step_time(bar, s))
            if fill and sec != "outro":
                for s, v in ((14, 0.35), (15, 0.5)):
                    place(drums[1], snare(v), step_time(bar, s))
            if sec != "outro":
                for s in range(0, 16, 2):
                    v = 0.5 if s % 4 == 0 else 0.32
                    o = s == 14 and i % 2 == 1
                    h = hat(v, o)
                    place(drums[0], h * 0.6, step_time(bar, s))
                    place(drums[1], h, step_time(bar, s))
                for s in (3, 11):
                    place(drums[0], hat(0.12), step_time(bar, s))
        elif sec == "build":
            # a muffled four-on-the-floor that opens, then a snare roll into the drop
            for b in range(4):
                tt = bar * BAR + b * BEAT
                k = shape(kick(0.8), lowpass(180 + 300 * i, 2))
                place(drums[0], k, tt)
                place(drums[1], k, tt)
            if i == dict(SECTIONS)["build"] - 1:
                for s in range(8, 16):
                    v = 0.25 + 0.07 * (s - 8)
                    place(drums[0], snare(v), bar * BAR + s * BEAT / 4)
                    place(drums[1], snare(v), bar * BAR + s * BEAT / 4)

    # Riser across the build: noise swept up through a band-pass.
    b0 = bar_start("build") * BAR
    nr = int(dict(SECTIONS)["build"] * BAR * SR)
    t = t_of(nr)
    noise = RNG.normal(0, 1, nr)
    chunks = 32
    riser = np.zeros(nr)
    for c in range(chunks):
        a, e = c * nr // chunks, (c + 1) * nr // chunks
        seg = noise[a:e]
        riser[a:e] = shape(seg, bandpass(400 * 2 ** (c / chunks * 4.5), 1.5))
    riser *= (t / t[-1]) ** 2 * 0.5
    fx[:, int(b0 * SR):int(b0 * SR) + nr] += pan(riser, 0)

    # A soft impact on each drop.
    for s in ("dropA", "dropB"):
        at = bar_start(s) * BAR
        n = int(2.5 * SR)
        t = t_of(n)
        boom = np.sin(2 * np.pi * 38 * t) * np.exp(-t * 2.2) * 0.6 + shape(RNG.normal(0, 1, n), lowpass(900)) * np.exp(-t * 3) * 0.25
        fx[:, int(at * SR):int(at * SR) + n] += pan(boom, 0)

    # Vinyl: hiss and crackle the whole way through.
    hiss = shape(RNG.normal(0, 1, N), bandpass(3000, 0.4)) * 0.006
    crackle = np.zeros(N)
    idx = RNG.choice(N, size=int(N / SR * 9), replace=False)
    crackle[idx] = RNG.uniform(-1, 1, len(idx)) * RNG.uniform(0.05, 0.5, len(idx))
    crackle = shape(crackle, bandpass(2500, 0.6)) * 0.35
    fx += np.stack([hiss + crackle, hiss * 0.9 + np.roll(crackle, 37)])

    # Strings: warm, the filter opening through the intro and closing into the break.
    t = t_of(N)
    strings = np.stack([shape(ch, lambda f: lowpass(3600, 2)(f) * highpass(110, 2)(f)) for ch in strings])
    intro_end = bar_start("build") * BAR
    open_ = np.clip(t / intro_end, 0.15, 1.0)
    strings *= 0.55 + 0.45 * open_
    lead = np.stack([shape(ch, lambda f: lowpass(5200, 2)(f) * (0.6 + 0.8 * bandpass(1100, 1.2)(f) + 0.4 * bandpass(2900, 2)(f))) for ch in lead])
    plucks = np.stack([shape(ch, highpass(220, 1)) for ch in plucks])

    # The beat ducks the music a little on every kick.
    duck = np.ones(N)
    for k in kicks:
        i = int(k * SR)
        n = min(N - i, int(0.35 * SR))
        if n > 0:
            duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.38 * np.exp(-t_of(n) / 0.11))
    strings *= duck
    sub *= duck
    lead *= 0.6 + 0.4 * duck

    # One room: a synthetic hall, convolved.
    ir_n = int(2.6 * SR)
    ti = t_of(ir_n)
    ir = np.stack([RNG.normal(0, 1, ir_n), RNG.normal(0, 1, ir_n)]) * np.exp(-ti * 2.6)
    ir = np.stack([shape(ch, lowpass(5000, 1)) for ch in ir])
    ir /= np.abs(ir).sum(axis=1, keepdims=True) ** 0.5 * 40

    def verb(x, wet):
        L = 1 << int(np.ceil(np.log2(x.shape[1] + ir_n)))
        out = np.stack([np.fft.irfft(np.fft.rfft(x[c], L) * np.fft.rfft(ir[c], L), L)[: x.shape[1]] for c in range(2)])
        return x + out * wet

    music = verb(strings * 1.5 + lead * 1.6 + plucks * 1.5, 0.55)
    drums = verb(drums, 0.08)
    mix = music + drums * 0.8 + sub * 0.4 + fx * 0.9
    # master EQ: clear the mud, lift presence
    eq = lambda f: highpass(32, 2)(f) * (1 - 0.35 * bandpass(260, 0.8)(f)) * (1 + 0.7 * bandpass(2800, 0.5)(f))
    mix = shape(mix[0], eq), shape(mix[1], eq)
    mix = np.stack(mix)
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    mix /= np.abs(mix).max() / 0.89
    # fade the tail
    tail = int(TAIL * SR)
    mix[:, -tail:] *= np.linspace(1, 0, tail) ** 1.5
    return mix.astype(np.float32), kicks


def write_wav(path, x):
    pcm = (np.clip(x.T, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = Path(args[0] if args else "promo/out/score.wav")
    out.parent.mkdir(parents=True, exist_ok=True)
    mix, kicks = render()
    write_wav(out, mix)
    sections, b = [], 0
    for name, n in SECTIONS:
        sections.append({"name": name, "bar": b, "bars": n, "start": round(b * BAR, 4), "end": round((b + n) * BAR, 4)})
        b += n
    cues = {"bpm": BPM, "bar": BAR, "beat": BEAT, "bars": BARS, "duration": BARS * BAR + TAIL, "sections": sections, "kicks": [round(k, 4) for k in kicks]}
    out.with_name("cues.json").write_text(json.dumps(cues, indent=1))
    rms = lambda a, b_: float(np.sqrt(np.mean(mix[:, int(a * SR):int(b_ * SR)] ** 2)))
    for s in sections:
        print(f"{s['name']:6} {s['start']:6.2f}–{s['end']:6.2f}s  rms {rms(s['start'], s['end']):.3f}")
    print(f"→ {out} ({mix.shape[1] / SR:.1f}s)")


if __name__ == "__main__":
    main()
