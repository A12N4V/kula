# The launch film

An 84-second film cut to its own score. Everything in it is made by the scripts in this folder from the real app – no screen recorder, no stock footage, no licensed music.

```sh
python3 promo/score.py          # the score            → promo/out/score.wav, cues.json
node promo/capture.mjs          # every shot           → promo/out/clips/*.mp4
python3 promo/cut.py            # the edit, on the bar → promo/out/kula-promo.mp4,
                                #                        docs/assets/promo.mp4, promo.gif
```

Needs `ffmpeg`, Python 3 with numpy, and the web UI's dependencies (`pnpm -C web install`, for Playwright). Set `PW_CHROMIUM` to a local Chromium if Playwright's own is not installed. `node promo/capture.mjs graph agents` re-takes just those shots.

## The score

Boom-bap under Pachelbel. The Canon in D (c. 1680) is in the public domain, and its eight-chord ground is the kind of loop hip-hop has always flipped from classical records; here it is played, not sampled. `score.py` synthesises everything with numpy: strings from detuned saws, a violin line with vibrato and bow noise, harpsichord and pizzicato from Karplus-Strong plucks, a synthesised kick, snare and hats swung at 57%, a sub-bass that ducks under the kick, vinyl crackle, and a convolution hall. Same seed, same file – and no licence on it but kula's own.

| bars | section | music | picture |
|---|---|---|---|
| 0–4 | intro | strings alone, the filter opening | the problem, one line a bar |
| 4–6 | build | riser, a muffled pulse, a snare roll | the mark assembles and falls into its own centre |
| 6–14 | drop A | the beat, sub, harpsichord arpeggios | the map: graph, impact, contrast, review, SPARQL, the console |
| 14–18 | break | the beat drops out; a solo violin | "Now let the agents in. On your terms." Fences, the hook |
| 18–26 | drop B | the beat returns with a pizzicato line | workflows, fence editing, memory, autofill, any agent |
| 26–30 | outro | one last hit, the final D major | kula 1.0, and how to install it |

At 90 BPM a bar is 8/3 s. `cues.json` records every section and kick, and `cut.py` places every shot on a bar line by frame number, so the cut cannot drift from the music.

## The shots

- **Typographic scenes** (`scenes/*.html`) draw a frame for a time `t` with `window.render(t)` – canvas, ordered dither, the mark drawn recursively from its seven rows – and are rendered frame by frame at 30 fps.
- **App shots** are the real UI driven by Playwright against a disposable seeded clone of this repository (`web/e2e/fixture.sh`: fences, a task in the `fix` workflow, memories, a branch to contrast, an agent's suggestion), recorded through the DevTools screencast at 1920×1080. A cursor and a caption are injected into the page so the interactions read on screen.

To change the story, edit the shot list in `capture.mjs` (what happens, the caption) and the edit list in `cut.py` (which bars, which window of each clip).
