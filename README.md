# Pump Documentation

Welcome to Pump — **Local AI Trading Agents on NEAR**.

Pump brings local model inference, inspectable paper trading, and strategy-bound
NEAR testnet vaults into one workspace.

## What is Pump?

Pump lets operators register local models, define trading strategies, and run
agents that propose BUY, SELL, or HOLD decisions within configured limits.
Users can explore public agents, inspect their decision journals, compare paper
performance, and try strategy vaults with Circle test USDC on NEAR testnet.

NEAR Intents provides signed live dry-run quotes for simulated trades. NEAR
contracts handle test-token deposits, shares, and redemptions. Trading returns
are hypothetical; vault NAV uses a trusted reporter and separately funded surplus.

### Key Innovation

**Each saved strategy version has its own portfolio, commitment, and vault.**

This connects the strategy an operator runs to the records an investor inspects.

| Component | Pump Approach |
| --- | --- |
| Decisions | Local model proposals checked against saved strategy limits |
| Pricing | Signed NEAR Intents dry-run quotes and whole-position valuations |
| Strategy versions | Immutable configuration commitments and separate portfolios |
| Investor accounting | Per-strategy testnet vaults with NEP-141 PUMP shares |
| Evidence | Exportable journals with quote, signature, and accounting verification |

## Quick Links

- [Live App](https://pump-near-893.netlify.app)
- [Live Documentation](https://pump-near-893.netlify.app/docs/quick-setup)
- [Documentation Hub](docs/README.md) — also available from the app’s **Docs** tab at `/docs`
- [Quick Setup](docs/QUICK-SETUP.md)
- [Netlify and Railway Deployment](docs/DEPLOYMENT.md)
- [Getting Started](docs/NEAR-DEMO-RUNBOOK.md)
- [Agent Console](docs/AGENT-CONSOLE.md)
- [Smart Contracts and Strategy Vaults](docs/NEAR-AGENT-VAULTS.md)
- [Investor Flow](docs/INVESTOR-FLOW.md)
- [Shared Directory and Local Runners](docs/NEAR-SHARED-DIRECTORY.md)
- [Independent Verifier](staging/verifier/README.md)
- [Test and Demo Evidence](docs/testing/)

## Current Deployment (NEAR Testnet)

| Contract | Account |
| --- | --- |
| Strategy Vault Factory | `pl.pumpcoin-demo-472db8.testnet` |
| Demo Clearing | `pumpcoin-demo-472db8.testnet` |
| Circle Test USDC | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` |

These are the accounts recorded in the [deployment configuration](deployments/).
Each strategy vault has a separate account shown in the app. Testnet tokens have
no monetary value; mainnet trade settlement is not enabled.

## Features

- ✅ **Local AI Agents** — Run locally supplied models and inspect BUY/SELL/HOLD decisions.
- ✅ **NEAR Intents Quotes** — Verify signed live dry-run quotes for paper trades.
- ✅ **Versioned Strategies** — Save strategy settings, risk limits, and model bindings.
- ✅ **Strategy Vaults** — Try test-USDC deposits, PUMP shares, and redemptions on NEAR testnet.
- ✅ **Safety Controls** — Apply trade, exposure, turnover, and slippage limits; stop future agent decisions.
- ✅ **Agent Dashboard** — Inspect portfolios, journals, drawdown, and comparable performance.
- ✅ **Public Agent Directory** — Publish wallet-authorized records while running inference locally.
- ✅ **Replayable Evidence** — Check signatures, journal continuity, and portfolio accounting.

## Getting Started

Use Node.js 22.13 or newer and npm:

```sh
npm ci
npm --prefix app ci
npm run dev
```

1. Open [Pump](http://127.0.0.1:5197/) to explore the agent directory. A fresh
   installation starts without locally registered agents.
2. Open the [paper workbench](http://127.0.0.1:5197/demo) and create a session.
3. Start an OpenAI-compatible inference server on loopback and enter its endpoint
   in the session. The default is `http://127.0.0.1:8080/v1`; model weights are
   supplied separately.
4. Select live dry-run quotes, run a decision, and inspect the resulting journal.
   The model may HOLD; invalid proposals or unavailable quotes record a blocked cycle.

Live quotes require internet access. An optional server-side 1Click API key can
be set in a private `.env` file using [`.env.example`](.env.example).
The frontend runs with a local API and SQLite ledger; a static build alone does
not run the agent worker. Follow the [runbook](docs/NEAR-DEMO-RUNBOOK.md) for
testnet wallet setup and verification.

## Verification

The offline regression tests use fixtures and require no wallet, API key, or model download:

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

With Rust installed, run the contract tests and build the WASM:

```sh
cargo test --manifest-path contracts-near/Cargo.toml --workspace --locked
rustup target add wasm32-unknown-unknown
npm run build:near
```

The November 5, 2026 publication checks passed 190 TypeScript tests, 39 Rust tests,
typechecking, and the production build. Lint completed with existing warnings.
Recorded sandbox and testnet results are available in [test evidence](docs/testing/).

## Built With

React, Vite, TypeScript, Tailwind CSS, Lucide, React Router, `near-api-js`,
`near-sdk`, `@hot-labs/near-connect`, the 1Click SDK, `@noble/curves`, and
`@scure/base`. Dependency versions are recorded in the npm and Cargo lockfiles.
Development includes AI-assisted code and documentation.

Built for NEAR HACKATHON on the dedicated `hackathon/near-2026` branch.
See the [source publication diff](https://github.com/ola-893/pump/compare/publication-start...hackathon/near-2026).

## Community

- [GitHub Repository](https://github.com/ola-893/pump)
- [Issues and Feedback](https://github.com/ola-893/pump/issues)

## License

[MIT](LICENSE). Third-party dependencies and externally supplied model weights
retain their respective licenses.
