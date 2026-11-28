# Activity: the event schema, run logs, sessions and replay

Every run leaves a trail: turns, reads, edits, tool calls, handoffs. B5 gives
that trail a schema, a per-run hot log, a cold ledger and a replay path that
seeks instead of scans.

## Event id and kinds

An event is identified by `(run, seat, seq)`. The seq is strictly rising per
seat within a run (each seat counts from 1); the timestamp is monotonic wall
clock in ms. The schema is `EventV2` in `src/events.rs`:

- `kind` ∈ `read | edit | refuse | test | tool | handoff | turn` – anything
  else round-trips as `Other(String)` so foreign kinds survive a mirror.
- `target` – a symbol id when the map knows one, else a path.
- `usage` – the token delta for the event, filled by B6 (capture_stream
  carries it through; nothing else interprets it).
- `op` – B2's op id, when the event belongs to an op.
- `msg`, `path`, `verdict` – free text, a file path, a test verdict.

## Hot path: the run log

While a run is live, events append as JSONL to `.kula/runs/<run>.jsonl` –
one line per event, nothing rewritten. `RunLog` batches fsyncs: the file is
flushed every 32 appends (`KULA_FSYNC_EVERY` for tests) and when dropped, so
a crash loses at most the last unfsynced tail. A torn final line (a crash
mid-write) is truncated away before the next append; it is never fatal.

Legacy events that name a run (the global `.kula/events.jsonl` log used by
`/api/agents/events`) are mirrored into the run log; events captured through
the run log mirror back into the global log with a `mirrored` flag so the
two can never echo-loop.

## Cold path: the ledger commit

At run end the log compacts into a ledger commit on
`refs/kula/runs/<run>` (the ref name is sanitized): the whole JSONL becomes
one blob at `events.jsonl` in the commit's tree, committed with the
previous ledger commit as parent. Compaction is idempotent – a `.led`
sidecar records `<len> <commit>` and a tree-equality check makes a second
compaction a no-op unless new events arrived, in which case a new commit
stacks on the old one. The CAS `update-ref` pattern (same as ops) means two
racing compactors cannot both win. Polling the route or MCP tool of an
ended run lazily triggers compaction.

## Index and replay

An `EventIndex` maps `(run, seat, seq) → byte offset` and is cached beside
the log (`.idx` sidecar, keyed on file length). `replay()` seeks to the
offset of the first wanted event and reads forward – never a scan from byte
0. `runs::replay()` is what `/api/runs/{id}/events?poll=1` and the MCP tool
`kula_events` both call, so the two doors cannot disagree.

## Sessions and spans

`runs::session_split` groups a seat's events into sessions, starting a new
session after a gap of more than five minutes. Within a session,
`span_nest` nests spans: a `turn` opens a span, `tool` events nest inside
the open turn as children, and other events stretch the open turn (or stand
alone when no turn is open).

## Recorded streams

`orch::event_capture` parses recorded agent streams into events – no live
agents needed for tests. Three formats, pinned by fixtures under
`tests/fixtures/streams/<cli>/stream.jsonl`:

- claude `stream-json`: `system/init`, `assistant` messages (text → turn,
  `tool_use` blocks → tool events with the `input.file_path` as target),
  `result` with token usage.
- codex `--json`: `task_started`, `agent_message`,
  `exec_command_begin` (command array → target = first word),
  `token_count` (usage delta), `task_complete`. `exec_command_end` lines
  are bookkeeping and produce no event, and are not counted as drift.
- gemini CLI json: tool calls with `args.path` (or `args.file_path`) as
  target, responses as turns.

Unknown JSON lines are counted as `skipped` and surfaced by
`capture_stream`; unknown non-JSON lines are ignored as noise.

## Doors

- HTTP: `GET /api/runs/{id}/events?seat=&from=&poll=1` answers one JSON
  poll; without `poll` it streams an SSE tail like `/api/agents/events`.
- MCP: the `kula_events` tool takes `run`, `seat`, `from`, `limit` and
  answers with the identical body.

## Proof

Unit and property tests in `src/events.rs` (seq monotone under random
multi-seat interleavings, replay equals live, torn-tail truncation, fsync
batching, compaction idempotence and ledger parent chain on a real git
repo), `src/runs.rs` (session gap split, turn → tool nesting),
`src/orch/event_capture.rs` (the three fixture parsers to pinned event
sequences), and `tests/b5.rs` (route vs MCP equality over the real `kula
view` and `kula mcp` binaries).
