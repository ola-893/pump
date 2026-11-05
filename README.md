# Pump

Pump lets people run local trading agents, inspect their decisions and compare
paper portfolios. NEAR Intents supplies signed dry-run quotes; NEAR testnet
contracts provide per-strategy vaults, test-USDC deposits, shares and redemptions.
Paper results are hypothetical, and vault NAV depends on a trusted reporter.

## Try it locally

Use Node.js 22.13 or newer and npm. From this checkout:

```sh
npm ci
npm --prefix app ci
npm run dev
```

1. Open <http://127.0.0.1:5197/> to see the agent directory. A fresh installation
   starts with no locally registered agents.
2. Open <http://127.0.0.1:5197/demo> to create a paper session and inspect its
   portfolio and journal.
3. For model-generated decisions, run an OpenAI-compatible inference server on
   loopback, then enter its endpoint when creating the session. Pump does not
   download model weights. The default endpoint is `http://127.0.0.1:8080/v1`.
4. Select live dry-run quotes and run a decision. Inspect the proposal, any
   assumed fill, and the evidence export. HOLD or a blocked decision is a valid
   result when the model or market conditions do not support a trade.

The offline tests below use fixtures and do not need a wallet, API key or model
download. Live quote requests need internet access. The optional 1Click API key
belongs in a private `.env` file; see [`.env.example`](.env.example).

For wallet and testnet flows, follow the [runbook](docs/NEAR-DEMO-RUNBOOK.md) and
[vault documentation](docs/NEAR-AGENT-VAULTS.md). A static upload of `app/dist`
alone does not supply the local API, SQLite ledger or model worker.

## Verify

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

Install Rust for contract checks:

```sh
cargo test --manifest-path contracts-near/Cargo.toml --workspace --locked
rustup target add wasm32-unknown-unknown
npm run build:near
```

The publication check on November 5, 2026 passed 190 TypeScript tests and 39
Rust tests, typechecking and the production build. Lint completed with existing
warnings. Historical sandbox and testnet observations are under
[`docs/testing/`](docs/testing/); they describe their recorded runs, not a fresh
deployment each time this repository is checked out.

## Source map

| Path | Purpose |
| --- | --- |
| `app/` | React frontend, wallet flows, agent console and portfolio views |
| `near-demo/` | Local API, paper ledger, model adapter, signed evidence and directory |
| `contracts-near/` | Rust clearing, agent vault, vault factory and sandbox token fixture |
| `tests/` | TypeScript regression tests and isolated sandbox runners |
| `deployments/` | Public testnet deployment references |
| `staging/verifier/` | Independent verification Worker source |
| `docs/` | Architecture, runbooks and recorded verification evidence |

## NEAR HACKATHON

The NEAR work is published on the dedicated `hackathon/near-2026` branch. Review
the [source publication diff](https://github.com/ola-893/pump/compare/publication-start...hackathon/near-2026)
and the [NEAR demo runbook](docs/NEAR-DEMO-RUNBOOK.md).

The implementation includes signed NEAR Intents dry-run quote verification,
testnet wallet authorization, strategy vaults and reproducible evidence checks.
Mainnet trade settlement is not enabled. The [official rules](https://nearhackathon.com/HACKATHON.md)
allow libraries, templates and AI-assisted code. The project uses React, Vite,
TypeScript, Tailwind CSS, Lucide, React Router, `near-api-js`, `near-sdk`,
`@hot-labs/near-connect`, the 1Click SDK, `@noble/curves`, `@scure/base`, and
AI-assisted code and documentation. Dependency versions are recorded in the
npm and Cargo lockfiles. Model weights are supplied separately by the operator.

## License

[MIT](LICENSE). Third-party dependencies and externally supplied model weights
retain their respective licenses.
