# Troubleshooting

Start with the visible error and preserve existing journals while diagnosing it.

## The app will not start

Check `node --version` and `npm --version`. Use Node 22.13 or newer; Node 22 LTS
is the verified setup. Run `npm ci` and `npm --prefix app ci` from the repository
root, then `npm run dev`.

Port 5197 must be available. If another Pump process owns it, use that process
or stop it deliberately before starting another. The configured server does
not silently switch to a different port.

## Local helper is unavailable

Keep `npm run dev` running on the same computer and open
`http://127.0.0.1:5197`. The helper deliberately restricts control APIs to
loopback origins. A static frontend preview does not provide those APIs.
Documentation remains available independently of the helper.

## No models were detected

Pump does not install weights. Check that your existing model is in a supported
local model directory, then detect again in Create an agent. Registered files
must remain available and unchanged. A changed checksum requires registration
of the new artifact; do not overwrite an earlier model's identity.

See [runtime prerequisites](RUNNING-AGENTS.md#prepare-your-model). For an external
inference server, use the paper workbench and check that `/v1/models` responds
at the configured loopback endpoint.

## A decision is blocked or the model keeps holding

HOLD is a valid model decision. Insufficient evidence does not require a trade.
Inspect the journal for malformed model output, timeout, unavailable quotes,
insufficient virtual balance, or a configured risk limit.

Check inference health, memory, and quote connectivity before retrying. Pump
preserves failed attempts and does not substitute synthetic fills for a live
quote failure.

## Wallet or investment is not ready

Confirm NEAR testnet is selected and the wallet has test NEAR for fees and
storage plus test USDC for deposits. Read the vault's reporting status. Stale
NAV and insufficient surplus require reporter or vault funding recovery before
affected investor actions can succeed.

For a pending transaction, inspect the saved hash and finalized receipts before
sending anything again. Follow the [investing guide](INVESTING.md).

## Get help

[Open a GitHub issue](https://github.com/ola-893/pump/issues) with your Node
version, operating system, steps, and the relevant error. Remove API keys,
wallet secrets, and private strategy text before sharing logs or exports.
