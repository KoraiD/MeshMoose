const REPO_URL = 'https://github.com/KoraiD/MeshMoose'

type Props = {
  onBack: () => void
}

export function DocsPage({ onBack }: Props) {
  return (
    <div className="docs-page">
      <header className="docs-top">
        <button type="button" className="linkish" onClick={onBack}>
          ← Back to app
        </button>
        <h1>Documentation</h1>
        <p className="muted">
          User guide, HTTP API, and CLI for MeshMoose — local multimodal reconstruction.
        </p>
      </header>

      <nav className="docs-toc" aria-label="Documentation sections">
        <a href="#guide">User guide</a>
        <a href="#api">HTTP API</a>
        <a href="#cli">CLI</a>
        <a href="#repo">Repository</a>
      </nav>

      <section id="guide" className="docs-section">
        <h2>User guide</h2>
        <ol>
          <li>
            Open <strong>Settings</strong>, paste your Zoo API token (stored only in this
            browser), and optionally pick a theme.
          </li>
          <li>
            Click <strong>New job</strong>. Choose a prompt template or write your own; give
            the job a title; upload at least one photo (JPG / PNG / WebP / GIF / HEIC / HEIF —
            HEIC/HEIF convert to JPEG for Zoo) and one mesh (STL / PLY / OBJ / 3MF / XYZ). Or
            load a packaged demo (<code>beverage-holder-stand</code> or{' '}
            <code>partial-stand</code>).
          </li>
          <li>
            Watch the job in the sidebar. Open <strong>Compare</strong> for side-by-side or
            before/after overlay meshes, <strong>Live engine</strong> for Zoo WebRTC
            preview (zoom / pan / rotate / scale, views, x-ray, explode, export, snaps), or{' '}
            <strong>Workbench</strong> for logs, assistant notes, metrics, and KCL.
          </li>
          <li>
            In Workbench, review photos, logs, assistant notes, metrics (volume units
            mm³ / cm³ / in³), and <code>main.kcl</code>.
          </li>
          <li>
            Rename the job and add up to five tags from the detail header. Filter the Jobs
            list by name, ID, tag, state, or time. Refine with text (and optional new
            photos/meshes) when the run succeeds. Use <strong>Apply finish</strong> to set
            a PBR material preset on the solid (KCL <code>appearance</code>) without an
            Agent call. Download generated mesh as STL, STEP, or 3MF.
          </li>
          <li>
            Failed jobs can be <strong>Retry</strong>’d from the UI or{' '}
            <code>meshmoose jobs retry</code>. Offline, use{' '}
            <code>meshmoose mesh corrupt</code> to simulate incomplete scans for demos.
          </li>
        </ol>
        <p className="muted">
          Full architecture notes live in the repo under <code>docs/</code>.
        </p>
      </section>

      <section id="api" className="docs-section">
        <h2>HTTP API</h2>
        <p>
          Local FastAPI service (default <code>http://127.0.0.1:8787</code>). Authenticate
          with <code>Authorization: Bearer &lt;ZOO_API_TOKEN&gt;</code>. The API never
          persists the token.
        </p>
        <p>
          Interactive OpenAPI:{' '}
          <a href="http://127.0.0.1:8787/docs" target="_blank" rel="noreferrer">
            http://127.0.0.1:8787/docs
          </a>
        </p>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>GET</td>
              <td>/health</td>
              <td>Public health</td>
            </tr>
            <tr>
              <td>GET</td>
              <td>/demos</td>
              <td>Packaged demos</td>
            </tr>
            <tr>
              <td>GET/POST</td>
              <td>/jobs, /jobs/from-demo/…</td>
              <td>List / create</td>
            </tr>
            <tr>
              <td>GET/PATCH/DELETE</td>
              <td>/jobs/&#123;id&#125;</td>
              <td>Read, rename/tags, delete</td>
            </tr>
            <tr>
              <td>POST</td>
              <td>/jobs/&#123;id&#125;/retry</td>
              <td>Clone a failed job</td>
            </tr>
            <tr>
              <td>POST</td>
              <td>/jobs/&#123;id&#125;/cancel</td>
              <td>Cancel a running job</td>
            </tr>
            <tr>
              <td>POST</td>
              <td>/jobs/&#123;id&#125;/refine</td>
              <td>Continue conversation</td>
            </tr>
            <tr>
              <td>GET / POST</td>
              <td>/finishes, /jobs/&#123;id&#125;/finish</td>
              <td>List / apply PBR finish</td>
            </tr>
            <tr>
              <td>GET</td>
              <td>/jobs/&#123;id&#125;/events</td>
              <td>SSE log stream</td>
            </tr>
            <tr>
              <td>GET</td>
              <td>/jobs/&#123;id&#125;/artifacts</td>
              <td>Artifact index</td>
            </tr>
            <tr>
              <td>GET</td>
              <td>/jobs/&#123;id&#125;/files/…</td>
              <td>Download artifact file</td>
            </tr>
            <tr>
              <td>GET</td>
              <td>/zoo/usage</td>
              <td>Credits + recent calls</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Markdown reference in the repo: <code>docs/http-api.md</code>.
        </p>
      </section>

      <section id="cli" className="docs-section">
        <h2>CLI</h2>
        <p>
          Install with the API package: <code>pip install -e &quot;apps/api[dev]&quot;</code>,
          then:
        </p>
        <pre className="docs-pre">{`export ZOO_API_TOKEN=…
meshmoose health
meshmoose demos run beverage-holder-stand --mode fast --wait
meshmoose demos run partial-stand --mode thoughtful --wait
meshmoose jobs create --prompt "Make a stand" --photo a.jpg --mesh a.stl \
  --title "Stand" --tag stand --wait
meshmoose jobs finish <job_id> --preset brushed-aluminum --wait
meshmoose jobs retry <failed_job_id>
meshmoose jobs download <job_id> --out ./exports
meshmoose mesh corrupt part.stl -o partial.stl --missing 0.35`}</pre>
        <p className="muted">
          Full reference: <code>docs/cli.md</code>. Every subcommand supports{' '}
          <code>--help</code>.
        </p>
      </section>

      <section id="repo" className="docs-section">
        <h2>Repository</h2>
        <p>
          Source, issues, and deeper docs:{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            {REPO_URL}
          </a>
        </p>
      </section>
    </div>
  )
}
