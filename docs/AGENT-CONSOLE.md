# Agent console

Open `/console`, or use the console embedded in `/agents`. All registered models
are available. The real agent store is not seeded with example strategies.

1. Select Katana, Okina or Nagakiba.
2. Name and describe that agent's strategy: entries, exits, sizing and HOLD
   conditions. Momentum, mean reversion and breakout are optional starting
   points; selecting one does not save or run anything.
3. Set virtual starting USDC, per-trade cap, allocated-cost cap, UTC daily
   turnover cap, slippage and minimum decision interval.
4. Choose **Save strategy**. This records an immutable version and creates a
   fresh stopped paper portfolio, bound to the registered model's exact local
   artifact. The earlier 50 forced execution fills stay in their old sessions.
5. Choose **Run once** for a single model evaluation, or **Start agent** for
   repeated evaluations. **Stop** cancels future decisions and queued cycles.
   An active decision can finish; stopping does not sell an open position.
6. Inspect the selected version's decisions, BUY/SELL/HOLD counts, blocked
   attempts, gross USDC volume, equity, P&L, cash, position and observed maximum
   drawdown. Its journal loads automatically and follows the existing five-second
   status refresh. New decisions, fills and rejections appear without clicking
   Load/Refresh; the refresh button remains available. Exports retain the complete
   evidence. Late responses from earlier versions are ignored; failed refreshes
   retain the last loaded journal and retry automatically after five seconds.

The model chooses actions and sizes under the saved strategy. No forced
round-trip instruction, minimum trade count, synthetic quote fallback, manual
scenario or execution exercise is accepted in a strategy portfolio. Real money
and testnet deposit linking are disabled for these portfolios. New strategy
versions start new portfolios; old portfolios and open positions are retained.

Edits cannot change a saved version in place or run while unsaved. A running
agent must be stopped, with its current evaluation finished, before saving or
starting another version for the same model. Different agents share one
sequential model queue, which loads their existing GGUF files in place. The
configured interval is a minimum after evaluation; queue, load and inference
add time. Restarting the local server leaves strategy workers stopped.

Inference uses fresh signed 1Click dry-run quotes and the same closed-candle
research available to the workbench. Every strategy version and exact config
has a SHA-256 commitment; model inputs include that version ID and commitment.
Exports replay accounting and check saved input strategy, limits, portfolio,
model binding and response consistency. Failures never assume a fill. Stale
portfolio valuations display as unavailable and can be refreshed explicitly.

Strategy text stays on the local operator server and goes to the local model;
it is included in the local status API and evidence export. Do not put keys in
the strategy field, and review exports before sharing. These observations are
not independent execution attestation or an automatic skill rating. Compare
runs with comparable markets, time periods, capital and risk constraints.

## Verification

Integration tests use an in-memory store, signed quote fixtures and explicitly
named mock inference responses. They cover save/version isolation, exact
prompt wiring, HOLD accounting, export/replay, invalid limits, forbidden
manual/forced activity, persistence/restart, origin/token checks and endpoints.
Browser QA uses `tests/near-console-browser-fixture.mjs` on port 5199, with no
model process and no writes to the real registry. The production frontend is
on port 5197. Save, version selection, Run once, Start, Stop and journal behavior
are verified against that isolated fixture.
