# Clef-27B classifier integration

Registered agent `clef` is private under `rudepuma4060.testnet`. Model files stay in `/Users/deonorla/.local/share/llama.cpp/clef-27b-mlx-4bit`; there is no project weight copy. The pinned model revision is `mlx-community/clef-4bit@b973b6f405d02f8e9b83208c7e82ddf43a742eb6`.

## Artifact identity and runtime

`pump-classifier.json` lists hashes and sizes of every required model file, including the weights, joint decision head, tokenizer, configuration and supplied loader. Registration hashes each file and records the bundle manifest SHA-256 as its model commitment. File metadata across the entire bundle is checked around inference; changed files require content verification. A changed head or tokenizer cannot silently inherit the registered identity. Standard GGUF models retain their existing identification path.

The dedicated Python environment is `/Users/deonorla/.local/share/pump/runtimes/clef-mlx`. Tested package versions are mlx 0.32.3, mlx-lm 0.32.0 and mlx-vlm 0.7.4. The managed worker uses the supplied `clef_mlx.py` and its joint head, not chat generation. It binds only 127.0.0.1:8093, runs offline, accepts text-only fixed-choice requests, refuses inputs over 4,096 tokens instead of truncating, and does not increase macOS GPU memory limits. Model subprocesses receive no signing credentials or app secrets. The same single-model queue unloads the previous managed model before loading another. Historical chat-model comparisons and operator-directed execution exercises are explicitly unsupported for classifiers.

## Actions and sizing

A saved strategy is required. In cash, the allowed choices are BUY and HOLD; with inventory they are SELL and HOLD. Pump derives numeric features from supplied completed candles and route observations. The model scores the options against the saved strategy. It does not generate an explanation or choose the order amount.

The action policy chooses HOLD unless the winning action score is at least 0.60 and the gap is at least 0.10. An action is sized in code up to 10 virtual USDC and the saved per-trade, exposure, cash and remaining UTC turnover limits. SELL sizing additionally needs a fresh whole-position liquidation mark. The existing engine obtains and verifies a fresh execution quote and enforces limits before any simulated fill. Classifier scores are not probabilities of a profitable trade.

Native request/response JSON is retained verbatim as text in model evidence because Pump’s canonical journal accepts only integer numeric values. The normalized proposal remains explicit. Export verification reconstructs the native request and recomputes the action/size from the recorded response and versioned policy, then verifies the existing strategy/model/portfolio bindings. Console receipt inspection shows the scores and inference time.

## Registration and validation

Saved initial strategy: Clef · Momentum classifier, 100 virtual USDC, 10 per action, 30 allocated-cost cap, 60 daily turnover, 50 bps slippage, 60 second interval. Private and stopped; no trading is started by registration or the model check. Gains/losses are not claimed.

A genuine 151-token no-trade classification check selected the expected label twice on this M4 Pro, at approximately 3.4 and 2.7 seconds. MLX reported a peak allocation of 16,657,920,050 bytes. These are short warm-input smoke checks, not trading latency or profitability benchmarks. Reports are saved locally in `.local/near-demo/clef-registration.json` and `.local/near-demo/clef-runtime-check.json`. The owner-only classifier check unloads its worker afterward.

Tests cover binary option construction, computed inputs, thresholds, cash/exposure/turnover bounds, stale exit marks, malformed responses, native evidence replay, full-bundle integrity, private registration, and existing GGUF revalidation/console/privacy behavior. Browser inspection was unavailable because local browser use was disabled; the registration and saved strategy were verified through the local API.
