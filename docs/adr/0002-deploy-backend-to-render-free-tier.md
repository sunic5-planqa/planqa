- Title: Deploy the backend to Render's free web service tier
- Status: Accepted
- Date: 2026-08-10
- Context: The tool needs to reach 5 non-developer teammates, several of them remote (not on the same
  network as whoever runs the backend). Until now, the backend only ran on a developer's own machine
  (`uv run uvicorn ...` on `localhost:8000`), which the Chrome extension's `VITE_API_BASE_URL` default
  and `manifest.config.ts`'s `host_permissions` both hard-coded. `localhost` only ever resolves to the
  machine the browser itself is running on, so a teammate's extension pointed at "localhost:8000" was
  never going to reach the deployer's machine no matter how the server was started — this had to be a
  real network-reachable deployment, not a local-server + tunnel workaround, for the "5 people install
  it and it just works" bar the team wants.
- Options:
  1. Local server + a tunnel (ngrok or similar) exposed while the deployer's laptop stays on.
  2. Deploy to a free-tier cloud host (Render, Fly.io, Google Cloud Run, ...).
  3. Deploy to a paid, always-on cloud host.
- Decision: Option 2, specifically Render's free web service tier.
  - Option 1 ties the tool's availability to one person's laptop being powered on and connected
    whenever any of the 5 people wants to use it — fragile for a small team that isn't all in the same
    room, and free-tier tunnel URLs are typically ephemeral (change on every restart), which would mean
    re-building and re-distributing the extension zip after every tunnel restart.
  - Option 3 was ruled out purely on the "최대한 공짜로" (as free as possible) requirement — nothing
    about this backend needs paid-tier resources (in-memory storage, no database, no persistent state
    that must survive a restart).
  - Render was picked over Fly.io/Cloud Run for setup friction, not technical superiority: it needs no
    credit card to start, no CLI/Docker knowledge to deploy (GitHub-connect + a `render.yaml` blueprint
    is enough), and its free web service plan is a plain "runs your app" tier rather than requiring
    Cloud Run's request-based billing model or Fly.io's machine/volume concepts to be understood first.
  - The backend's own architecture already fits a free web service without changes: in-memory `store`
    (no database to provision), a `GET /healthz` endpoint already existed for a health check, and CORS
    already reads from `ALLOWED_ORIGINS` (an env var) rather than being hard-coded to `localhost`.
- Consequences:
  - Render's free tier spins the service down after ~15 minutes of no traffic; the first request after
    that has a cold-start delay (usually well under a minute) before the app responds. Given a QA review
    job already takes roughly a minute, this is an acceptable, known tradeoff for zero cost — not
    something worth paying to eliminate for a 5-person internal tool.
  - `render.yaml` (repo root) defines the service — `rootDir: backend`, `uv sync --frozen` to build,
    `uv run uvicorn ... --host 0.0.0.0 --port $PORT` to start (binding to `0.0.0.0` is required; Render
    routes external traffic to the container by port, not by hostname). `ANTHROPIC_API_KEY` and
    `ALLOWED_ORIGINS` are `sync: false` (secrets set once in the Render dashboard, never committed).
  - `manifest.config.ts` now reads `VITE_API_BASE_URL` (the same env var `api/client.ts` already used
    for the fetch base URL) at build time and appends it to `host_permissions` if set — so building with
    `VITE_API_BASE_URL=https://<render-url> npm run build` is the only extra step needed to produce an
    extension package pointed at the deployed backend, on top of the existing local-dev default
    (`localhost:8000`, unchanged when the variable isn't set).
  - `ALLOWED_ORIGINS` on Render must be set to the extension's own origin
    (`chrome-extension://<extension-id>`) — the same value already used locally, since the extension's
    ID is pinned by `dev-key.public.txt` and doesn't change between machines building from this repo.
  - The extension itself still isn't published to the Chrome Web Store — each of the 5 people loads the
    same built `dist/` folder as an unpacked extension. If Render's URL ever needs to change (e.g.
    moving off the free tier later), the extension must be rebuilt and redistributed to everyone.
