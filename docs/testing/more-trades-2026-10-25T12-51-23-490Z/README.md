# Additional local-model paper trading

All three agents completed three additional BUY/SELL rounds, adding 18
simulated fills. Together with the earlier exercise, they now have 24 total
fills. Every entry used 2 virtual USDC and every position was fully exited.

| Agent | Additional rounds | Additional fills | Total buys / sells | Cumulative realized paper P&L · USDC |
|---|---:|---:|---:|---:|
| katana | 3 | 6 | 4 / 4 | -0.040447 |
| okina | 3 | 6 | 4 / 4 | -0.038348 |
| nagakiba | 3 | 6 | 4 / 4 | -0.043523 |

Every additional fill was matched to a saved local-model response, registered
model ID, exercise instruction and signed live dry-run quote. Complete
journals replay successfully. All earlier events and original registration
commitments are unchanged. Okina had one inference timeout during its last
exit; the failed attempt is preserved, and a subsequent model response
completed the sale. No fill was manufactured or substituted.

These are explicitly operator-directed execution exercises, excluded from
autonomous strategy rankings. Virtual capital only; no tokens moved. The
quoted round trips exclude network gas and setup costs. All positions are now
zero. No workers were left running by this on-demand batch.

Validation: 219 tests, typecheck and production build passed. Model files were
read from the existing central storage; no weight downloads or copies.
