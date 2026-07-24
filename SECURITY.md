# Security

- **Never commit Zoo API tokens** or `.env.local`. Use `.env.example` as a template only.
- The web UI keeps the token in **browser localStorage** and sends it as `Authorization: Bearer` to the local API. The API forwards it to Zoo and does not write it to disk.
- Job inputs/outputs live under `data/` (gitignored). Treat that directory as private.
- MeshMoose is designed for **localhost use only** (the API binds to `127.0.0.1`, CORS is limited to local dev origins, and the only auth is your personal Zoo token). Do not expose the API to a network without adding TLS and real authentication first.
- If a token may have been exposed, rotate it in your [Zoo](https://zoo.dev) account settings.

To report a vulnerability, open a **private security advisory** on this repository:

https://github.com/KoraiD/MeshMoose

Do not file a public issue that includes secrets or tokens.
