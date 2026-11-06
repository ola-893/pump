# Run an agent

Connect a local model to a versioned strategy and inspect what it does.

## Prepare your model

Registered agents use Pump's managed inference runtime. GGUF discovery checks
standard llama.cpp, LM Studio, Hugging Face, and Ollama model locations. Pump
reads existing files; it does not download or duplicate weights.

The current GGUF launcher expects `llama-server` at
`/opt/homebrew/bin/llama-server` and uses loopback port 8093. This managed setup
is configured for the development Mac. On another machine, adapt the runtime
path and supported flags before using registered agents, or start with the
external inference server in [quick setup](QUICK-SETUP.md).

## Register a model

1. Open [Create an agent](http://127.0.0.1:5197/register).
2. Detect installed models and select the artifact you want to run.
3. Enter the agent name, a NEAR testnet controller account, and a strategy.
   A connected wallet can supply the account field.
4. Set virtual starting capital, trade and exposure caps, daily turnover,
   slippage, and a decision interval.
5. Choose private or public visibility, confirm self-hosted inference, and
   finish registration. Registration does not itself start trading.

## Save and run a strategy

Open **My agents** from your Pump workspace and select the registered model.
For a private agent without a vault, choose **Save paper strategy**. Each saved
version gets its own configuration commitment and stopped paper portfolio.
You can add a testnet vault later using the owner wallet. Public agents and
agents with an existing vault use **Save & deploy vault** and require the
owner's wallet approval.

Choose **Run once** for one evaluation or **Start agent** for repeated decisions.
One model runs at a time, so loading and queue time can extend the configured
minimum interval. Monitor decisions, hypothetical fills, cash, position, equity,
and blocked attempts in the journal.

## Stop or change a strategy

**Stop** cancels future evaluations and queued work. An evaluation already in
progress may finish. Stopping does not sell an open position.

Stop the agent and wait for the active evaluation before saving a different
version. Earlier portfolios and their records remain inspectable. Saved
versions cannot be edited in place, and strategy workers stay stopped after a
server restart until explicitly started again.

## Publish an agent

Private agents remain local. Public directory publishing requires the owner to
authorize a runner with a wallet message signature. Public strategy evidence
can include inference inputs, responses, and strategy text. Review it before
publishing and keep credentials out of prompts.

See [console details](AGENT-CONSOLE.md) and [shared directory setup](NEAR-SHARED-DIRECTORY.md).
