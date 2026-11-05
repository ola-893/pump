# NEAR demo: run, verify, then deploy

Implemented 20 October 2026. The home page opens the NEAR agent directory, and `/demo` opens the paper trading workbench.

## Run locally

Use Node 22.13+ (SQLite support), install root and app dependencies, and start the server:

```sh
npm ci
npm --prefix app ci
npm --prefix app run dev -- --host 127.0.0.1 --port 5197
```

The verified preview is at `http://127.0.0.1:5197/demo`. This is a local operator application: the API deliberately refuses remote origins. A static upload of `app/dist` does not supply the local worker or SQLite ledger.

Start an OpenAI-compatible inference server on loopback. The default endpoint is `http://127.0.0.1:8080/v1`; change it when creating a session if your server uses another port. The adapter reads `/v1/models` and calls `/v1/chat/completions`, with structured BUY/SELL/HOLD output and no tools or transaction keys. The model may choose HOLD. New sessions begin with one quote; subsequent decisions receive the recorded recent observations. Its identity is an observed server assertion, not hardware attestation.

The request asks the local server to disable reasoning and constrain the JSON proposal to BUY/SELL/HOLD, integer units and a short explanation. Provider errors, truncation, timeouts and invalid responses record a blocked cycle. A successfully received input quote is preserved even if inference fails. These controls do not grant the model signing authority.

For the resumed 24 October check, the Qwen server is on `http://127.0.0.1:8081/v1`; enter that endpoint when creating the session. The former Muse server encountered a Metal out-of-memory error and was stopped after confirming it was idle. A second Qwen runtime also failed; after it exited, one Qwen instance was started from the existing weights with 4096 context, 64 batch size, 32 microbatch size and q8 KV caches. The application does not start or download models. Avoid loading a second large model solely for the demo.

1. Create a session. Defaults: 20 virtual USDC; 5 per trade; 15 allocated purchase-cost exposure; 100 UTC gross turnover; 60-second worker interval.
2. Select live 1Click dry-run quotes. `dry:true` is forced in the server. Signed quote responses are verified before fills. No mainnet deposit address, intent submission, or transaction signer is exposed.
3. Run one decision, or start the repeating worker. Stop ends scheduling; a cycle already in progress can finish. Service restart never silently restarts the worker.
4. Inspect proposals, assumed fills and fresh whole-position liquidation marks. Stale/unavailable valuations show unavailable equity. Export evidence to verify hash-chain continuity, balances and turnover.
5. Manual BUY/SELL scenarios are separately labeled. The synthetic fixed-price source is also explicitly labeled and is never used as an automatic fallback for live service failure.

The cost model credits quoted `amountOut`, including quoted route economics, and excludes hypothetical network gas/setup costs. Profit is hypothetical. Research/news retrieval from the older agent stack is not yet attached to this new decision path; the model sees the strategy, portfolio, caps, a current market quote and up to 20 comparable recorded one-USDC quotes from the last 15 minutes. History is built from this session’s actual observations; sparse history stays sparse. Changes measure wNEAR received per USDC and are not OHLC candles, trading volume or order-book depth.

## Circle testnet funding and surplus

The optional clearing contract accepts only Circle's published NEAR **testnet** token:

`3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`

