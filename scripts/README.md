# Scripts

Optional helpers. Prefer the **`meshmoose` CLI** for day-to-day automation (see [docs/cli.md](../docs/cli.md)).

## Live smoke

With the API on `:8787` and a Zoo token available:

```bash
source .venv/bin/activate
export ZOO_API_TOKEN=…
python scripts/smoke_demo.py
# or
meshmoose demos run beverage-holder-stand --mode fast --wait
# partial-scan demo:
# meshmoose demos run partial-stand --mode thoughtful --wait
```

`smoke_demo.py` defaults to the `beverage-holder-stand` demo (`--demo` to override).

## Direct Agent validation

`validate_reconstruct.py` calls the Zoo ML Copilot WebSocket with demo photo + mesh + prompt (bypasses the MeshMoose job queue). Defaults to `demos/beverage-holder-stand/` and writes under that demo’s `results/` directory.

```bash
source .venv/bin/activate
export ZOO_API_TOKEN=…
python scripts/validate_reconstruct.py --mode thoughtful
```

## Other

| Script | Purpose |
|--------|---------|
| `copy-wasm.mjs` | Copies Zoo KCL wasm into `apps/web/public/` (`npm postinstall`) |
