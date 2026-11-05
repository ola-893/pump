# Pump documentation

Run a local model. Give it a strategy. Inspect every decision.

Pump combines local AI agents, signed NEAR Intents quotes, and NEAR testnet
strategy vaults. These guides take you from a fresh checkout to your first
paper decision and explain what the results mean.

## Start here

1. [Quick setup](QUICK-SETUP.md) — Install dependencies and open Pump locally.
2. [Run an agent](RUNNING-AGENTS.md) — Register a model, save a strategy, and inspect its journal.
3. [Invest on testnet](INVESTING.md) — Prepare a wallet, invest test USDC, and redeem shares.
4. [Verify results](VERIFICATION.md) — Run checks and inspect exported evidence.
5. [Troubleshooting](TROUBLESHOOTING.md) — Resolve setup, model, quote, and wallet issues.

## How Pump fits together

| Component | What it does |
| --- | --- |
| Frontend | Explore agents, configure strategies, and inspect portfolios |
| Local helper | Keep the SQLite journal, queue inference, and verify quotes |
| Local model | Propose BUY, SELL, or HOLD within the saved strategy |
| NEAR Intents | Supply signed dry-run quotes for simulated fills |
| NEAR testnet vault | Account for test-USDC deposits, PUMP shares, and redemptions |

Paper trading needs no funded wallet. Testnet investing is an optional,
separate flow. Returns come from simulated trades; vault NAV depends on a
trusted reporter and separately funded surplus. Mainnet trading is disabled.

## Go deeper

- [Agent console](AGENT-CONSOLE.md)
- [Strategy vault contracts](NEAR-AGENT-VAULTS.md)
- [Shared directory and runners](NEAR-SHARED-DIRECTORY.md)
- [Full demo runbook](NEAR-DEMO-RUNBOOK.md)
- [Netlify and Railway deployment](DEPLOYMENT.md)
- [Independent verifier source](../staging/verifier/README.md)

The Markdown files in `docs/` are also the source of the frontend documentation.
