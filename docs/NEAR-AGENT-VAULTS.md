# Strategy vaults and pump coin

Pump routes investments to the vault for the exact selected strategy version.
New strategy versions receive their own vault, whether the agent is public or
private. The owner approves deployment in a NEAR testnet wallet before Pump
activates the version. The contract records its strategy ID and commitment.
Earlier versions keep their independent records and any existing investor
holdings. Archived vaults remain available for withdrawals.

The original per-agent testnet vaults were removed from the active registry.
Their deployed accounts and historical observations still exist on testnet.
New deployments use distinct accounts and never reuse an earlier version's
vault. See the original records in
[deployment observations](testing/near-agent-vault-deployments.json).

## Automatic live pricing

New v4 vaults receive signed, fresh whole-position liquidation valuations from
the local testnet reporter. The reporter checks approximately every 10 seconds
and renews active valuations at least every 20 seconds, subject to quote and NEAR
finality latency. It uses a separate quote request so model inference can continue.
The investment panel reads finalized NAV and pump coin price every five seconds.

Each accepted report sets investor assets to
`floor(total_supply * current_equity / reference_equity)`. The reference is fixed
while pump coin is outstanding. A late investor mints at the confirmed NAV.
The reserve funds gains and receives losses, preserving test-USDC custody.
An unfunded gain fails and displays a reporting error. Reports include a hash of
the strategy, portfolio snapshot, source journal and raw signed valuation quote.

Live vaults accept investor transfers while the confirmed price is fresh.
If active valuation is over 60 seconds old, deposits refund and redemptions reject
until a fresh report confirms. Pending payouts block NAV changes. Independent
report sequences and nonce checks reject stale writes. Stopped cash-only
strategies hold their last confirmed price. Archived vaults keep their final price
and redemption path.

The local reporter signs only `report_nav` calls with zero deposit using the
existing Pump testnet deployer. Its journal stores signed bytes before broadcasting
and resumes those same bytes after an interruption. Reports use the signer’s
funded test NEAR balance and record gas usage by UTC date. The private signer
stays outside model inference.
The older v2/v3 vaults retain their round-based settlement behavior.

## Token accounting

Each contract is a separate NEP-141 pump coin token with NEP-145 storage and
NEP-148 metadata. All use six decimals and symbol PUMP; the contract account
and strategy binding distinguish them. They are not a platform-wide currency.

The first deposit mints one share unit per test-USDC unit. Later deposits mint
`floor(deposit * total_supply / investor_assets)`. Redemptions pay
`floor(shares * investor_assets / total_supply)`. The last shareholder receives
all remaining investor assets. The surplus is excluded from both formulas.
Mint minimums and a changing NAV nonce reject stale plans; rejected
`ft_transfer_call` deposits are refunded by the token resolver. Unsolicited
plain FT transfers do not mint shares or change the accounted NAV.

Shares can be transferred between registered share accounts. Share account
unregistration is deliberately disabled in this demo so an asynchronous failed
redemption can always restore its exact burned shares. Storage preparation
reads each contract’s actual minimum. The contract caps investor assets at one
million test USDC, share supply at 10^24 base units and each incoming transfer
at one million test USDC. Rounded zero-share deposits are rejected.

## Investor walkthrough

1. Open `/vaults`, choose the agent and strategy version, and connect a NEAR testnet wallet.
2. Obtain Circle test USDC and test NEAR for gas and storage.
3. Enter a test-USDC amount and select **Invest**. Pump prepares any missing token registrations and requests wallet approvals.
4. Check the resulting pump coin balance and finalized receipt.
5. Outside an active paper round, enter the test-USDC amount to withdraw and approve the redemption.

A redemption
locks that vault’s NAV-changing operations while its outgoing token transfer is
pending. A failed transfer restores assets and the exact shares, with callback
IDs preventing duplicate completion. Unknown submitted hashes persist locally;
inspect them instead of broadcasting a replacement. A callback failure can
leave a pending operation requiring receipt investigation; this demo does not
provide an unsafe administrator override.

## Paper rounds and surplus

The configured controller funds a separately tagged surplus for each vault.
Surplus funding never mints pump coin and never increases investor performance.
Only free surplus can be withdrawn, and never during a round or payout.

The trusted reporter opens a round for the vault’s pinned, stopped paper strategy with no open position and reviews
**Begin round**. The contract binds that strategy version’s commitment, session
sequence and starting equity before any round decisions. Deposits and
redemptions then close. **Start bound paper agent** runs that version locally;
**Stop bound agent** stops its scheduler. The independent console portfolios
are not direct investor-custody balances.

To settle, stop the bound strategy and wait for its own sell decisions to close
its position. The backend verifies its full model/quote/accounting evidence and
rejects activity predating the on-chain round. The reporter reviews and signs
`new_assets = floor(old_assets * ending_paper_cash / reference_paper_cash)`.
Gains consume only that agent’s surplus; losses replenish it. Insufficient
surplus blocks gains. A round cannot assert a gain above 100%; there is no
claimed expected return. Settlement reopens investor flows without changing
share supply. Each new strategy version opens a separate vault and starts its own record.

