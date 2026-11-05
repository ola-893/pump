# Pump testnet remote verifier

This read-only Worker is the independent cloud side of Pump's staging acceptance test. It fetches a public directory publication and verifies the owner certificate, runner signature, strategy mandate, raw model decisions, signed dry-run quotes and paper accounting. It independently checks the claimed owner's current full-access key on NEAR testnet.

It has no model weights, wallet credentials, runner credentials or NAV signing authority. Its source directory is fixed at build time. GET `/verify?agent=<UUID>` reports the source checkpoint, strategy commitments and finalized ownership observation. A passing result establishes attribution and evidence consistency. It does not attest historical model execution.

The `entry.ts` source imports Pump's shared verification code. From the parent Pump checkout, rebuild the deployable Worker with the locked root dependencies.

```sh
./node_modules/.bin/esbuild staging/verifier/entry.ts --bundle --platform=browser --format=esm --target=es2022 --outfile=staging/verifier/worker/index.js '--external:node:*' --define:self=globalThis
```

The bundled `worker/index.js` is self-contained and is the hosted source artifact. `bash scripts/build.sh` packages it. `node scripts/validate-artifact.mjs` validates the ESM export. Site publication uses the project ID recorded in `.openai/hosting.json`.

POST `/verify-checkpoint?agent=<UUID>` verifies an already-public signed checkpoint when a temporary directory transport is offline. It accepts only the configured staging audiences and a maximum 2 MB JSON body, retains no uploaded state, and reports the original checkpoint timestamp and its age. This checks historical evidence, not current directory availability or runner liveness.
