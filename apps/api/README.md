# apps/api

FastAPI backend, Python client (`meshmoose_api.client`), and `meshmoose` CLI.

```bash
# from repo root
python3 -m venv .venv && source .venv/bin/activate
pip install -e "apps/api[dev]"
uvicorn meshmoose_api.main:app --reload --host 127.0.0.1 --port 8787

meshmoose --help
meshmoose jobs finish --list-presets
meshmoose mesh corrupt --help
```

Or `npm run dev:api` from the repo root.

## Surface

- Jobs: create, patch (title/tags), retry, refine, finish, cancel, delete, SSE events (`?after=`), artifacts
- Compare helpers: reference select, ICP align + deviation
- Timing: `active_ms` / `run_started_at` on job meta
- Export: retries retryable Zoo Engine hangups; sanitized job errors
- Demos: `GET /demos`, `POST /jobs/from-demo/{id}`
- Finishes: `GET /finishes`, `POST /jobs/{id}/finish`
- Photo normalize (HEIC/GIF/…), mesh preprocess (STL/PLY/OBJ/3MF/XYZ), 3MF export
- Offline CLI: `meshmoose mesh corrupt`

Interactive OpenAPI: http://127.0.0.1:8787/docs  

Docs: [HTTP API](../../docs/http-api.md) · [CLI](../../docs/cli.md) · [root README](../../README.md)
