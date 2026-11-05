# Investor funding flow

Investors enter a test-USDC amount and select **Invest**. Pump checks the connected wallet balance and vault availability, completes only the missing token account registrations, then requests a fresh deposit plan. The investor approves the setup and investment transactions in their own testnet wallet. Setup transactions never produce an investment-success message.

The deposit uses Circle test USDC `ft_transfer_call` with the selected strategy vault as receiver, a minimum pump coin mint, and the current vault nonce. The vault holds the actual test tokens. Only model trading is simulated.

Confirmation requires FINAL execution, the correct transaction/signer/vault, the token transfer event, the vault deposit event, the matching pump coin mint, and the FT resolver's accepted amount. A complete refund is reported separately. An uncertain outcome retains its transaction hash and prevents a replacement investment until checked.

**Withdraw** also accepts a test-USDC amount. The backend calculates the amount of pump coin needed, rounding up, and binds the minimum payout and current nonce. Success requires the vault payout callback and a matching token transfer to the investor. A restored payout is not success.

Vault state, wallet balances, pump coin balances and actual contract-held test USDC are read at the same finalized block. Investor assets and the operator reserve remain separate. Creating an agent or running a virtual portfolio does not fund a vault.

## Validation

- `tests/near-vault-investment.test.ts`: sequential setup, cancellation, zero-wallet checks, fresh funding plans, transfer/mint confirmation, refunds and withdrawal callbacks.
- `tests/near-agent-vault-sandbox.ts`: isolated real WASM contracts with a local FT fixture, actual token transfers, share mint/burn, rejected-deposit refunds and failed-payout restoration. The local fixture is not Circle-issued USDC and does not touch public accounts.
- `tests/near-vault-browser-fixture.mjs`: visibly labeled isolated UI test with a fictional wallet; no public chain, models, registry mutations or user funds.

Public testnet verification still requires faucet USDC in the connected investor wallet and the user's wallet approvals. No public deposit is claimed from a setup transaction or a zero-balance observation.
