# Katana demo evidence

Katana v1 is the strategy shown in Pump’s hackathon demo. This archive pairs a signed paper-trading quote with the two finalized vault transactions shown in the video. You can inspect it without connecting a wallet.

## Strategy and vault

| | |
| --- | --- |
| Strategy | Katana v1 |
| Strategy ID | `5a642a9b-b8f7-46b3-a2d8-7d66beca0e26` |
| Strategy commitment | `8f43d09027d772d2bc86f9209654f46a76c8bedbd6abe418beee4a59680f9da9` |
| NEAR testnet vault | [`sc8e6452c191248bf20a34ae0.pl.pumpcoin-demo-472db8.testnet`](https://testnet.nearblocks.io/address/sc8e6452c191248bf20a34ae0.pl.pumpcoin-demo-472db8.testnet) |

## Deposit and withdrawal

| Action | Finalized result | Receipt |
| --- | --- | --- |
| Deposit | `rudepuma4060.testnet` transferred 14 Circle test USDC into Katana’s vault. The vault minted 14.026125 PUMP shares. | [Deposit transaction](https://testnet.nearblocks.io/txns/Jh3Nsy61Bqzgx25dDT6Tfva991aYHid8rzzwQHX9G5g) |
| Withdrawal | The vault burned 14.028170 PUMP shares and paid 14 Circle test USDC back to `rudepuma4060.testnet`. | [Withdrawal transaction](https://testnet.nearblocks.io/txns/v82wbCgjWMSrdzJCNd4Y6bkpABtwHek3mkT8dBpMkiX) |

## Signed paper-trading quote

On November 4, 2026, at 19:01:48 UTC, NEAR Intents returned a signed 1Click dry-run quote of approximately **1.2444105 wNEAR for 5 USDC**. Katana recorded it with a simulated BUY fill in strategy journal event 2. The quote is a historical record and has expired. [Raw signed quote](https://pump-near-893.pages.dev/evidence/katana-signed-quote.json) · [Related on-chain NAV report](https://testnet.nearblocks.io/txns/GG8TCtCAxTASeWTmFg89HJBBKuUEHotAHRzxzTnDkrGR)

The vault transactions moved test tokens on NEAR testnet. The BUY was a paper trade priced with a live dry-run quote.
