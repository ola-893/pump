# Agent console UX audit — 2 November 2026

## Research access and references

Mobbin discovery required sign-in during the preceding investor audit. This
console audit uses Mobbin’s public study and embedded examples, rather than
claiming access to its paid library or copying product assets.

- Study: https://mobbin.com/blog/what-good-dashboard-design-looks-like
- Amplitude anomaly detection: https://mobbin.com/apps/amplitude-web-b9049388-678e-4d5f-bfcc-b7aac27aee79/650988d1-067c-42dd-a69a-3ff57a2a1208/flows
  Surface a clear operational finding before asking users to interpret records.
- Plausible: https://mobbin.com/apps/plausible-analytics-web-42d29d3e-4b3b-487a-8b6c-5dc7e6913071/3248634c-bbff-46b7-b2c4-c26ef6673dea/screens
  Compact metrics with detail a click away, rather than one long mixed-purpose page.
- Cursor research context: https://mobbin.com/customers/cursor
  Separate established settings/admin patterns from the core agent experience.
  This case study is process guidance, not a claim that Cursor’s agent UI was copied.

## Findings and changes

1. The large page introduction repeated the console’s title. Removed that extra
   layer so the selector and controls start higher on the page.
2. The long strategy form appeared before monitoring. Saved versions now open in
   Monitor; drafts open in Strategy & limits. Tabs preserve edits in local state.
3. Scheduler-enabled status looked like successful execution even with a blocked
   cycle. Needs attention and the exact latest blocker now appear beside controls.
   Loading, evaluating, queued, waiting, stopped and draft remain distinct.
4. Start, Run once and Stop were separated from context. They remain visible
   above all views, with the same backend controls and hard limits. Stopping does
   not sell a position; no real worker is started/stopped by the audit itself.
5. The latest successful decision could be old while attempts continued failing.
   Its timestamp remains visible and the sidebar identifies a more recent block.
6. The journal repeated long rows with few ways to inspect them. It now separates
   time/event, outcome and reason, with filters, text search and expandable exact
   event/quote receipts. It still loads automatically and follows five-second
   status updates. Filtering uses the full loaded history; the newest 40 matching
   events are shown. No fake inference or execution stage progress is introduced.
7. Switching to an old version while another version runs could offer invalid
   Start/Save actions. These are disabled with a Select active version shortcut;
   the active session is never silently replaced.

Theme, fonts, private strategy wording, registered models, immutable saved
versions, journals, portfolio accounting and wallet approvals are preserved.
This is a frontend-only change; no backend logic, model files or token movements changed. The development server was relaunched after it was found stopped; continuous authorization was confirmed disabled and real strategy workers remained stopped.

## Verification

Use the existing in-memory console browser fixture on port 5199 for saving,
Run once, background Start/Stop, tabs, dirty drafts, filters and version changes.
Fixture decisions are labeled test responses and never enter the real registry.
Use port 5197 read-only to inspect actual status and journal rendering.

### Checks completed

- Production frontend build and root TypeScript check passed.
- All six existing strategy-console integration tests passed.
- In the isolated browser fixture, saving a draft opened Monitor; Run once
  produced a labeled Model HOLD and updated the journal without manual refresh.
- A fixture-only Start action was exercised. No real agent control was changed.
- Browser access was restored and the remaining checks completed: decision/fill
  filtering, reason search, receipt expansion, draft preservation across tabs,
  save-as-new-version isolation, background automatic journal updates, and
  active-version guards with the Select active version shortcut.
- The fixture worker was stopped through the UI after Start testing.
- Verified 390 px mobile and 1440 px desktop layouts. No document-level
  horizontal overflow; narrow journal tables scroll within their own container.
- The actual registry was inspected read-only after restarting the frontend.
  All real strategy sessions were stopped.
- Fixed a finding from that restart: the most recent recorded blocked cycle
  remains visible even when the temporary in-process error has been cleared.
  The status still accurately says Stopped.
- Screenshot: `.local/agent-console-audit-2026-11-02.jpg`.
