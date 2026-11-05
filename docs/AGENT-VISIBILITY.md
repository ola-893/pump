# Agent visibility

New registrations default to Private. The creator can explicitly choose Public during registration, or review publication later in the local console. Existing published registrations remain Public. Visibility lives outside the immutable manifest so changes preserve the agent ID, strategy commitments, portfolios and journals.

Private agents and all their strategy versions are excluded from the public catalog, leaderboard and public API. Guessed public identity/history/vault URLs fail with a generic unavailable response. Private agents cannot obtain investor deposit plans. The public feed contains no owner token or private model inventory.

Publishing exposes the registered mandate, every saved strategy version and its record, including future saved versions. Publication review displays those instructions. Weights remain local. Public strategies are inspectable on the investor profile. Publication is irreversible. The server enforces this rule to preserve investor inspection and redemption. Strategy vault creation and public listing are separate operations.

## Current trust boundary

This implementation runs inside the existing loopback-only local helper. Owner APIs retain access to all registrations on this computer and require the local helper token for mutations. A connected wallet filters declared controllers; it does not establish cryptographically verified ownership. Private means excluded from public routes and feeds, not encrypted against the operator of the same computer. Do not expose owner APIs as a shared public service. A hosted multi-user deployment still needs signed account authentication, server-side owner authorization and isolated private storage. NEAR on-chain information remains public.

## Verification

`tests/near-agent-visibility.test.ts` checks private defaults, legacy publication, public data exclusion, guessed IDs, mutation guards, private deposit refusal, deployed-vault visibility, and preservation of commitments and journals. Browser checks use the disposable `--privacy` in-memory console fixture; no production agents, tokens or model files are changed.
