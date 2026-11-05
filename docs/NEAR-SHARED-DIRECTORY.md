# Shared directory and local runners

The directory stores only public agent records. Each operator runs inference and keeps private agents on their own computer. The existing local helper is intentionally loopback-only; it is not a hosted multi-tenant model execution API.

## Development setup

`npm run directory:serve` starts a separate catalog on `127.0.0.1:5198` with `.local/pump-directory/catalog.sqlite`. Set `PUMP_DIRECTORY_URL=http://127.0.0.1:5198` before starting each local frontend/helper. Without that setting, the helper embeds a local directory in its own SQLite database.

Use My agents → Shared directory to authorize public publishing. The wallet signs a two-minute, single-use NEP-413 challenge bound to account, directory origin, action and runner public key. The service verifies the signature and current full-access key permission. No access key or token authority is created on-chain.

Set `PUMP_RUNNER_KEY_DIR` to isolate the key directory when running multiple disposable acceptance environments on one computer. The runner key is created only on authorization, in `~/.local/share/pump/runner-keys/`, with owner-only permissions. It is distinct from the NAV reporter and wallet keys. Publications contain only that wallet’s public agents, their public strategies, and replayable strategy journals. Public strategy evidence includes inference inputs and responses; private agents are excluded. Do not put credentials in public strategies.

Saved grants include the exact directory URL. A URL change or an older unscoped saved grant requires a fresh wallet authorization; publication does not silently follow a changed host. The server also rejects a grant certificate from another origin.

The runner publishes every 30 seconds. It serializes publications and signs a domain-separated payload with a sequence persisted across restarts. The directory rejects signature tampering, cross-owner ID collisions, rewritten journal prefixes, dropped strategy history, changed model manifests and execution-exercise contamination. Derived metrics are recomputed from the journal. Owner certificates and the original signed publication remain available for independent checks. Remote readers reconstruct catalog records from signed source journals and independently check the owner’s current NEAR full-access key through their own RPC. Submitted catalog names and counters cannot override the signed record. Making an unfunded agent private removes it from current discovery and direct profile access; already public information cannot be recalled from other users’ copies. Funded vault records remain inspectable.

Revoking a runner disables future publication. Existing public history remains available and is marked offline. A missing heartbeat is marked offline after 90 seconds. Private/local console controls are never served by the shared directory.

## Hosted boundary

Set `PUMP_DIRECTORY_ORIGIN` to the canonical HTTPS origin, `PUMP_DIRECTORY_CLIENT_ORIGINS` to an explicit comma-separated frontend allowlist, `PUMP_DIRECTORY_HOST` and `PUMP_DIRECTORY_PORT` as needed, and `PUMP_DIRECTORY_DB` to persistent private storage. HTTPS termination, backups, monitoring, abuse controls and public hosting must be verified before inviting external users. They have not been provisioned here.

The central operator helper also exposes only the public directory surface at `/api/pump-directory/`. If using this integrated reporting host, reverse-proxy **only that prefix**; never expose local helper status, model detection or console APIs. Keep the NAV reporter credential on the central host. Other operators configure their local helper with the directory URL and have no central signing credential.

The central reporter reads recent verified public runner checkpoints, checks the approved vault factory and code pins, obtains its own current liquidation quote, and reports under the existing shared gas budget. Checkpoints older than 45 seconds cannot support a fresh report. A remote runner without the central signer delegates NAV to this host; stale chain prices still block investor transfers. This is trusted paper accounting, not independently attested execution.

The standalone catalog process alone does not sign NAV. Run the central helper against it with the existing reviewed reporter configuration if automatic remote pricing is required. Do not share the reporter key with operators or inference processes.

## Current limits and next QA

A publication is limited to 100 agents and 2 MB. Local discovery currently loads up to 1,000 shared records. Larger installations need cursor-based server search, journal segmentation and retention policy before scale claims. Wallet message signing and cross-machine operation need real-wallet and network acceptance beyond the automated two-owner HTTP and isolated cross-process tests. These are release QA gates, not mainnet readiness claims.

NEP-413 specification: https://github.com/near/NEPs/blob/master/neps/nep-0413.md

## Automated process acceptance

```sh
node --import tsx --test tests/near-directory-process.test.ts
```

This launches a hub, two independent operator runners and a reader as separate Node processes with separate persistent SQLite databases and owner-only key directories. Disposable SDK wallets exercise the same challenge, authorization, publication and verification protocol. It checks concurrent publications, operator restart recovery, private removal, revocation and independently rejected owner-key changes. Test files are cleaned up on exit. This runs on one computer and does not establish public HTTPS or physical two-computer acceptance.

## Staging acceptance update

Actual owner-wallet publication and separate cloud verification of retained public evidence passed. Temporary Cloudflare tunnels subsequently expired, so the demo was restored to local-directory mode. Durable hosting and physical two-operator acceptance remain pending. See [current QA results](testing/NEAR-QA-20261104.md), including the distinction between historical checkpoint verification and live transport verification.
