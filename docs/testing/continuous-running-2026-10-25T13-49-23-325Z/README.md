# Continuous paper trading is running

The service is authorized to keep generating model-directed paper buy/sell
orders until the user stops it. It targets at least 50 fills per agent and
continues afterward. Existing daily caps remain active; it waits for the UTC
reset when needed. Authorization persists across server restarts.

This snapshot verifies at least 50 fills in total. Each saved fill matches
its local-model response and signed live dry-run quote. All accounting
journals replay. These are operator-directed execution exercises, excluded
from autonomous strategy ranking. No tokens moved. The loop was left enabled.

Stop using the directory control or `npm run demo:live -- stop-continuous`.
