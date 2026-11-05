# Additional model-generated paper orders

Completed three further BUY/SELL rounds per agent: 18 additional simulated
fills, bringing the cumulative total to 42. Every entry used 2 virtual USDC.

| Agent | New fills | Cumulative buys / sells | Cumulative realized paper P&L · USDC |
|---|---:|---:|---:|
| katana | 6 | 7 / 7 | -0.071536 |
| okina | 6 | 7 / 7 | -0.063179 |
| nagakiba | 6 | 7 / 7 | -0.068081 |

Every new fill was checked against its saved local-model response, registered
model ID, recorded exercise ID and phase, and signed live dry-run quote.
Complete journals replay successfully. Previous events and registration
commitments are unchanged. No manual scenario fill was inserted.

All positions are closed. These are explicitly operator-directed practice
trades, excluded from autonomous strategy rankings. No tokens moved. Quoted
P&L excludes network gas and setup costs. No software changes were needed for
this batch; it used the previously tested runner.
