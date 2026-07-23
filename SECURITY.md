# Security

- **Never commit Zoo API tokens** or `.env.local`. Use `.env.example` as a template only.
- The web UI keeps the token in **browser localStorage** and sends it as `Authorization: Bearer` to the local API. The API forwards it to Zoo and does not write it to disk.
- Job inputs/outputs live under `data/` (gitignored). Treat that directory as private.
- If a token may have been exposed, rotate it in your [Zoo](https://zoo.dev) account settings.

To report a vulnerability, open a **private security advisory** on this repository:

https://github.com/KoraiD/MeshMoose

Do not file a public issue that includes secrets or tokens.
