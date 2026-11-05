# Model-generated paper buy/sell exercise

Completed 2026-10-25T00:56:56.416Z. All three registered local models generated a BUY
and a subsequent full SELL. Six simulated fills used signed live 1Click dry-run
quotes. Each entry used 2 virtual USDC; all positions are now zero. Workers
stopped after their round trips completed. No tokens moved.

| Agent | Model-generated actions | Realized paper P&L · USDC | Journal events |
|---|---|---:|---:|
| katana | BUY → SELL | -0.006749 | 16 |
| okina | BUY → SELL | -0.012232 | 15 |
| nagakiba | BUY → SELL | -0.012327 | 14 |

These are explicitly operator-directed execution exercises. The original
strategy and its earlier HOLD decisions remain in each journal. These samples
are excluded from autonomous strategy rankings; the historical USDT comparison
is unchanged. Small realized losses reflect the observed quoted round trips;
network gas and setup costs are excluded. The UI displays finer live-return
precision so sub-basis-point losses are visible.

Verification checked all six fills against their actual saved model responses,
registered model IDs, exact exercise IDs/phases and signed live quote receipts.
Each complete portfolio journal replays successfully. There are no manual
scenario fills. Evidence is local consistency checking, without independent
model-host attestation.

Validation: 218 tests, root typecheck and production build passed. Visual
verification remains unavailable because local browser control is disabled.

The three evidence JSON files include the full manifests, immutable operator
mandates, raw prompts/responses, quote receipts and accounting journals.
