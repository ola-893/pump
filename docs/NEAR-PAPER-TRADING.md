# NEAR paper-trading demo

Decision: 20 October 2026. Status: implemented locally, with live signed 1Click quotes, persistent virtual portfolios, local-model adapter, and an optional NEAR testnet clearing contract for Circle test USDC plus a separate surplus. See the [runbook and deployment status](NEAR-DEMO-RUNBOOK.md). The model input includes portfolio, limits, strategy, a current quote and bounded recent comparable quote history; integration of the existing research/news engine is deferred. Mainnet execution and investor custody are deferred until testing and review/audit readiness.

## Demo flow

```text
Research + live market observations
                 ↓
Local model: BUY / SELL / HOLD
                 ↓
Deterministic risk and balance checks
                 ↓
Fresh 1Click quote with dry: true
                 ↓
Assumed fill recorded in virtual ledger
                 ↓
Holdings, realized P&L, quoted exit value and drawdown
```

1Click documents `dry: true` as a quote simulation without a deposit address or initiated swap. That provides price/route observations, not exchange fills. The quote service is a production API; no production blockchain transaction is sent by this demo. [Official quote API](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote).

No real tokens, funded wallet, contract deployment, transaction signer or execution-key permission is required for this paper flow. API access/rate limits and local inference availability still apply. A syntax-valid fixed quote-only recipient/refund context can be configured without connecting a user wallet; record that context with the request and never use it as a payment instruction.

## Virtual execution policy

- Start each new session with a declared virtual balance, for example 1,000 USDC. This amount is entirely simulated and need not match a wallet. Quote the actual proposed order size; the API must return a route for that size.
- Use explicit asset IDs and pinned decimals. Keep integer token base units throughout arithmetic. Quote USDC/wNEAR in each direction initially; discover support from the token endpoint rather than relying on ticker strings.
- After a model decision, wait the configured execution delay and obtain a fresh exact-input quote for that order. Do not retroactively select the best quote or fill at an observation preceding the decision. Recheck available cash, inventory, risk and quote freshness at assumed-fill time.
- In the baseline scenario, decrement the quoted input and credit `amountOut`. Label this assumption `quoted-output`. A separate conservative scenario can use `minAmountOut` or a documented adverse execution haircut; never silently mix fill models in one performance record.
- Quote output already reflects route economics. Do not blindly add the old practice engine's fee/slippage percentages on top. Charge only additional costs explicitly excluded from the quote under a versioned model. Show whether hypothetical gas/setup costs are modeled or excluded; actual demo blockchain gas is zero because no transaction is submitted.
- Do not interpret `slippageTolerance` as a fee. The quote's `minAmountOut` is a quote constraint, not proof a real fill would occur.
- On failed/stale/malformed quotes, record a blocked/unfilled order with no balance mutation. Unknown exit valuation makes current equity unavailable, not zero and not an unchanged fresh mark.
- Preserve HOLD, rejects and errors in the activity log. Require a new qualifying quote to fill an order; log its response timestamp and local receipt time. Store raw request/response, signature if provided, hash, policy version and decision reference. Verify quote authenticity using the provider's documented scheme where available.
- One portfolio mutation per order ID. Durable journal commits precede public success/notifications; process restart replays committed events without double-filling or resetting capital/history.

The assumed-fill model does not reproduce solver competition, settlement failures, MEV, queue priority, actual latency or our trades' impact on subsequent market state. A new quote reflects real market state without our hypothetical trade having changed it. Keep demo order sizes modest and expose these assumptions alongside returns.

## Profit and loss

For one position and no capital flows:

```text
Equity in quote units = virtual quote cash
                     + fresh quote output for selling ALL held position units

Total hypothetical P&L = equity − initial virtual capital
Realized P&L           = simulated sale proceeds − allocated purchase cost
Unrealized P&L         = current quoted exit value − remaining purchase cost
Return %               = total hypothetical P&L / initial virtual capital × 100
```

Request a reverse quote for the actual held quantity, not a unit price multiplied by the balance. That captures the quoted spread, fees and size dependence more faithfully. A buy quote alone cannot mark an open position's exit value. After full sale, value the portfolio as cash without counting the closed position again.

Track purchase cost with a declared method such as weighted average. Partial sales allocate cost proportionally using explicit rounding and retain the remainder so replay conserves cost exactly. At fixed cost-model settings, realized plus unrealized P&L must reconcile to total P&L for a session with no deposits/withdrawals. Any additional modeled expenses need their own reconciliation entry.

If virtual deposits/withdrawals are later added, separate them from investment results:

```text
Hypothetical P&L = closing equity − opening equity
                − virtual deposits + virtual withdrawals
```

For multiple assets, simultaneous liquidation is more complex than summing independent best quotes. The initial demo uses a single position token plus quote cash. Quote-denominated results are in USDC units; calling them exact USD returns would also require a fresh USDC/USD conversion.

An immediate buy/sell will usually show quoted trading friction rather than profit. Profit or loss emerges from the model's entry/exit decisions and later quoted prices. A short profitable demo is not sufficient evidence of a robust strategy.

## Paper ledger and evidence

The paper ledger records virtual balances, fills, equity, realized outcomes
and drawdown. Pump uses signed execution quotes for hypothetical fills and
valuation. Versioned quote and ledger formats let reviewers replay saved
sessions.

The demo should show:

- Persistent badge: **Paper trading · Live quotes · Simulated fills**.
- Virtual starting capital, cash, holdings and their cost basis.
- Current quoted liquidation value, quote age and hypothetical P&L.
- Realized/unrealized breakdown, return, drawdown and documented cost assumptions.
- Agent proposals and reasons, BUY/SELL assumed fills, HOLD and blocked outcomes.
- Saved quote and inference evidence per activity, with replay/export controls.
- Explicit unavailable/stale status; last-known values, if retained, show their timestamp.

## Prevent accidental funding

The paper executor exposes only token discovery and dry quotes. Force `dry: true` on the server; client input cannot override it. Do not initialize an execution signer or import a live executor in this mode. Reject transfer, sign-transaction, broadcast, deposit submission and signed-intent submission actions in the demo backend. The optional testnet deposit/redeem controls explicitly identify Circle test tokens and simulated performance; they never submit production Intents swaps.

Any optional local identity/evidence signatures remain separate from transaction signing and do not require a funded account. A future live executor uses separate configuration, balances, journal and performance history. There is no automatic promotion of paper balances into real funds.

## Acceptance

Demonstrate actual local-model decisions, supported dry quotes, a virtual buy/sell ledger, fresh liquidation marks and P&L replay. Test insufficient balances, duplicate order processing, missing/stale quotes, partial sales, base-unit rounding, additional cost treatment, restart recovery and forced dry-mode enforcement.

Keep a dated replay package for a reproducible presentation. If the live model chooses HOLD or the quote API is unavailable during the demo, show that state or explicitly switch to historical replay. Scripted scenarios remain labeled separately from autonomous model activity. No fake transaction hashes or settled-trade statuses.

Contract tests can run independently in NEAR Sandbox while the paper demo is developed. A paper demo validates strategy/software behavior under disclosed assumptions; it does not establish contract safety, successful settlement or funded profitability. Mainnet and investor custody remain later, separately accepted work.
