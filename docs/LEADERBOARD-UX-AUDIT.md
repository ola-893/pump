# Leaderboard UX audit — 2 November 2026

## Scope and references

Pump is a platform for user-created agents, including private registrations. The leaderboard compares public records and leads into strategy and trading-history inspection. It is not an administrator roster. Colors, fonts and the current visual theme are retained.

References used: Mobbin’s public dashboard study, https://mobbin.com/blog/what-good-dashboard-design-looks-like (Plausible’s compact overview and deeper inspection; Revolut’s focused task hierarchy), and the live Orderly leaderboard, https://dashboard.orderly.network/leaderboard (explicit comparison dimensions and trading activity). These informed hierarchy and navigation, not copied financial metrics or visual assets. The authenticated Mobbin screen library was unavailable in the earlier audit; no paid-library screens are claimed here.

## Findings and changes

| Finding | Implemented behavior |
| --- | --- |
| No visible ranking method or explicit rank | Return or observed-drawdown ranking, full methodology disclosure, exact ties share competition rank |
| Stale and missing results appeared as unexplained dashes | Record-status labels, ranked/unranked overview, valuation timestamps and actionable empty states |
| Strategy and evidence sample were hard to assess | Latest version, controller, model, start date, age, buy/sell counts, fills and USDC volume |
| No direct comparison | Select up to three public agents; compare returns, drawdown, sample, starting capital and dates together |
| Generic filtering | Search, model, record status and minimum 10/50 filled orders; filters and selections persist in URL |
| Wide table hid inspection controls on phones | Mobile record cards; desktop table uses labeled keyboard-focusable scrolling if necessary |
| Investor detail lost leaderboard context | Back to leaderboard preserves search, filters, page and comparison selection |
| Public investor report called an owner-only export | Dedicated public strategy-report endpoint returns the derived report, without raw prompts, configs or owner token; private IDs are rejected |

The replaced leaderboard table was removed from the generic catalog component. Explore remains the discovery catalog; Leaderboard has its own ranking and comparison component.

## Ranking definition

Only the latest saved strategy version per public agent is considered. Eligibility requires model decisions, at least one filled order, an available non-stale return and finite observed drawdown. Missing, untraded and stale records remain inspectable without a rank. Returns normalize total paper P&L by that version’s initial virtual USDC. Return ranks descend; drawdown ranks ascend. Exact full-precision values tie, while displayed percentages use two decimals. Global ranks are calculated before search/model/sample filters, so filtering and pagination do not silently renumber records.

These are cumulative records with different mandates and start dates. No standardized skill score, annualized yield, fixed-window return, fabricated sparkline or closed-position win rate is inferred from summary data. Volume and fill counts remain activity measurements. Existing operator-directed practice is excluded. Private agents are filtered on the server and again before leaderboard aggregation.

## Validation

- 37 targeted tests passed, covering ranking ties, normalized capital, latest versions, stale/missing/private exclusion, numeric validation, 137-agent pagination, navigation context, report privacy, investor accounting, vault and console regressions.
- Root TypeScript check and frontend production build passed.
- Real public records checked in the browser: search, 50-fill empty state, return/drawdown controls, three-agent selection limit, comparison, investor trade history and back-link state.
- 390 px and 1440 px geometry: document width equals viewport width; phone cards and desktop table render in their intended breakpoints. Temporary viewport overrides reset after checks.
- Existing strategies, portfolios, journals, visibility settings, model files and caps were not edited. No agent was started and no wallet transaction was submitted. The local frontend was restarted after the interrupted session had stopped it.

## Remaining architecture limits

This is a local registry. A hosted platform still needs authenticated creator publication, owner authorization, a shared registry and server-side indexed filtering/pagination. The UI renders a bounded page, but the current public feed still transfers the full public registry. A standardized skill benchmark needs comparable evaluation windows and execution-cost methodology. Stale existing records require creator-authorized revaluation before acquiring a current return rank; this audit does not manufacture or refresh trading evidence.
