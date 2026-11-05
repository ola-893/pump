# Shared NEAR testnet wallet

The header, registration page, investor vaults and `/demo` use one NEAR Connect
session. Connect opens the testnet wallet selector; the account menu exposes the
full account, Change wallet and Disconnect. An existing selected wallet is read
on reload without automatically initiating sign-in. Connection requests no
message signature, function-call key or transaction.

Registration fills Controller account from the selected wallet. It no longer
falls back to the server's deployment controller. Automatically filled accounts
follow wallet changes and clear on disconnect. Editing the field explicitly
keeps a manual controller; Use connected account restores automatic filling.
No agent name, model, strategy or capital limit is inferred from a wallet.
Registration remains a local unsigned declaration, not proof of account control.

Vault account changes clear the workspace's reviewed plans and observations.
The clearing workbench also clears plans and balance observations. Every send
still checks the current testnet wallet account and its existing transaction
allowlist. Wallet connection does not start agents or move tokens.

Checks: `node --import tsx --test tests/near-wallet-session.test.ts tests/near-agent-vaults.test.ts`. For isolated UI checks, run
`node tests/near-wallet-browser-fixture.mjs` and open port 5200. Its fictional
Alice/Bob accounts never connect a real wallet and transaction methods fail.
The production UI remains on port 5197.