Any investor may cancel a round left unsettled for 24 hours. This explicitly
applies no simulated return, logs the cancellation and reopens flows at the
previous NAV. It is a testnet escape mechanism, not settled trading profit.
Deposits/round starts can be paused by the controller; idle redemptions remain
available while paused. Active-round cancellation/settlement remains possible.

The contract trusts the reporter. It checks balances and authority, not model
execution or quote truth. Public contract evidence includes hashes, not raw
private strategy prompts. Local evidence exports can still include prompts.

The active NEAR readers, wallet provider and deployment commands use the
current FastNear testnet RPC, `https://rpc.testnet.fastnear.com`. The former
near.org endpoint returned its deprecation notice with HTTP 429 during browser
acceptance; it is no longer used by these clients.

## Commands and acceptance

- `npm run vaults:factory-build` compiles the factory and strategy vault contracts.
- `npm run vaults:factory-plan` records the one-time testnet installation address, code hashes and funding.
- `npm run vaults:factory-deploy` broadcasts the reviewed installation, verifies the keyless factory and updates the local deployment configuration.
- `npm run test:agent-vault` runs the Rust vault tests.
- `NEAR_SANDBOX_BIN=/absolute/path/to/near-sandbox npm run test:agent-vault-sandbox` exercises the WASM and token callbacks locally.

For each new strategy, the console asks the agent owner's wallet to fund and sign
the vault deployment. Pump verifies the child contract and its immutable strategy
commitment before activating the version. If the previous vault uses the older
contract, its controller must approve closing deposits and new rounds. That
contract retains its original redemption method. Factory vaults record a
permanent archive flag and leave redemption available. Private agents receive a
vault with investor deposits disabled until the owner publishes it.

The older `vaults:plan` and `vaults:deploy` commands support legacy testnet
recovery. The console uses the factory for new versions.
Keys stay in ignored local mode-0600 files. Never publish them. Deployment
configuration and observations contain only public account IDs and code hashes.

Contract tests cover share price, reserve conservation, gains/losses, failed
payouts, expiry, access control, stale NAV, zero-asset recovery and share transfer.
TypeScript tests cover identity/keylessness, wallet plans, strategy isolation, proportional previews, reporting authority, RPC failover, durable NAV errors, interrupted transaction recovery, daily gas caps and insufficient surplus. The local sandbox deploys actual WASM and runs FT callbacks with a fixture token, not Circle-issued USDC. Its live NAV test verifies exact gain and loss payouts, a second investor entering at a changed price, full-exit conservation, archive redemption and an identical signed resubmission without a duplicate deposit.

The public Ntuwadumela v3 test has confirmed 5 Circle test USDC invested, 1 Circle test USDC surplus, and automatic price changes from genuine local-model paper decisions. A fetched public NAV transaction also passed independent journal, signed-quote and arithmetic verification. The new v4 gain/loss payout matrix was run in the local sandbox; it must not be represented as a completed public Circle gain-and-loss withdrawal matrix.

## Current evidence and operating boundary

Export price evidence from the investment panel and run `npm run nav:verify -- /path/to/export.json`. The verifier fetches the transaction from testnet, checks signer, receiver, method, exact arguments and final receipt status, verifies the raw quote signature and replays the available source journal. Old reports may lack a full source-session snapshot; the verifier states whether that journal check was possible. Offline remote runners may likewise provide quote/chain evidence without the complete local journal.

The reporter uses the public providers listed in `near-demo/rpc.ts`, with bounded read pacing, short head caching, pinned-block reads, endpoint cooldown and failover. SDK signing/submission uses that same transport. No failed lookup becomes a zero balance. NAV errors persist through restarts and clear on successful recovery. Reporting can continue throughout the day while the signer has sufficient test NEAR. Unfunded gains and stale reports stop investor transfers instead of inventing backing.

[Shared directory and per-computer runners](NEAR-SHARED-DIRECTORY.md) keep owner-authenticated publishing separate from model execution. Common-period performance comparisons show explicit coverage and cost assumptions. They do not certify model execution or trading skill.

## Post-demo testing checklist

- [ ] Request as much test NEAR and Circle test USDC as the official faucets permit. Replenish the reporter and vault deployer, and set aside test USDC for tester deposits and vault surplus.
- [ ] Verify that a new tester can obtain both tokens, connect a testnet wallet, invest, and withdraw without relying on an operator’s wallet.

## Deferred scope

Mainnet swaps, production custody and independent contract/security review remain deferred. Public hosting, cross-machine real-wallet acceptance, outage drills and scale/retention testing remain release QA gates. The legacy clearing flow under `/demo` remains separate from strategy-bound vaults.
