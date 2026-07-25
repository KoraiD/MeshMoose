# apps/web (`meshmoose-web`)

Vite + React + TypeScript UI for MeshMoose.

```bash
npm install
npm run dev --workspace=apps/web
```

Or `npm run dev` from the repo root (API + web). Open http://127.0.0.1:5173 — use **Docs** in the top bar for the in-app user guide / API / CLI summary.

## Highlights

- **API key** menu: Zoo token, usage meter, optional 10‑minute usage auto-refresh
- **Settings**: theme, job finish notifications, tag library, custom refine snippets, prompt templates, app log
- New job: templates, modes (`thoughtful` / `fast` / `auto`), multi photo (incl. HEIC/GIF conversion) + mesh (STL/PLY/OBJ/3MF/XYZ), demos, local STL preview
- Jobs list + Jobs modal: filters, live Engine sessions, status polling while runs are active
- Compare: side-by-side or opacity overlay; selectable reference; Align tools + optional manual nudge; STL / STEP / 3MF download
- Live Engine: `@kittycad/web-view` + `@kittycad/lib` WebRTC — **Start** registers a session (tab visit alone does not). KCL editor below viewport (parse/lint, Format, Run, Save + history, optional re-export). WASM must be `kcl-wasm-lib@0.1.168` (`npm postinstall` → `scripts/copy-wasm.mjs`); hard-refresh after install.
- Workbench: photos, logs, assistant, read-only KCL (+ diff), metrics, active time
- Iterate: prompt history, KCL version **Restore** (+ optional re-export), refine (+ snippets), Apply finish presets; rename / tags

See the [root README](../../README.md) and [docs/](../../docs/).
