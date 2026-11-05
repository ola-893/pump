# Investor inspection on Explore agents

The `/vaults` page now leads with each agent’s latest independent strategy
record, then provides the existing testnet deposit and redemption workflow.
Colors and typography remain those of pump. No worker is started or stopped.
The existing server-verified strategy export is read to build chart observations,
receipt references and closed-position outcomes. No backend restart is required.

## Mobbin references

Research source: https://mobbin.com/blog/what-good-dashboard-design-looks-like
The full discovery library redirected to sign-in, so research used this public
Mobbin study and its embedded product examples. No claim of paid-library access.

- Fey: https://mobbin.com/apps/fey-web-043aa73f-17b4-4a91-a33c-14b5c09bea47/00a9e00e-0d44-4873-8059-7558fc7bc406/screens
  Chart and contextual indicators informed the performance-led overview.
- Origin: https://mobbin.com/apps/origin-web-f5cf5ecb-70a5-48ea-9a6c-fca171cf8d0c/41c0b83e-793b-41cc-b441-e2a33d371ac5/screens
  Adjacent interpretation informed the latest decision and sample-size context.
- Revolut: https://mobbin.com/apps/revolut-web-538d8553-9169-4343-a90c-66494c577e23/6636af99-a81c-4c3f-afb1-c97ccdb9879b/screens
  Balance-led action hierarchy informed keeping ownership actions distinct from
  the performance record. These are pattern references, not copied assets.

## Data rules

- Latest strategy version is the default, never best-performing. Earlier
  versions can be inspected; their capital and history are not combined.
- Forced execution exercises and manual scenarios are rejected by the investor
  report extractor and excluded from discovery-card strategy counts.
- A win or loss is measured over a full flat-to-flat position. Partial SELL legs
  do not inflate completed positions or win rate. No closes means unavailable
  win rate. Breakeven closes are included in the denominator.
- Current equity/return follows the existing fresh-valuation rules. Historical
  quotes remain historical, with chart timestamps. Missing marks stay missing;
  gaps over max(3 minutes, 3 decision intervals) are disconnected.
- 24h and 7d filter observations relative to now; they do not relabel the
  inception return as a period return. No annualization or fabricated benchmark.
- Decision days are distinct UTC dates with model decisions, not claimed uptime.
- Gross turnover is not profit. Filled orders, proposals and blocked attempts
  have separate labels and filters. Trade receipts expose exact event and quote
  IDs, observed/received times and local signature-check status.
- The public registration mandate and selected strategy commitment are shown.
  Private saved strategy instructions are not displayed in the investor panel.
- The downloadable investor report omits raw prompts/responses, quote raw bodies
  and filesystem paths. The existing local server API still returns full exports
  to its local client; this is not a new public redacted hosting API.
- Vault assets/share accounting is independent of paper equity. Deposits do not
  retrospectively earn paper returns. Existing wallet plans and approvals remain.

Checks: `node --import tsx --test tests/near-investor-performance.test.ts`;
`npm run build`. Fixtures are explicitly synthetic accounting tests, not model
performance evidence. Browser checks use the actual existing records read-only.
