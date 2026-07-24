# apps/web (`meshmoose-web`)

Vite + React + TypeScript UI for MeshMoose.

```bash
npm install
npm run dev --workspace=apps/web
```

Or `npm run dev` from the repo root (API + web). Open http://127.0.0.1:5173 — use **Docs** in the top bar for the in-app user guide / API / CLI summary.

## Highlights

- **API key** menu: Zoo token, usage meter, optional 10‑minute usage auto-refresh
- **Settings**: theme, job finish notifications, tag library, custom refine snippets, prompt templates
- New job: templates, multi photo (incl. HEIC) + mesh (STL/PLY/OBJ/3MF/XYZ), demos, local STL preview
- Jobs list + Jobs modal: filters, live Engine sessions, status polling while runs are active
- Compare: side-by-side or opacity overlay; selectable reference; Align + deviation heatmap; STL / STEP / 3MF download
- Live Engine: Zoo WebRTC — zoom / pan / rotate / scale, views, edges / x-ray / explode, export, snaps
- Workbench: photos, logs, assistant, KCL (+ diff), metrics, active time
- Apply finish presets; refine (+ snippets); rename / tags

See the [root README](../../README.md) and [docs/](../../docs/).