Confirmed against [Circle's contract list](https://developers.circle.com/stablecoins/usdc-contract-addresses). Get test USDC from [Circle's faucet](https://faucet.circle.com/). Both token storage and transaction gas require test NEAR. Testnet tokens have no financial value.

The supplied implicit account is configured as controller and trusted reporter in `deployments/near-demo-testnet.json`. At the user’s request, the official faucet created `pumpcoin-demo-472db8.testnet` with 10 test NEAR. Its clearing deployment finalized in transaction `HQ1fKaVB2VvSUxAtULNNcLSeGCUULx7Mi3HWTaf2JSPx`; the observed code hash matches the locally tested WASM. See `docs/testing/near-testnet-deployment.json`. The controller account has been activated with 0.5 test NEAR; the clearing account has paid Circle’s 0.00125-test-NEAR FT storage minimum. Both setup transactions finalized. See `docs/testing/near-testnet-setup.json`. Reserve and claims start at zero. Circle faucet funding and wallet deposit/payout acceptance remain pending.

The controller supplies reserve through a separately tagged `ft_transfer_call`; reserve funding never increases the agent's paper P&L. User deposits create personal claims. The trusted reporter can reconcile a closed paper result, spending reserve for gains or returning losses to reserve. The contract caps the resulting claim at twice cumulative session deposits and rejects unfunded gains, changed claims, repeated sequence numbers, and unauthorized reports. This cap is a demo policy, not an expected return.

For a funded demo:

1. Connect a NEAR **testnet** wallet and prepare token/account storage. Claim registration costs exactly 0.02 test NEAR; token storage uses the FT's reported minimum.
2. As controller, fund the surplus. For example, 30 test USDC reserve and 20 deposited principal are separate balances.
3. Create a fresh paper session, deposit test USDC against its session ID, inspect finalized state, and link the confirmed deposit **before any decisions**. This sets starting paper cash to the confirmed claim.
4. Run paper trades, stop the worker, and sell the complete paper position. A single sale can be blocked by the 5-USDC proceeds cap after a price rise; use multiple allowed sales to close a larger position.
5. As the configured reporter, review the closed result. Preparing it seals the session against further changes. The transaction commits the session, sequence and evidence hash. The contract trusts that reporter's assertion; it does not independently verify the model or quotes.
6. Redeem the claim and inspect finalized receipt outcomes and balances. A failed FT transfer restores the claim through the private callback. Do not treat a wallet prompt, submitted hash, or parent receipt alone as payment. Do not retry a transaction with an unknown outcome before inspecting its status.

The local sandbox acceptance covers real WASM execution, actual asynchronous FT callbacks, successful and failed withdrawals, reserve conservation, gains/losses, replay rejection, and malformed-deposit refund. The sandbox uses a standard FT **fixture**, not Circle-issued tokens. Public Circle metadata/storage reads are checked by the setup command. Actual Circle token deposits and wallet payout acceptance remain to be tested with faucet tokens.

## Prepare a deployment

Install Rust's `wasm32-unknown-unknown` target and build:

```sh
npm run build:near
npm run demo:deploy-plan -- YOUR_CHOSEN_ACCOUNT.testnet
```

Replace the placeholder with an existing, funded contract account you control. The plan generator only writes review material to `.local/near-demo/deploy-plan.json`: WASM SHA-256, byte size, roles, testnet network, and an atomic deployment + `new` command for [NEAR CLI](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md). It neither reads keys nor broadcasts. The current account was created at the user’s request; another deployment requires an explicit account name.

After reviewing the plan, the operator can sign its CLI command using a locally managed testnet key. For the account generated by this project, `npm run demo:deploy-testnet -- --broadcast` uses its local key, journals the exact signed bytes before broadcast, verifies final receipts and code, and updates configuration. `npm run demo:setup-testnet -- --broadcast` can activate the configured implicit controller with 0.5 test NEAR and register the clearing account’s Circle FT storage. Neither command handles mainnet. The generated deployment key is stored with mode 0600 in `.local/near-demo/testnet-deployer.json` (gitignored). Back it up locally; do not publish it or include it in a demo recording. Keep keys out of chat. Wait for a FINAL successful receipt, verify `get_state`, then set `contractId` in `deployments/near-demo-testnet.json` and restart the local server. Deployment and initialization must be in the same transaction. Never deploy `pumpcoin_sandbox_token.wasm` publicly.

The deployment account's full-access keys retain upgrade authority. The contract is a trusted testnet demonstration, not an audited investor vault. Callback out-of-gas can leave an operation pending; investigate the receipts rather than issuing duplicate withdrawals. No mainnet promotion path is included.

## Verification

```sh
npm run typecheck
npm run test:near
npm run test:near-contract
npm run build
npm run lint
npm test
```

For sandbox acceptance, use the official `near-sandbox` binary (verified version 2.13.4), build the local FT fixture, then run:

```sh
npm run build:near-fixture
NEAR_SANDBOX_BIN=/absolute/path/to/near-sandbox npm run test:near-sandbox
```

The script creates a temporary isolated genesis, ephemeral local keys and loopback RPC on ports 19347/19348. It never connects to a public chain. It shuts down its node and writes `docs/testing/near-sandbox-acceptance.json`. Do not run two copies concurrently on those ports.

Source map: `near-demo/` (quotes, model, ledger, worker, SQLite, local API, testnet plans), `contracts-near/` (clearing), `app/src/components/NearDemo.tsx` (workbench), `app/src/lib/near-demo-wallet.ts` (testnet-only wallet guard).

### Run the registered models against live quotes

Open `/agents` and use **Start live paper trading**. This starts the existing
registered sessions, rather than temporary QA ledgers. The page polls every five
seconds and shows the active model, queued agents, model decisions, hypothetical
fills, HOLDs, blocked cycles, latest reasoning, quoted equity and paper return.
Each profile includes its live decision journal and complete evidence export.

One model runs at a time. The declared decision interval is the minimum delay
after that model completes a cycle; queue time and model loading add latency.
Only existing central GGUF files are read. Workers stop on server restart and
must be started explicitly again. **Stop live paper trading** cancels queued
cycles; an inference already in progress may finish and commit its decision.

CLI controls for the dev server on port 5197:

```sh
npm run demo:live -- start
npm run demo:live -- status
npm run demo:live -- stop
npm run demo:live -- export
```

These commands operate on the persistent registration store. The `export`
command replay-checks each agent's paper journal and writes evidence bundles to
`docs/testing/live-agents-20261025/`. No manual scenarios are inserted and no
model is forced to trade. A HOLD increments decisions but never fills. The live
return uses fresh whole-position exit quotes; stale or unavailable valuations
are displayed as unavailable. Quotes, inference errors and risk-cap rejections
never produce an assumed fill. Historical USDT comparisons remain separate.

Starting a previously fresh session records activity and makes it ineligible
for attaching a new testnet deposit. Use a separate fresh session for a funding
walkthrough; live paper trading needs no testnet tokens.

### Explicitly nudged paper execution exercise

When the operator requests buy/sell activity even without a strategy signal,
stop workers and wait for the active inference, then run:

```sh
npm run demo:live -- exercise
npm run demo:live -- start
```

This records a separate, immutable journal mandate on each registered session:
model-generated BUY of at most 2 virtual USDC, followed by model-generated SELL
of the resulting inventory. Each worker stops when its position is fully closed.
No model response is synthesized or replaced. HOLDs and rejected proposals are
preserved; a fresh signed dry-run quote is still required for every fill.

The original public strategy and model commitment remain unchanged. Requests,
responses and fills carry the exercise ID and `operator-directed-model` evidence.
The directory, profile and journal disclose the intervention. These round trips
measure execution and quote friction; exclude them from autonomous strategy
performance rankings. The exercise cannot attach to a testnet-funded account,
start with existing inventory, or silently increase its buy limit. Only one exercise may be active at a time. A new mandate may be appended
after the previous round has completed. The complete export replays both balances
and the exercise mandate, phase and buy limit.

Additional disclosed rounds can be requested after a session's previous exercise
has completed. Each round appends a new mandate with a distinct ID; the earlier
mandates and fills are retained and replayed in order. An incomplete exercise
cannot be replaced.

```sh
npm run demo:more-trades -- 3
```

This on-demand batch runs three additional BUY/SELL round trips per registered
agent, one model at a time. The current model stays loaded between its rounds.
It calls inference for every order and validates the resulting fills against
saved responses and signed live quotes. Each BUY remains capped at 2 virtual
USDC; the next round begins only after the preceding position is fully sold.
The declared economic limits remain active. Up to twelve inference attempts
are allowed per round; failures remain in the journal and are never replaced
with fabricated responses. Evidence snapshots and a verification report are
written under a timestamped `docs/testing/more-trades-*` directory.

This is operator-requested execution testing and can include repeated on-demand
cycles without the background worker's waiting interval. It is excluded from
autonomous strategy rankings and does not replace the historical comparison.

### Continuous operator-directed practice until stopped

```sh
npm run demo:live -- continuous
npm run demo:live -- status
npm run demo:live -- stop-continuous
```

`continuous` persists explicit authorization in `near_continuous`. The milestone
is at least 50 filled BUY/SELL orders per registered agent, and reaching it does
not stop the loop. The scheduler rotates after six fills (three completed round
trips), loading only one existing local GGUF at a time. Every order still comes
from a model response and must pass the quote and economic checks.

The authorization resumes when this local server restarts. Stop using **Stop
live paper trading** on `/agents`, the CLI, or an instruction to the assistant.
Stopping disables future iterations immediately; an already active inference
may finish and leave a position requiring a later explicit exit. The loop
records every round as a distinct operator-directed mandate and preserves all
prior journal entries. These exercises are excluded from autonomous strategy
rankings. On-demand continuous testing bypasses background interval delays.

Daily gross turnover caps remain active. Before starting another entry, the
loop reserves 4.1 virtual USDC of turnover capacity for the buy and exit. If
all selected agents lack that capacity, it waits for the next UTC day and
rechecks once per minute. It never raises limits or moves real tokens. Failed
inference and quote attempts are recorded and retried after a delay. Current
agent, milestone counters, waiting states and errors are shown in the directory.
