# Registered model metadata recovery

A registered model is bound to its measured SHA-256. The local fast-check stamp
contains filesystem device, inode, byte length, modification time and change
time. A device identifier change previously blocked all inference even when
model contents remained identical.

On a stamp mismatch, live and historical inference now recompute the complete
GGUF SHA-256 without reusing the discovery hash cache. The file must remain
stable throughout hashing and match the registered digest. Only then may the
local stamp and revalidation timestamp be refreshed with a conditional update.
The agent ID, manifest, commitment, model alias, strategies and journals remain
unchanged. Different contents still require a new model registration. Strict
stamp checks before loading and during inference remain in place.

To repair metadata explicitly while trading is stopped:

```sh
npm run demo:revalidate-models -- katana okina nagakiba
```

The command reads models in place, creates no model copies, and starts no
inference, trading workers or token transfers. Its local JSON report includes
registered hashes, previous/current stamps, verification times and fingerprints
confirming unchanged sessions, events and saved strategies.

On 2 November 2026, all three installed models matched their registered SHA-256.
Only device IDs differed (16777232 → 16777229). The preserved-data report is
`.local/near-demo/model-revalidation-1793578045728.json`. Historical blocked
entries remain in the journal; the console uses the newer verification time to
identify the old metadata blocker as resolved. Trading remains stopped.

Validation: 23 model integrity, agent and console regression tests; root
TypeScript check and production frontend build.
