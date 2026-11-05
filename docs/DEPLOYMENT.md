# Netlify frontend and Railway backend

Pump's hosted deployment serves the public directory, agent evidence, and testnet
investor reads. Model inference and private controls remain on the operator's
computer. The hosted app links those actions to local setup.

## Railway backend

Deploy the repository root using the included `Dockerfile` and `railway.json`.
The image installs the locked Node dependencies, includes no local state or
credentials, and runs `npm run start:public` on Railway's `PORT` at `0.0.0.0`.

1. Create a Railway service from the `hackathon/near-2026` branch of this repo.
2. Attach a persistent volume at `/data`. Keep one replica for the SQLite writer.
3. Generate the service's public HTTPS domain.
4. Set these service variables using the actual domains:

```text
PUMP_PUBLIC_DB=/data/pump.sqlite
PUMP_DIRECTORY_ORIGIN=https://YOUR-RAILWAY-DOMAIN/api/pump-directory
PUMP_DIRECTORY_CLIENT_ORIGINS=https://YOUR-NETLIFY-DOMAIN
```

`PUMP_DIRECTORY_ORIGIN` is also the signed publishing audience. Keep it stable.
Do not set `PUMP_DIRECTORY_URL` on this service: it owns the shared directory.
Do not upload the operator's `.local/` folder, model weights, or reporter keys.

Railway checks `/health` before marking the deployment healthy. Verify
`/api/near-demo/public-status` returns JSON and `/api/near-demo/status` returns
403. The backend does not expose private agent management or sign transactions.
NAV reporting remains on the separately authorized local reporting host.

## Netlify frontend

1. Import the same repository and branch, with the repository root as the base.
2. Use the included `netlify.toml`: build `npm run build:netlify`, publish `app/dist`.
3. Set `PUMP_PUBLIC_API_URL` to the Railway HTTPS origin, without a path.
4. Deploy, then put the actual Netlify origin in Railway's client allowlist.

The build generates Netlify proxy rules for public APIs before the SPA fallback.
Direct navigation to `/docs/quick-setup`, `/vaults`, and agent profiles therefore
loads the frontend. Local control APIs receive a JSON error, rather than the SPA
HTML. The hosted build directs Create an agent, My agents, and the workbench to
local setup. The normal `npm run dev` keeps the local application behavior.

## Connect a local runner

Set `PUMP_DIRECTORY_URL` on each local operator computer to the exact Railway
directory URL ending in `/api/pump-directory`, then restart the local dev server.
Use My agents → Shared directory to authorize publishing with the owner wallet.
An earlier authorization for a different URL cannot be reused automatically.

A new hosted database starts empty. Public agents appear after an authorized
local runner publishes them. The local model must remain online to produce new
decisions. No private agent or journal is copied as part of deployment.

## Verify the release

- Visit the Netlify home page, Docs, Explore agents, and Leaderboard.
- Reload a nested docs URL directly.
- Check backend health and public status, and confirm local controls reject requests.
- Authorize a runner, inspect its public record, and verify restart persistence.
- Test wallet connection and testnet investment with the owner's approval.

Provider references: [Netlify rewrites and proxies](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/),
[Railway configuration](https://docs.railway.com/config-as-code),
[Railway persistent volumes](https://docs.railway.com/volumes).
