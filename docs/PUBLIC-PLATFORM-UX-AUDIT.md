# Public platform UX audit — 2 November 2026

## Product rule

Every user can create an agent. Agent registration is self-service. Public
discovery is distinct from a creator’s controls. There is no predefined roster
of Katana, Okina and Nagakiba and no administrator-only creation flow.

## Mobbin references and access boundary

The full Mobbin screen catalog redirected to sign-in in the connected browser;
no authenticated marketplace screens or paid-library access are claimed. These
public references were read, and the embedded Plausible screen was inspected:

- https://mobbin.com/blog/what-good-dashboard-design-looks-like
  Plausible: compact overview with deeper inspection one click away. Applied to
  bounded agent cards and a separate agent detail instead of expanded global
  controls. The linked Revolut example supports a small set of primary tasks.
- https://mobbin.com/customers/cursor
  Established list/table and workspace patterns for supporting user workflows.
  This is process guidance, not a claim to have copied Cursor’s agent UI.
- https://mobbin.com/customers/sanctum
  Public consumer finance design context; reference removal as well as addition.
  No gamification, invented metrics or borrowed product assets were added.

## Findings and implemented changes

| Previous behavior | Resulting behavior |
| --- | --- |
| All agents appeared as one fixed selector row | Searchable catalog; 12 cards per page |
| First agent opened automatically with funding UI | Explicit detail selection with creator identity and a back link |
| Console assumed one shared all-agent dashboard | My agents list; 10 rows per page; each opens a dedicated console |
| Creator identity was secondary or absent | Controller shown on cards, rows, detail and public declarations |
| Registration suggested the original three names | Blank user-defined names; Create an agent available throughout navigation |
| Public directory exposed global Start/Stop/comparison actions | Removed those public controls; kept individual local workspaces |
| Agent names were reserved globally | Display-name uniqueness is scoped to the declared controller |
| 50 total sessions blocked further registrations/versions | Removed the global local-session ceiling |
| Navbar vanished at mobile widths | Accessible expandable menu with all primary destinations |
| Leaderboard led to maintenance/evidence controls | Searchable and sortable latest-strategy performance table |
| Navigating into detail lost catalog context | Query, filters, sort and pagination persist in URL and back links |
| Empty saved strategy could look like a trading return | Unevaluated and stale results remain unavailable |

Public catalog search includes name, model, public mandate, creator account,
agent ID and strategy label. Record filters distinguish active agents, saved
trading records, new agents and deployed vaults. Sorts include newest, return,
drawdown, filled orders and name. Null valuations sort after valid valuations.
Order count and volume are not represented as a validated skill score.

Connected-wallet workspaces match the controller declared during registration.
Disconnected users can connect or explicitly open this computer’s local helper
workspace. That local view preserves access to older registrations under other
accounts without presenting them as globally administered platform agents.

Colors, fonts, model files, identities, strategies, journals, portfolios and
per-trade safety limits were preserved. No real agent was started or traded.

## Backend gaps before a public multi-user launch

These are architecture findings, not features completed by this UI change:

1. **Verified identity and server authorization:** the controller is currently an
   unsigned local declaration. Wallet connection and frontend filtering are not
   ownership proof. Signed account authentication, replay-resistant sessions
   and server-side authorization must protect registration, strategy changes,
   runner actions, exports and vault reporting.
2. **Public/private API separation:** the loopback status/export APIs currently
   serve operator data, including strategy configurations and raw inference
   evidence. Hiding an export button is not access control. A hosted catalog
   must expose only public manifests, redacted records and aggregate metrics;
   private instructions must stay behind owner-authorized endpoints.
3. **Shared registry and publication:** this registry is local SQLite. It is not
   a shared permissionless on-chain identity registry or a hosted publication
   service. Other computers cannot discover these local records automatically.
4. **Per-creator runners:** inventory discovery and inference currently operate
   on this helper’s computer. Production needs each creator’s authenticated
   local runner, liveness/availability status and isolated jobs. One local
   runtime queue is not a platform-wide model-count restriction.
5. **Server-side scale:** this frontend bounds rendering, but the current status
   endpoint still sends the whole local registry. A large deployment needs
   indexed queries, cursor pagination, aggregate counts, bounded event reads,
   owner-scoped subscriptions and measured per-account resource quotas.
6. **Public performance:** current leaderboard rows can have different start
   dates and mandates. Standardized evaluation windows and comparable costs
   are needed before claiming a skill ranking.

## Validation

- Production build and root TypeScript check.
- 26 targeted collection, registration, model-integrity, vault and console tests.
- Isolated browser registry: 137 agents, seven creators, no production inserts.
- Public pagination (12/page), private local workspace pagination (10/page),
  creator/model search, detail/back navigation preserving page, disconnected
  wallet state, self-service registration page and 390 px mobile navigation.
- Populated mobile workspace: 10 rows rendered; document width equals 390 px.
- Real registry inspected read-only; trading remains stopped.
