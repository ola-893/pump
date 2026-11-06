# Quick setup

Start Pump locally, create a paper session, and inspect a model decision.

## Prerequisites

- Node.js 22.13 or newer, with npm. Node 22 LTS is the verified setup.
- Git and an internet connection for installing dependencies and live quotes.
- A local model and inference runtime for model-generated decisions. You can
  open the app and run the offline tests without them.

Rust is needed only for building or testing the smart contracts. A wallet and
testnet tokens are needed only for the [testnet investing flow](INVESTING.md).

## Install and start

```sh
git clone --branch hackathon/near-2026 https://github.com/ola-893/pump.git
cd pump
npm ci
npm --prefix app ci
npm run dev
```

If you already have the checkout, run the last three commands from its root.
Keep the terminal open while you use Pump.

### Use the live website with your local models

To use the deployed frontend instead of the local frontend, run `npm run runner`
from your checkout. Open [Create an agent](https://pump-near-893.netlify.app/register),
choose **Connect local runner**, and approve the connection in the local window.
Allow local network access if your browser asks. You can then create agents,
inspect their identities, and use the trading workbench from the live site.
Disconnect from the app to revoke that tab's connection. Connections also expire
after eight hours or a runner restart. Use either `npm run dev` or `npm run runner`;
both use local port 5197.

Open [your local Pump workspace](http://127.0.0.1:5197/). You should see the agent directory and a
NEAR testnet badge. A fresh checkout starts with no registered local agents.
The Docs tab remains readable even when the trading helper is unavailable.

## Make your first paper decision

1. Start a local OpenAI-compatible inference server that exposes `/v1/models`
   and `/v1/chat/completions`. Use a model capable of returning structured JSON.
2. Open the [local paper workbench](http://127.0.0.1:5197/demo) and create a session. Enter your inference
   endpoint; the default is `http://127.0.0.1:8080/v1`.
3. Choose live dry-run quotes and run one decision.
4. Inspect the proposal and journal. A valid BUY or SELL may produce a simulated
   fill; HOLD leaves the portfolio unchanged. Invalid responses and unavailable
   quotes produce a blocked cycle.
5. Export the evidence to inspect the decision, quote, and portfolio accounting.

Pump does not download model weights. This workbench flow uses your existing
local inference server. The [registered agent flow](RUNNING-AGENTS.md) instead
uses Pump's managed runtime and local model discovery.

## Optional quote API key

The 1Click API key is optional. To configure one, copy the example and edit it locally:

```sh
cp .env.example .env
```

Set `PUMPCOIN_ONECLICK_API_KEY` in `.env`, then restart the dev server. Keep the
file private; the key is used by the server and must not go in frontend code.

## What runs locally

`npm run dev` serves the frontend and local helper together on port 5197.
Paper state is saved under `.local/near-demo/`, which Git ignores. A static
upload of `app/dist` alone does not include the API, model worker, or SQLite journal.

For setup issues, see [troubleshooting](TROUBLESHOOTING.md). For repeatable checks,
see [verification](VERIFICATION.md).
