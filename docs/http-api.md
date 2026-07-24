# HTTP API

MeshMoose exposes a local REST API (default `http://127.0.0.1:8787`) used by the web UI and the `meshmoose` CLI.

Interactive docs (when the API is running):

- Swagger UI: http://127.0.0.1:8787/docs  
- ReDoc: http://127.0.0.1:8787/redoc  
- OpenAPI JSON: http://127.0.0.1:8787/openapi.json  

## Auth

Most routes require:

```http
Authorization: Bearer <ZOO_API_TOKEN>
```

The API forwards this token to Zoo and **does not** persist it. Public routes: `GET /health`, `GET /demos`. Demo asset files are served under `/demo-assets/`.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | no | Service health + version |
| `GET` | `/demos` | no | Packaged demo manifests |
| `POST` | `/jobs/from-demo/{demo_id}` | yes | Start a job from a demo (`mode`, optional `prompt` form fields) |
| `GET` | `/jobs` | yes | List jobs (newest first); includes `active_ms` / `run_started_at` |
| `POST` | `/jobs` | yes | Create job (`prompt`, `mode`, optional `title` / `tags`, `photos[]`, `meshes[]` multipart) |
| `GET` | `/jobs/{id}` | yes | Job metadata (hydrated paths, prompts, tags, sanitized `error`) |
| `PATCH` | `/jobs/{id}` | yes | Rename and/or replace tags (`{ "title"?, "tags"? }`, max 5 tags) |
| `DELETE` | `/jobs/{id}` | yes | Delete job + files |
| `POST` | `/jobs/{id}/cancel` | yes | Request cancel while running |
| `POST` | `/jobs/{id}/retry` | yes | Clone a **failed** job’s prompt + inputs (+ title/tags) into a new run |
| `POST` | `/jobs/{id}/refine` | yes | Refine (`message`, optional `photos[]` / `meshes[]`) |
| `GET` | `/finishes` | yes | List PBR Apply-finish presets |
| `POST` | `/jobs/{id}/finish` | yes | Apply finish preset (`preset` form field) and re-export |
| `GET` | `/jobs/{id}/events` | yes | SSE log/event stream; optional `?after=N` (event index) to resume after reconnect |
| `GET` | `/jobs/{id}/reference` | yes | Active Compare reference + available mesh sources |
| `PUT` | `/jobs/{id}/reference` | yes | Set Compare reference (`{ "source": "inputs/…" \| "outputs/reference.stl" }`) |
| `POST` | `/jobs/{id}/align` | yes | ICP-align generated onto reference; returns transform + deviation stats/heatmap data |
| `GET` | `/jobs/{id}/artifacts` | yes | Artifact index |
| `GET` | `/jobs/{id}/files/{path}` | yes | Download an artifact file |
| `GET` | `/zoo/usage` | yes | Zoo credits + recent calls (sanitized) |

## Inputs

| Kind | Accepted |
|------|----------|
| Photos | JPG, JPEG, PNG, WebP, GIF, HEIC, HEIF — HEIC/HEIF → JPEG; GIF → PNG before Agent attach |
| Meshes | STL, PLY, OBJ, 3MF, XYZ/TXT — converted to STL for the Agent (XYZ → convex hull) |

## Outputs (typical job artifacts)

Under `outputs/`: `main.kcl`, `generated.stl`, `generated.step`, `generated.3mf`, `reference.stl`, `metrics.json`, `job.log`, agent snapshot JPEGs.

## Create job (curl)

```bash
curl -sS -X POST "http://127.0.0.1:8787/jobs" \
  -H "Authorization: Bearer $ZOO_API_TOKEN" \
  -F "prompt=Make a washer, 20mm OD, 8mm ID, 2mm thick" \
  -F "title=Washer 20mm" \
  -F "tags=washer,diy" \
  -F "mode=thoughtful" \
  -F "photos=@./part.jpg" \
  -F "meshes=@./scan.stl"
```

## Patch job (rename / tags)

```bash
curl -sS -X PATCH "http://127.0.0.1:8787/jobs/$JOB_ID" \
  -H "Authorization: Bearer $ZOO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Beverage holder stand","tags":["stand","demo"]}'
```

## Apply finish

```bash
curl -sS -X POST "http://127.0.0.1:8787/jobs/$JOB_ID/finish" \
  -H "Authorization: Bearer $ZOO_API_TOKEN" \
  -F "preset=brushed-aluminum"
```

## Align meshes

```bash
curl -sS -X POST "http://127.0.0.1:8787/jobs/$JOB_ID/align" \
  -H "Authorization: Bearer $ZOO_API_TOKEN"
```

## Job statuses

`queued` → `preprocessing` → `agent_running` → `exporting` → `measuring` → `succeeded` | `failed`

Refine re-enters at `agent_running`. Apply finish enters at `exporting`.

## Python client

```python
from meshmoose_api.client import MeshMooseClient

with MeshMooseClient(token="…") as client:
    job = client.create_job(
        prompt="Make a bracket",
        photos=["photo.jpg"],
        meshes=["scan.stl"],
        mode="fast",
        title="Corner bracket",
        tags=["bracket"],
    )
    done = client.wait_job(job["id"], timeout=900)
    print(done["status"])
    if done["status"] == "succeeded":
        finished = client.apply_finish(done["id"], preset="matte-plastic")
        print("finish →", finished["status"])
    if done["status"] == "failed":
        retry = client.retry_job(done["id"])
        print("retried as", retry["id"])
```

See also [CLI](cli.md) and [architecture](architecture.md).
