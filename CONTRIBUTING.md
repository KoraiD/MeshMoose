# Contributing

Thanks for your interest in MeshMoose.

## Repository

https://github.com/KoraiD/MeshMoose

## Development setup

Prerequisites: Python **3.11+**, Node **20+**, a [Zoo](https://zoo.dev) API token.

See also the [root README](README.md) for features and Zoo API attribution.

```bash
git clone https://github.com/KoraiD/MeshMoose.git
cd MeshMoose

python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e "apps/api[dev]"

npm install
cp .env.example .env.local         # set ZOO_API_TOKEN=…
npm run dev                        # API :8787 + web :5173
```

On Windows, `npm run dev:api` / `npm run test:api` use `sh -c` (Git Bash, WSL, or similar). You can also run uvicorn/pytest directly from an activated venv.

## Tests

```bash
npm test                 # vitest + pytest (no live Zoo required)
npm run test:web
npm run test:api
```

## Pull requests

1. Branch from `main` for new work.
2. Keep changes focused; match existing style.
3. Run `npm test` before opening a PR.
4. Describe what changed and how to try it.

## Demos

See [demos/README.md](demos/README.md) for adding packaged fixtures.

## Security

Report vulnerabilities via a private GitHub security advisory on this repo — see [SECURITY.md](SECURITY.md).
