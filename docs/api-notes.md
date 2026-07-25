# Zoo API notes

Constructive notes from integrating Zoo’s Agent, Engine, and File Format APIs in MeshMoose.

## Prompt length

Zoo does **not** publish a hard character/token limit for Zookeeper / ML Copilot user prompts. Official guidance emphasizes **focused** prompts: part type, important features, dimensions/constraints — not long essays. Complex prompts take longer (Text-to-CAD FAQ: often 10–30s, can be minutes; `thoughtful` refine can run much longer).

MeshMoose soft-caps create prompts at **8000** characters and nudges around **2000** / warns near **4000**. Refine messages hard-cap at **2000**. Prefer short refine turns over packing everything into one megaprompt.

## What worked

- **ML Copilot WebSocket** (`/ws/ml/copilot`) accepts user messages with `additional_files` (images + `model/stl`) and `current_files`.
- Documented / known-good image MIME types for Agent attach: `image/jpeg`, `image/png`, `image/webp`. MeshMoose also accepts HEIC/HEIF/GIF uploads and converts them to JPEG/PNG before attach.
- Agent can **recreate** parametric KCL from photo + STL + text.
- **Surface finish / materials** are PBR `appearance(color, metalness?, roughness?, opacity?)` on solids in KCL — not UV/bitmap texturing of triangle meshes. See [appearance](https://zoo.dev/docs/kcl-std/functions/std-solid-appearance). MeshMoose **Apply finish** (`POST /jobs/{id}/finish`) patches `main.kcl` with a preset and re-exports without calling the Agent.
- **3MF**: Zoo does **not** import/export 3MF natively (CLI/API formats are fbx, glb, gltf, obj, ply, step, stl). MeshMoose supports 3MF **via trimesh**: import converts 3MF→STL for the Agent; export writes `generated.3mf` from the Zoo STL.
- Extra `.md` files are **not** a documented reconstruction input for ML Copilot. Design intent belongs in the text prompt (or MeshMoose stores agent narrative as local `assistant.md`). Markdown is used elsewhere in Zoo’s docs/skills ecosystem, not as a special CAD-brief attachment type.
- Agent emits intermediate snapshot JPEGs and uses an `edit_kcl_code` tool loop.
- **Continuing a conversation** for refine: open `ml_copilot_ws(conversation_id=…)` and send a user message with updated `current_files`, optionally plus new `additional_files`.
- **Live Engine**: `@kittycad/web-view` + `@kittycad/lib` WebRTC worker. Requires serving `kcl_wasm_lib_bg.wasm` from `@kittycad/kcl-wasm-lib@0.1.168` (ABI-matched to `@kittycad/lib@4.3.12`). The same public file powers editor parse/lint/format.
- **Engine** export via `zoo-kcl` (`Stl`, `Step`) works when the process environment has `ZOO_API_TOKEN`.
- **File Format API** can measure STL for volume / surface area / mass / center-of-mass (mass needs density).
- **Account usage**: `GET /user/payment/balance` and `GET /user/api-calls` are free. MeshMoose proxies them as `GET /zoo/usage` and sanitizes the payload (no email, IP, query strings).

## Friction / workarounds

1. **BSON `send_binary` with attachments**  
   Sending `MlCopilotClientMessage` via the SDK’s BSON path interrupted Zookeeper.  
   **Workaround:** send JSON where `data` is an array of uint8 integers.

2. **SDK `recv()` / pydantic `Files` parsing**  
   Server `Files` messages deliver `data` as JSON int arrays; generated models expect `bytes`.  
   **Workaround:** raw JSON receive + convert int arrays to bytes.

3. **Imported STL is not editable as features**  
   Ask the agent to recreate KCL rather than edit foreign imports.

4. **Upload / payload size**  
   Community notes ~64MB Zookeeper upload limits. Large phone JPEGs should be resized before attach.

5. **XYZ → mesh quality**  
   Point clouds are not first-class Agent inputs. Convex-hull preprocess is DIY-grade; better meshing would improve results.

6. **Measure API `src_format`**  
   File Format measure endpoints require `src_format` as a **query parameter** (and CAD bytes as the body / SDK `body=`). Sending `src_format` only as a multipart form field returns **400** `missing field src_format`. MeshMoose uses the KittyCAD SDK (`create_file_volume`, etc.) so the query param is set correctly.

7. **Long-running `thoughtful` refine**  
   Complex refine prompts can sit in tool loops for many minutes with sparse client-visible progress. Restarting the local API orphans in-flight jobs (reaped as failed on startup).

8. **Env var naming**  
   Zoo tooling and MeshMoose accept `ZOO_API_TOKEN` (preferred). The CLI also reads `ZOO_SECRET_KEY` and `MESHMOOSE_TOKEN`. Export sets `ZOO_API_TOKEN` for `zoo-kcl`.

9. **KCL WASM ABI mismatch**  
   `@kittycad/lib` embeds wasm-bindgen glue for a specific `kcl-wasm-lib` build. If `public/kcl_wasm_lib_bg.wasm` is not **0.1.168**, Live Engine fails at worker init (`__wbg_onOperation_… is not a Function`) before connecting to Zoo.  
   **Workaround:** keep the root `overrides` + `apps/web` pin on `0.1.168`, re-run `npm install` (copy-wasm), hard-refresh the browser. Do not force `0.1.170` until Zoo publishes a matching `@kittycad/lib`.

## Wishlist

- Official JSON examples for `additional_files` with images + STL  
- SDK helpers that accept `bytes | list[int]` for file payloads  
- First-class point-cloud attach or documented mesh-prep guidance  
- Clearer refine/continue examples with `conversation_id` + `current_files`  
- Lighter progress events during long `thoughtful` runs  
