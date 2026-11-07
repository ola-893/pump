# Cloudflare frontend and Railway backend

Pump's stable testnet frontend is deployed to Cloudflare Pages. Railway hosts
the public API and its persistent SQLite volume. Private agents, strategies,
model weights, and journals stay in the user's browser or local backup files.
The hosted frontend performs inference in the browser and uses the owner's
wallet for testnet vault approvals. Mainnet trading remains disabled.

| Component | URL |
| --- | --- |
| Frontend | https://pump-near-893.pages.dev |
| Quick setup | https://pump-near-893.pages.dev/docs/quick-setup |
| Backend health | https://pump-public-api-production.up.railway.app/health |
| Public directory | https://pump-public-api-production.up.railway.app/api/pump-directory |

Public resource IDs and verified release metadata are in
[hosting metadata](../deployments/hosting.json).

## Frontend releases

Build from the repository root with both locked dependency trees installed:

```sh
npm ci
PUMP_PUBLIC_API_URL=https://pump-public-api-production.up.railway.app npm run build:cloudflare
npx wrangler@4.158.0 pages deploy app/dist --project-name pump-near-893 --branch hackathon/near-2026
```

Use the stable project URL for QA so the browser workspace persists across
releases. The Pages project uses Direct Upload. Deploying a commit to GitHub
alone does not deploy it to Pages. A GitHub Actions release can be configured
later with a dedicated Cloudflare API token; never commit deployment credentials.

The build outputs the static site, its WASM inference runtime, and a small
Cloudflare Function that forwards only public API routes to Railway.
Use `build:cloudflare` for every Pages release. It restores the published
asset history and checks the file hashes before packaging the new release,
so open tabs can still load the inference code they were built with.
`_routes.json` invokes the Function only for `/api/*`; assets and SPA navigation
are served directly by Pages. Unknown and private APIs return JSON errors.
Requests retain their exact Origin for Railway's allowlist checks. The proxy
does not forward cookies or wallet authentication headers.

## Railway backend

The service uses the repository's Dockerfile, one replica, and a persistent
volume at `/data`. Keep these variables scoped to the Pump service:

```text
PUMP_PUBLIC_DB=/data/pump.sqlite
PUMP_DIRECTORY_ORIGIN=https://pump-public-api-production.up.railway.app/api/pump-directory
PUMP_DIRECTORY_CLIENT_ORIGINS=https://pump-near-893.pages.dev,https://pump-near-893.netlify.app
```

Preserve other already authorized exact origins when updating the allowlist.
The directory origin is also the signed publishing audience; it must stay
stable. Do not set `PUMP_DIRECTORY_URL` on the service that owns the directory.
Never upload `.local/`, weights, or reporter keys. Hosting changes do not
deploy contracts or move vault tokens.

## Move an existing browser workspace

In the old site's **My agents**, expand **Workspace backup and migration**
and export the workspace. At the new site, use the same section to import it.
This stays local: the backup is not uploaded to Railway or Cloudflare.
Verify the agent count and seed vault links before discarding any backup.
Public publishing requires renewed wallet authorization on the new origin.

Connect the wallet again and allow model-folder access in Create an agent.
Browser permissions and IndexedDB data do not automatically move between domains.
Existing on-chain vaults retain their addresses and balances.

## Release verification

- Open and reload home, Create an agent, My agents, and nested Docs URLs.
- Verify the WASM asset has an `application/wasm` content type.
- Confirm public API requests return JSON, including POST requests from the Pages origin.
- Confirm private APIs return an error rather than SPA HTML.
- Confirm the seed flow shows a shortfall before opening the wallet.
- Test transactions only on NEAR testnet with the owner's wallet approvals.

The prior Netlify project remains separate. Its credit limit prevented further
production releases; it is retained as a source for existing browser backups.
