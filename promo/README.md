# The launch film

Two cuts, both made by the scripts in this folder from the real app – no screen recorder, no stock footage, no licensed music.

- **The film** (`promo/film`, Remotion, 2 min): three voices, a real `kula init` and a real two-agent session, an isometric world built from the mark, and a camera that zooms in on every click and burst of typing. This is `docs/assets/promo.mp4`.
- **The long cut** (`cut.py`, ffmpeg, 84 s): the same score at full length, hard cuts on the bar, captions baked into the shots.

## The film

```sh
sh promo/film.sh              # score → voices → init + agent session → app shots → Remotion → web copies
sh promo/film.sh render       # just re-render after editing promo/film/src
cd promo/film && pnpm studio  # scrub it in Remotion Studio
```

| bars | section | picture | voice |
|---|---|---|---|
| 0–4 | intro | an isometric city of code – the mark's cells as files, calls along the ground – loses its shape | narrator: the problem |
| 4–7 | build | `brew install`, then `kula init` – its real output, wiring up Claude Code and Cursor; the city folds into the mark | narrator: "Install kula. Run init." |
| 7–17 | drop A | the map, impact, contrast, SPARQL, the console – the camera finds each click | narrator |
| 17–21 | break | fences rise around the city; Claude Code and Cursor wired to one map | narrator: "Now, let the agents in." |
| 21–41 | drop B | the session: Claude Code tries to loosen the fences in kula.toml – refused – and proposes a `release` workflow instead; a person accepts it; Cursor ships 1.0.1 in it, refused three times on the way (an edit, the same edit through `sed`, `kula task done`); Claude Code verifies; then an autoresearch loop and the team, on the code graph's renderer | Claude Code (dry), Cursor (quick), narrator |
| 41–45 | outro | the mark, the name, the install line typed out | narrator: "Kula one point oh." |

- **The session is real.** `session.py` signs in to `kula mcp` as Claude Code and as Cursor (MCP `clientInfo`, the way they sign in themselves) and runs the real pre-edit hook with each agent's payload. Claude Code's half runs inside the capture fixture, so its suggestion waits in the UI and the accept shot really accepts it; Cursor's half runs right after. Every tool result, hook verdict and memory in the film is what kula answered, saved to `session.json` and replayed by `src/Agents.tsx`. `init.sh` does the same for the install scene. The two agents' windows are drawn in Remotion, not screen-recorded.
- **Camera.** `capture.mjs` (with `PROMO_FILM=1`) logs every click and typing burst with its position, and `src/Shot.tsx` eases toward each one. App shots float in as windows at an angle, settle flat, and fill the frame whenever the camera closes in. The drawn scenes have camera keys of their own.
- **No hard cuts.** Every shot starts 14 frames early and dissolves in over the one before while pushing in (`Film.tsx`), still landing on the bar line.
- **Isometric world.** `src/Iso.tsx` projects the mark's 17 cells as cubes on a grid; one parameter blends the isometric view into a straight-down one, which is how the city becomes the logo.
- **Voices.** `voice.py` places each line on the score from `cues.json` and speaks it with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0, runs locally): `af_heart` narrates, `bf_emma` is Claude Code (measured, dry) and `am_michael` is Cursor (a touch faster, impatient) (`KULA_VOICE_NARRATOR`, `KULA_VOICE_CLAUDE`, `KULA_VOICE_CURSOR` change them). Install it with `uv venv --python 3.12 promo/.venv && VIRTUAL_ENV=promo/.venv uv pip install kokoro "transformers>=4.45" soundfile`; without it, macOS `say` stands in. Lines are mastered to -16 LUFS, and the score ducks about 8 dB under each.

## The long cut

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
