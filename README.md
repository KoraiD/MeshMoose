# MeshMoose.ai

<p align="center">
  <img src="docs/assets/logo.png" alt="MeshMoose logo" width="160" height="160" />
</p>

**From rough scans to editable CAD.**

Multimodal reconstruction for DIY makers: turn a **phone photo + quick scan** into parametric KCL, then refine it in plain language.

Built for the [Zoo API Makeathon](https://zoo.dev/events/api-makeathon) (July–August 2026).

## Why

Photos alone under-specify geometry. Quick meshes alone are frozen triangles. MeshMoose combines **photo + mesh + prompt**, asks Zoo’s Agent to **recreate parametric KCL** (not edit the import), then lets you compare, finish, export, and refine — from the **browser UI**, **HTTP API**, or **`meshmoose` CLI**.

## Zoo APIs used

| API | Role |
|-----|------|
| **Agent** (ML Copilot / Zookeeper) | Photo + mesh + prompt → editable `main.kcl`; refine continues the conversation |
| **Engine** (`zoo-kcl` + `@kittycad/web-view`) | Execute KCL → export STL/STEP; optional live WebRTC preview |
| **File Format** | Volume / surface area / mass / center-of-mass (reference vs generated) |
| **Account** | Credits and recent billable calls in Settings / `meshmoose usage` |

## Quick start

Prerequisites: Python **3.11+**, Node **20+**, a [Zoo](https://zoo.dev) API token.

```bash
git clone https://github.com/KoraiD/MeshMoose.git
cd MeshMoose

python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e "apps/api[dev]"     # installs API + `meshmoose` CLI

npm install

cp .env.example .env.local         # optional; set ZOO_API_TOKEN=…
npm run dev                        # API :8787 + web :5173
```

On **Windows**, `npm run dev:api` / `npm run test:api` invoke `sh -c` — use Git Bash, WSL, or run `uvicorn` / `pytest` directly from an activated venv.

- **UI:** http://127.0.0.1:5173 → Settings → paste token → New job (or open **Docs** in the app)
- **API docs:** http://127.0.0.1:8787/docs  
- **CLI:** `meshmoose health` · `meshmoose demos list` · `meshmoose --help`
- **Repo:** https://github.com/KoraiD/MeshMoose

If `npm run dev` exits with `Address already in use`, free port **8787** and retry:

```bash
kill $(lsof -t -iTCP:8787 -sTCP:LISTEN) 2>/dev/null
npm run dev
```

## Features

- Local-first jobs: history, live SSE logs, cancel, delete, **retry** failed runs
- Job **rename** and up to **5 tags**; sidebar filter by name, ID, tag, state, time
- **Settings**: API token, theme (light / dark / system), Zoo usage, app log, **prompt templates**
- New-job modal: title, templates, agent mode (`thoughtful` / `fast` / `auto`), multi photo + mesh, local STL preview, packaged demos
- **Photos:** JPG / PNG / WebP / GIF / HEIC / HEIF (HEIC→JPEG, GIF→PNG for Zoo)
- **Meshes:** STL / PLY / OBJ / 3MF / XYZ (normalized to STL for the Agent; XYZ → convex hull)
- Compare: side-by-side or **before/after opacity overlay**; download STL / STEP / **3MF**
- Workbench: photos, filtered logs, assistant markdown, KCL + metrics (volume mm³ / cm³ / in³)
- Live Engine: WebRTC preview — zoom / pan / rotate / scale, camera views, edges / x-ray / explode, snaps, selection, multi-format export
- Refine with text and optional re-attached photos/meshes
- **Apply finish** PBR presets (KCL `appearance`) without an Agent call
- Offline **`meshmoose mesh corrupt`** to simulate incomplete scans for demos/tests
- In-app **Documentation** + HTTP API + CLI

## Project layout

```
apps/api     FastAPI + Python client + meshmoose CLI
apps/web     React + Vite UI
demos/       Packaged fixtures (beverage-holder-stand, partial-stand, …)
docs/        Architecture, HTTP API, CLI, Zoo notes
scripts/     Smoke / validation helpers
```

## CLI (quick examples)

```bash
export ZOO_API_TOKEN=…             # or MESHMOOSE_TOKEN / .env.local

meshmoose health
meshmoose demos run beverage-holder-stand --mode fast --wait
meshmoose jobs create --prompt "Make a stand" --photo stand.jpg --mesh stand.stl \
  --title "Beverage stand" --tag stand --wait
meshmoose jobs finish <job_id> --preset brushed-aluminum --wait
meshmoose jobs retry <failed_job_id> --wait
meshmoose jobs download <job_id> --out ./exports
meshmoose mesh corrupt demos/beverage-holder-stand/lidl-jar-stand.stl \
  -o /tmp/stand_partial.stl --missing 0.35 --noise 0.5
```

Full reference: [docs/cli.md](docs/cli.md) · HTTP: [docs/http-api.md](docs/http-api.md)

## Tests

```bash
npm test                 # vitest + pytest (no live Zoo required)
npm run test:api
npm run test:web
```

## Docs

- In-app: open **Docs** in the web UI
- [HTTP API](docs/http-api.md)
- [CLI](docs/cli.md)
- [Architecture](docs/architecture.md)
- [Zoo API notes](docs/api-notes.md)
- [Adding demos](demos/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Security

- The API **never** persists your Zoo token; clients send `Authorization: Bearer` per request.
- Usage responses strip email, IP, and query strings.
- Do not commit `.env.local`, `data/`, or API keys.

## Acknowledgments / NOTICE

MeshMoose is an independent project built for the [Zoo API Makeathon](https://zoo.dev/events/api-makeathon). It uses [Zoo](https://zoo.dev) / KittyCAD public APIs and client libraries (Agent / ML Copilot, Engine, File Format, Account) under their terms of service. Zoo and KittyCAD are trademarks of their respective owners. This project is not affiliated with or endorsed by Zoo except as a Makeathon participant.

Bundled demo geometry for the beverage holder stand is the author’s own design published on [MakerWorld](https://makerworld.com/hu/models/111242-lidl-beverage-dispenser-stand-17-5-cm-bottom-diame).

## License

MIT — see [LICENSE](LICENSE).
