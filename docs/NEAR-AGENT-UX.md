# Local NEAR agents

Open the NEAR instance at http://127.0.0.1:5197/agents. The reference app on port 5173 belongs to another checkout and is left untouched.

## Registration

`/register` has three steps:

1. **Identity & inference** — choose from downloaded local GGUF files, provide a public NEAR testnet controller and confirm self-hosted inference.
2. **Strategy & mandate** — declare the strategy, virtual starting balance, trade/exposure/daily limits, slippage and decision interval.
3. **Review & export** — review the entire declaration, export a draft or register locally. Registration reads the existing file to measure SHA-256 and binds a paper session to that exact model.

Registered profiles show the controller, model variant, quantization, file size, SHA-256, runtime/context, authority boundary, complete strategy and limits, manifest commitment, live activity and historical comparison decisions. A public manifest excludes model paths. The complete evidence export includes the replay-checked paper journal and historical comparison inputs, outputs, dataset and accounting checks.

Model files are read in place. The scanner checks standard llama.cpp, LM Studio, Hugging Face and Ollama locations, follows cached GGUF file symlinks, and consolidates hardlinks to the same underlying file. Split GGUF shards and multimodal projectors are excluded because registration currently measures a single text-weights artifact. It does not download, move or duplicate weights. Detection is installation discovery; registration is an unsigned local declaration, not an on-chain identity or hardware attestation.

The requested local agents are katana (Muse-Glimmer-30B), okina (Qwen3.8-27B), and nagakiba (gemma-4-26B-A4B). Their controller is the public testnet account already configured in deployments/near-demo-testnet.json. `npm run demo:register-local` registers missing requested agents idempotently without altering existing declarations.

## Market inputs and comparisons

The public Binance data endpoint supplies up to 720 closed hourly NEAR/USDT candles (approximately 30 days). Invalid, unfinished, missing or stale candles are rejected. There is no synthetic fallback. Requests are read-only and require no exchange account or API key. Source API documentation: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints.

Each live model decision receives up to 12 recent closed hourly candles, 14 complete UTC daily aggregates, a summary of the full saved history, and six recent recorded route quotes. This bounds the live prompt for the declared 4,096-token context. Historical comparisons retain up to 24 hourly candles and 30 daily aggregates at each cutoff. No future or unfinished candle is supplied. Exchange USDT research data does not become an Intents USDC execution quote.

The directory's shared comparison runs all selected registered models sequentially using the same saved dataset and 24 daily historical cutoffs. Each starts with **100 virtual USDT**, a 20 USDT trade cap and 80 USDT allocated-cost cap. A proposal fills at the **next hourly candle open**, with **10 bps adverse slippage and 10 bps fee per side**. Daily liquidation marks include exit costs. Gas and market impact are excluded. Decisions cannot see next-bar or later prices. Position units use 24 decimal places and quote units use six; accounting uses integers.

Every actual local model response, HOLD, rejection or inference error is retained. Failed inference leaves the wallet unchanged and never manufactures a decision. Rankings appear only for completed, comparable 24-decision runs without inference errors; partial runs remain unranked. Tied returns share a rank. These are exploratory retrospective comparisons, not independent prospective performance or evidence of future returns. Drawdown is observed at daily valuation checkpoints, not a continuous intraday maximum.

`npm run demo:compare-local` starts the requested three-agent comparison through the running app, reports progress, and exports evidence to docs/testing/near-agents-20261025/. The UI can stop after the current decision. Only one helper-owned llama-server is loaded at a time. A service restart interrupts the run and retains its records; it never silently resumes. Build processes do not instantiate the demo API or modify comparison state.

## Paper trading and Circle test USDC

`/demo?session=<paper-session-id>` opens the profile's bound paper workbench. The helper loads the registered model automatically on loopback port 8093. It does not kill unrelated inference servers or pass application credentials to the child process. Existing downloaded weights and installed llama-server are required.

Historical USDT comparison accounting and live USDC quote-driven paper accounting are separate. Mainnet trading remains disabled. Circle test USDC clearing remains a distinct optional testnet fund flow; registration and comparison transfer no tokens and do not require a funded wallet.

## Validation

Tests cover hardlink discovery and mutation detection, invalid/gapped/incomplete market candles, historical input cutoffs, next-bar fills and costs, cap enforcement, inventory and cost conservation, bound model aliases, comparison hash chains and complete accounting replay, interrupted runs and concurrent observers. The existing full regression suite and frontend build are also run.

Muse-Glimmer uses its embedded chat template with the assistant recipient prefilled to `user`, so the requested JSON answer is generated directly. This is a prompt-format configuration, not modified weights. The template is saved in near-demo/muse-direct-answer.jinja; its actual server-reported SHA-256, llama-server executable SHA-256, build, context, batch sizes, caches and reasoning budget are recorded with each result. Other models use their embedded templates. All use the same trading inputs and limits; runtime/template differences remain visible rather than being described as identical inference configurations.

The old Muse template defaults `reasoning_strength` to `high` and does not use Qwen's `enable_thinking` variable. The helper supplies `reasoning_strength: low` as well as bounded output. See the model maintainer's [inference notes](https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF/blob/main/README.md) and [llama.cpp server reference](https://github.com/ggml-org/llama.cpp/tree/master/tools/server).

`npm run demo:verify-agents` verifies each registered configuration using a real local-model decision and live signed dry-run quotes in temporary in-memory paper ledgers. The persistent named sessions remain untouched so they can still be linked to a confirmed Circle testnet deposit. Model warm-up is followed by a fresh input-quote request. Inference inputs are validated at receipt time; every hypothetical fill obtains and validates a separate current execution quote after the model has finished.

The active frontend uses only the NEAR demo API.
