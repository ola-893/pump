# Live website browser QA — November 6, 2026

Site: https://pump-near-893.netlify.app

Method: Browser Use against the deployed website in an existing Chrome tab.

## Results

| Check | Result | Observed behavior |
| --- | --- | --- |
| Home page and live API data | pass | Home renders with zero public agents and no helper error. |
| FAQ disclosure | pass | Real-money FAQ expands and states that fills are simulated. |
| Directory search, filters, sorting and clear | pass | Query/filter/sort update the URL; Clear filters resets controls; empty pagination is disabled. |
| Leaderboard and ranking explanation | pass | Ranking metric, search, status and minimum-fill filters update URL; Clear filters resets; ranking assumptions expand. |
| Hosted My agents and Create an agent routes | pass | Both show local-workspace instructions without exposing owner controls. |
| Quick setup guide and docs search | pass | Setup renders; copy button acknowledges action; no-match search recovers and guide navigation clears search. |
| All six documentation pages | pass | Overview, setup, agents, investing, verification and troubleshooting render through live navigation. |
| NEAR wallet selector | pass | Wallet choices load and clicking outside cancels. No wallet login, signatures or transactions were performed. |
| Mobile layout and navigation | pass | 390px viewport: menu opens, route selection closes it, docs and directory have no page overflow. |
| Tablet and desktop layout | pass | 900px and 1440px viewports have no horizontal page overflow. |
| Missing guide fallback | pass | Unknown docs URL shows Guide not found and a working Quick setup recovery link. |
| Unavailable agent fallback | pass | A deliberately nonexistent agent shows Agent registration not found with a directory recovery link. |
| Setup-link regression fix | fixed | Deployed guide links retain http://127.0.0.1:5197/ and /demo; investing guide links to the public directory. |
| Direct docs URL and table-of-contents anchor | pass | Direct deep navigation loads the guide; Install and start anchor scrolls to its heading. |
| Hosted /demo route | pass | Direct /demo navigation shows local workspace setup rather than failing local API calls. |
| Application console errors | pass | No website-origin errors observed. Installed browser-wallet extension emitted its own onboarding errors. |
| Live model execution, populated comparisons and evidence exports | not exercised | No public agents or strategy records have been published to the new directory. |
| Wallet sign-in, deposits and withdrawals | not exercised | Wallet selector only; no wallet sign-in, signature, approval or transaction was attempted. |

## Fix deployed during testing

The hosted Markdown renderer rewrote explicit localhost setup URLs into hosted
application routes. Readers following local setup therefore returned to the
hosted site. The renderer now preserves those localhost links, and the investing
guide links to the public directory. Both destinations were checked again on
the live deployment.

Frontend deployment: `6aed55431485a001cd01f85b`.
Source fix: `3534584`.

## Limits and follow-up

- The public catalog is empty. Model execution, populated profiles, comparisons,
  evidence downloads, and funded strategy flows need authorized public agents.
- The wallet selector loaded and canceled through an outside click. No wallet
  login, ownership signature, token approval, deposit, or withdrawal was performed.
- Escape did not dismiss the third-party wallet selector during this run.
  Outside-click cancellation worked.
- Copy-button success feedback was observed. The automation virtual clipboard
  could not confirm the operating-system clipboard contents.
- No application-origin console errors were observed. An unconfigured browser
  wallet extension emitted its own onboarding errors.

Viewports checked: 390 × 844 (mobile), 900 × 900 (tablet), and 1440 × 1000
(desktop). No horizontal page overflow was observed on the checked layouts.

Build, typecheck, and lint completed after the link fix. Lint retains existing
warnings outside the changed docs code. The backend was not redeployed for this
frontend-only correction.
