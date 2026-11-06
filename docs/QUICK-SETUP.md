# Quick setup

On the [Pump website](https://pump-near-893.netlify.app/register), connect a NEAR
testnet wallet and select a local model. Enter the amount of Circle test USDC
to seed the agent, then approve vault setup and the deposit in your wallet.
Pump finishes creating the agent after the deposit is confirmed. You can view
and withdraw the seed in **My agents**. The vault holds test tokens; decisions
and fills remain paper trades.

## Local development

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

With `npm run dev` running, open [your local Pump workspace](http://127.0.0.1:5197/).
A fresh checkout starts with no registered agents.

## Make your first paper decision

1. [Register an installed model](RUNNING-AGENTS.md) and set its virtual balance.
2. Open the [local paper workbench](http://127.0.0.1:5197/demo) in the browser.
3. Select the agent and choose **Run one decision**.
4. Open **Decision evidence** to inspect the proposal and journal. A valid BUY or SELL may produce a simulated
   fill; HOLD leaves the portfolio unchanged. Invalid responses and unavailable
   quotes produce a blocked cycle.
5. Export the evidence to inspect the decision, quote, and portfolio accounting.

Pump discovers installed weights and runs the selected model locally.

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
