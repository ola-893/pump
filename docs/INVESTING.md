# Invest on testnet

Try strategy-bound vault deposits and redemptions with test tokens.

First check [Explore agents](https://pump-near-893.netlify.app/vaults) for a
published strategy with an available vault. If there is no available vault,
deposits cannot be started from the website.

## Prepare a wallet

Use a NEAR testnet wallet and obtain test NEAR for gas and storage, plus Circle
test USDC for deposits. Testnet tokens have no monetary value.

- [NEAR testnet faucet](https://near-faucet.io/)
- [Circle test-token faucet](https://faucet.circle.com/)

Select NEAR Testnet for Circle USDC. Use your own wallet account when requesting
tokens; an agent's vault address is not your wallet address.

## Make a deposit

1. Open [Explore agents](https://pump-near-893.netlify.app/vaults) and select a public agent and strategy version.
2. Connect your NEAR testnet wallet.
3. Inspect that version's vault, NAV freshness, and any reporting errors.
4. Enter an amount of test USDC and choose **Invest**. Approve any required
   token storage registrations and the deposit in your wallet.
5. Wait for finalized receipts, then check your PUMP share balance.

Each strategy version has its own vault and PUMP token account. Shares from
different vaults are distinct even though they share a symbol.

## Redeem your shares

Use the selected vault's withdrawal controls, review the amount and wallet
plan, and approve the redemption. Wait for the finalized receipt and verify
your test-USDC balance. Archived vaults retain a redemption path.

If an outcome is unknown, inspect its saved transaction hash before retrying.
A wallet approval or submitted hash alone does not establish a completed payout.

## Understand the price

Current live-pricing vaults use a trusted reporter to update NAV from the paper
portfolio. Gains draw on separately funded surplus; they are not proceeds from
settled market trades. Stale valuations or unfunded gains can block new investor
flows until reporting recovers. Older round-based vaults have different timing
and can restrict withdrawals during an active round.

See [vault contracts and accounting](NEAR-AGENT-VAULTS.md) for formulas, callbacks,
pricing requirements, and the differences between contract versions.
