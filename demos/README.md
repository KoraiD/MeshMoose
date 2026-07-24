# Demos

Packaged fixtures that appear in the MeshMoose **New job** modal and via `GET /demos`.

## Layout

```
demos/
  <demo-id>/
    demo.json           # required manifest
    <photo>.jpg|.jpeg|.png|.webp
    <mesh>.stl|.ply|.obj|.3mf|.xyz
    prompt.txt          # optional mirror of demo.json prompt (human-readable)
```

`demo-id` is the directory name (e.g. `beverage-holder-stand`).

## `demo.json` schema

```json
{
  "title": "Human title",
  "description": "Optional blurb for the UI",
  "source_url": "https://…",
  "source_label": "Optional link label",
  "prompt": "Default reconstruction prompt",
  "mode": "thoughtful",
  "photos": ["photo.jpeg"],
  "meshes": ["part.stl"]
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `title` | yes | Shown in the UI |
| `description` | no | Short blurb |
| `source_url` | no | Link to the original design / product page |
| `source_label` | no | Link text (defaults to “Original design”) |
| `prompt` | yes | Sent to the Agent (overrideable when starting) |
| `mode` | no | `thoughtful` (default), `fast`, or `auto` |
| `photos` | yes | Filenames relative to the demo folder (at least one) |
| `meshes` | yes | Filenames relative to the demo folder (at least one) |

## Adding a demo

1. Create `demos/my-part/` and drop photo + mesh files in it.
2. Prefer a **small** photo (≤1600px JPEG/PNG/WebP, no EXIF/GPS) and a **decimated** STL. HEIC/3MF work at job time via conversion, but package demos as JPEG + STL when you can.
3. Write `demo.json` with matching `photos` / `meshes` filenames (and optional `source_url`).
4. Restart the API (or rely on `--reload`) — `GET /demos` lists new folders automatically.
5. In the UI: **New job → Load “…”**.

To build a partial-scan fixture from a clean STL:

```bash
meshmoose mesh corrupt demos/my-part/part.stl \
  -o demos/my-part/part_partial.stl --missing 0.35 --noise 0.5 --artifacts 4 --seed 7
```

Then point `meshes` at the partial file.

## Removing a demo

Delete (or rename) the `demos/<demo-id>/` subfolder. MeshMoose only lists directories that contain a `demo.json`. Restart/reload the API if it was already running without `--reload`.

## API

- `GET /demos` — list manifests (+ `id`)
- `POST /jobs/from-demo/{id}` — copy assets into a new job and start the pipeline  
  Form fields: `mode` (optional), `prompt` (optional override)

## Bundled demos

| Id | What it shows |
|----|----------------|
| `beverage-holder-stand` | Lidl/Ernesto beverage dispenser stand ([MakerWorld](https://makerworld.com/hu/models/111242-lidl-beverage-dispenser-stand-17-5-cm-bottom-diame)) — multi-part print with dowel holes |
| `partial-stand` | Same stand with a corrupted scan mesh (generated via `meshmoose mesh corrupt`) plus the same photos — tests reconstruction from incomplete geometry |
| `brick-wall` | Running-bond brick segment (mesh + photo) used by the **Brick wall texture** refine snippet — the Agent projects raised brick courses and recessed mortar joints onto a model as real geometry |
