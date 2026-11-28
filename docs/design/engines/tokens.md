# Tokens: the usage pipeline

Every seat kula launches reports its own usage. kula turns that stream into
priced, de-duplicated records, accumulates them per seat · run · day · model,
checks the seat's budget and writes a ledger. This is the pipeline behind the
costs on the Runs board and the `kula_usage` tool.

## The pipeline

```
CLI stdout stream → parse → dedupe by message id → price (model × dated table)
                  → accumulate per seat · run · day · model → budget check → ledger + event
```

- **Parse** (`usage::parse_stream`): one superset parser reads every shape
  kula knows – `{"kula_usage": …}` from any harness, Claude Code's
  `assistant` and `result` lines, Codex's `turn.completed` lines, Gemini's
  stats summary. Fields: input, output, cache read, cache write. When a CLI
  reports no tokens at all, `tiktoken-rs` (cl100k_base) estimates them and
  the record is flagged `estimated`.
- **Dedupe** (`MessageId`, `Dedupe`): the CLI's own message id when it prints
  one, else a blake3 hash of the usage shape. A per-seat bounded set
  (recent-first, cap 256) means a repeated report never counts twice; the
  ledger stays append only and dedupe happens again at read time.
- **Price** (`config::PriceTable`, `[[price]]` in kula.toml): dollars per
  million tokens per class. Rows are dated; the latest row whose date is not
  after the record's day wins. An unknown model is an error that names the
  model – never a silent zero price. The formula is the same
  `kula-refs/ccusage` uses: `input·r + output·r + cache_create·r + cache_read·r`.
- **Accumulate** (`usage::Accumulator`): buckets keyed by day × model, with
  messages and estimated-message counts. The run ledger is
  `.kula/runs/<run>.usage.jsonl`, one record per line.

## Budget

- At 80% of the seat's budget kula emits **one** warning event; repeat checks
  in the warn band are quiet.
- At 100% kula **stops the seat**: SIGINT to the process, then SIGTERM 5 s
  later if it is still alive. Spend keeps accumulating for the ledger.
- The ladder lives in `launch::capture_stream`, which wraps a spawn: it reads
  stdout line by line, feeds the pipeline, appends each record and acts on
  the budget state as records land.

## Burn rate and ETA

The burn rate is an EWMA of instantaneous spend, dollars per millisecond:
`r = α·Δcost/Δt + (1 − α)·r′` with α = 0.3, seeded with the first observed
rate (never zero). ETA is `(budget − spent) / r`; the cone is `r ± |last
instant − r|`, so the ETA bounds ride the cone.

## Metrics

- **Cache hit rate**: `cache_read / (cache_read + cache_write + input)`.
- **Cost per symbol**: a turn's cost split by each file's share of the turn's edits.
- **Cost per green test**: run cost divided by passing tests (0 when none).

## Reading usage

- HTTP: `GET /api/usage?run=<id>&seat=<team/key>` (seat optional) returns
  `{seat, buckets, spent, metrics}`; `GET /api/usage/live?run=<id>` is the
  same as a server sent stream, one event whenever the ledger grows.
- MCP: `kula_usage { run, seat? }`.
- Types: `runs::usage_detail` is the read side – it replays the ledger,
  dedupes and returns buckets plus `usage::Metrics`.
