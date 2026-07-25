# CLI

The `meshmoose` command talks to the local HTTP API. Install it with the API package:

```bash
pip install -e "apps/api[dev]"
meshmoose --help
```

Requires the API process (`npm run dev` or `npm run dev:api`) unless you only use offline commands (`--help`, `mesh corrupt`).

## Auth & config

| Flag / env | Meaning |
|------------|---------|
| `--token` / `ZOO_API_TOKEN` / `ZOO_SECRET_KEY` / `MESHMOOSE_TOKEN` | Zoo Bearer token |
| `--base` / `MESHMOOSE_BASE` | API URL (default `http://127.0.0.1:8787`) |
| `--json` | Prefer JSON where listings are tabular by default |
| `--http-timeout` | HTTP client timeout seconds |
| `.env.local` | Optional; loaded for token defaults (never commit) |

## Commands

```text
meshmoose health
meshmoose completion bash|zsh
meshmoose usage [--watch] [--interval SECS]
meshmoose demos list
meshmoose demos run <demo_id> [--mode] [--prompt] [--wait] [--timeout]
meshmoose jobs list
meshmoose jobs get <id>
meshmoose jobs create --prompt TEXT --photo PATH --mesh PATH [--mode] [--title] [--tag] [--wait]
meshmoose jobs wait <id> [--timeout]
meshmoose jobs cancel <id>
meshmoose jobs retry <id> [--wait] [--timeout]
meshmoose jobs delete <id>
meshmoose jobs rename <id> [--title TEXT] [--tag TAG ...]
meshmoose jobs logs <id> [--lines N]
meshmoose jobs refine <id> --message TEXT [--photo] [--mesh] [--wait]
meshmoose jobs finish <id> --preset PRESET [--wait]
meshmoose jobs finish --list-presets
meshmoose jobs save-kcl <id> --file PATH [--note TEXT] [--reexport] [--wait]
meshmoose jobs kcl-versions <id>
meshmoose jobs kcl-restore <id> VERSION_ID [--note TEXT] [--reexport] [--wait]
meshmoose jobs artifacts <id>
meshmoose jobs download <id> [--out DIR] [--file REL]
meshmoose mesh corrupt INPUT [-o OUT] [--missing] [--noise] [--artifacts] [--seed]
```

`mesh corrupt` is offline (no API): turns a clean STL / PLY / OBJ / 3MF into a partial noisy “scan” for pipeline demos and tests.

Agent `--mode` for `demos run` / `jobs create`: `thoughtful` (default), `fast`, `auto`, or `zookeeper_pro` (API/CLI; the web New-job modal offers the first three).

Every subcommand supports `--help` with examples.

`jobs retry` clones a **failed** job’s prompt, title, tags, and input files into a new run (same as `POST /jobs/{id}/retry`).

`jobs finish` patches `main.kcl` with a PBR `appearance(...)` preset and re-exports STL / STEP / 3MF (no Agent call).

`jobs save-kcl` writes `outputs/main.kcl` from a local file, archives the previous file under `kcl_history/`, and records a prompt-history `edit` entry. `--reexport` queues STL/STEP/3MF export (Engine minutes); use `--wait` to poll until done.

`jobs kcl-versions` / `jobs kcl-restore` list and restore archived KCL snapshots (same as the Iterate tab).

`jobs rename` updates the title and/or replaces tags (same as `PATCH /jobs/{id}`). Omit `--tag` to keep existing tags.

`jobs logs` prints the tail of a job's human-readable `outputs/job.log`.

`usage --watch` polls credits / recent-call totals every `--interval` seconds until interrupted — handy while a long `thoughtful` run burns minutes. In the web UI, the same data lives under **API key** (with optional 10‑minute auto-refresh).

`completion` prints a shell completion script. Enable it with:

```bash
eval "$(meshmoose completion bash)"   # bash
eval "$(meshmoose completion zsh)"    # zsh (or save to a directory on your fpath)
```

## Finish presets

```bash
meshmoose jobs finish --list-presets
```

Ids include: `polished-aluminum`, `brushed-aluminum`, `stainless-steel`, `anodized-red`, `matte-plastic`, `glossy-plastic`, `rubber`, `glass`.

## Examples

```bash
# Health
meshmoose health

# Packaged demo (waits for Zoo Agent + Engine — can take minutes)
export ZOO_API_TOKEN=…
meshmoose demos run beverage-holder-stand --mode fast --wait

# Partial-scan demo (corrupt mesh + photos)
meshmoose demos run partial-stand --mode thoughtful --wait

# Custom reconstruct
meshmoose jobs create \
  --prompt "Make a beverage stand from this photo and scan" \
  --photo ./stand.jpg \
  --mesh ./stand.stl \
  --title "Beverage stand" \
  --tag stand \
  --mode thoughtful \
  --wait

# Apply a surface finish and re-export
meshmoose jobs finish "$JOB_ID" --preset brushed-aluminum --wait

# Retry a failed job
meshmoose jobs retry "$FAILED_JOB_ID" --wait

# Refine + download exports
meshmoose jobs refine "$JOB_ID" --message "Thicken the rim by 0.5 mm" --wait
meshmoose jobs download "$JOB_ID" --out ./exports

# Simulate an incomplete scan (offline)
meshmoose mesh corrupt demos/beverage-holder-stand/lidl-jar-stand.stl \
  -o /tmp/stand_partial.stl --missing 0.35 --noise 0.5 --artifacts 4 --seed 7
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | API / job failure |
| `2` | Invalid CLI usage |
| `130` | Interrupted |

## Programmatic use

Prefer `meshmoose_api.client.MeshMooseClient` in Python (same surface the CLI uses). See [HTTP API](http-api.md).
