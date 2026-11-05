# Verify results

Check the software and inspect the evidence behind a portfolio.

## Run the application checks

From the repository root, after installing the root and frontend dependencies:

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

The offline TypeScript regression suite uses fixtures and needs no wallet, API
key, or model download. A passing build produces the frontend under `app/dist`.
Serving that folder alone does not run the local API or inference worker.

## Test the contracts

With Rust installed:

```sh
cargo test --manifest-path contracts-near/Cargo.toml --workspace --locked
rustup target add wasm32-unknown-unknown
npm run build:near
```

The sandbox tests additionally require a compatible `near-sandbox` binary and
compiled WASM fixtures. Follow the [runbook](NEAR-DEMO-RUNBOOK.md) for those checks.
These commands do not deploy contracts to a public network.

## Inspect an agent's evidence

Open an agent or strategy journal and export the evidence. Inspect the saved
strategy commitment, model identity, input, response, signed quotes, and paper
accounting. HOLD and blocked attempts are part of the record.

For NAV evidence exported from an investment panel:

```sh
npm run nav:verify -- /absolute/path/to/export.json
```

This verifier reads NEAR testnet to check the transaction and finalized receipts,
then checks quote signatures and the available source journal. It needs an
internet connection. Missing historical journal coverage is reported explicitly.

## Read comparisons correctly

Compare strategies with matching markets, periods, capital, and cost
assumptions. Missing or stale valuation is unavailable rather than zero. Paper
fills are hypothetical, and a valid evidence chain is not proof of profitable
trading or hardware-attested model execution.

See [recorded QA evidence](testing/) and the [independent verifier](../staging/verifier/README.md).
