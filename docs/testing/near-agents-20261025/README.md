# NEAR local agent UX and comparison evidence

The implementation and reproducibility workflow are documented in [NEAR-AGENT-UX.md](../../NEAR-AGENT-UX.md).

Registered locally from existing files in `~/.local/share/llama.cpp`:

| Agent | Model | Measured weights SHA-256 |
| --- | --- | --- |
| katana | Muse-Glimmer-30B · UD-Q4_K_XL | `82bece304887a313ece08400bc030f6066c7bff5b906b0cd40308ec8a409fd38` |
| okina | Qwen3.8-27B · UD-IQ4_XS | `40fac4050e940397dbf13087afd50f4734a11805bf9d65ef8ddd7483470e6199` |
| nagakiba | gemma-4-26B-A4B-it · UD-Q4_K_M | `f2c28b3dc4776931ac6f879e11f203dec637ea0f14267a86ec8f6165f63f293f` |

These registrations are unsigned local declarations. They are not on-chain identities or hardware attestations. No weights were downloaded or copied. No mainnet transaction or Circle testnet token transfer is part of this verification.

`comparison-summary.json` is written by `npm run demo:compare-local` when a run finishes. Each named `*-evidence.json` export contains its public declaration, replay-checked live paper session, comparison journals, source datasets and accounting consistency checks. Interrupted attempts are preserved and excluded from ranking. A final ranking requires a complete shared run without inference errors.

All historical P&L is hypothetical USDT accounting, with explicit next-bar execution, a 10 bps fee and 10 bps adverse slippage on each side. Live USDC/wNEAR dry-run quote sessions are separate. A HOLD is a real model decision but is not a trade. Twenty-four decisions per model are an exploratory sample, not a statistically established track record or future-return claim.

## Completed run

All three models completed the same 24 historical windows, using dataset `514268e8a953cfb55b1518affe32ce2ede5efac6d5fd8857dea0945e4008f9fb`.

| Agent | Decisions | Simulated fills | Blocked proposals | Paper return | Observed drawdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| katana | 24 | 0 | 0 | 0.00% | 0.00% |
| okina | 24 | 1 | 0 | -3.29% | 4.94% |
| nagakiba | 24 | 7 | 7 | -7.90% | 17.02% |

There were no inference errors in the completed run. Katana held cash throughout. The seven blocked Nagakiba proposals remain visible and changed no balances. Replaying the saved proposals, next-bar fills and marks reconciles all final balances.

All three additional live signed-quote checks passed: Katana HOLD, Okina HOLD, Nagakiba BUY with one hypothetical fill. They used temporary in-memory ledgers; the persistent named sessions still have zero events and remain available for a Circle testnet deposit link. Their profile live counters intentionally do not count QA activity.

Validation: 212/212 tests passed; root typecheck and production build passed. Lint reports only existing warnings in legacy components. CUA continued reporting local browser use disabled, so visual QA and screenshots could not be completed. `validation.json` records these boundaries. All helper-owned inference processes were unloaded after verification; no GGUF files are present under this project's .local directory.
