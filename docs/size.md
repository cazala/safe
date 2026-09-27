# Size report

Budget (spec §19): ideal < 50 KB, good < 100 KB, acceptable < 200 KB raw. `npm run build` prints the numbers and fails above 200 KB.

| Phase | raw | gzip | js | css | notes |
| --- | --- | --- | --- | --- | --- |
| 0 spike | 4,186 | 2,408 | 3,389 | 475 | keccak + ABI helpers + Safe reads |
| 1 read-only | 8,864 | 4,491 | 6,448 | 2,085 | UI shell, routing, Safe view, dark mode |
| 2 tx builder | 15,000 | 7,110 | 12,584 | 2,085 | builder, SafeTx hash, getTransactionHash check, review gate |
| 3 approvals | 23,746 | 10,171 | 21,330 | 2,085 | approveHash, approve-and-execute, revalidation, simulation, share link/JSON, import |
| 4 create | 26,432 | 11,021 | 24,016 | 2,085 | create view, eth_call prediction, deploy + verification |
| 5 offchain | 28,935 | 11,888 | 26,519 | 2,085 | EIP-712 signing, ecrecover-precompile recovery, merge/import signatures |
| 6 decoder | 31,419 | 12,816 | 28,951 | 2,137 | ERC-20 + Safe config decoding, danger banners |
| 9 pending | 34,015 | 13,847 | 31,431 | 2,253 | publish-with-approval, ApproveHash log discovery |
| 10 tokens | 38,441 | 15,401 | 35,857 | 2,253 | TokenList + Multicall3 balances, send form, token-aware review |
| 11 names | 40,741 | 16,278 | 38,157 | 2,253 | ENS (+ENSIP-10) and WNS forward/reverse, re-check before signing |
| 12 multisend | 44,066 | 17,342 | 41,482 | 2,253 | batch queue, MultiSendCallOnly encode/strict decode, per-call review |

## Major contributors

- `src/keccak.js` (~1.1 KB min): Keccak-256; replaces `@noble/hashes` / `ox`.
- `src/share.js` (~2.5 KB min): compact payload, link fragment, JSON import with validation.
- `src/abi.js` (~1.9 KB min): hex, ABI encode/decode, checksum, amount parse/format.

## Avoided

- secp256k1 (e.g. `@noble/curves`, ~20 KB+): signer recovery uses the chain's `ecrecover` precompile via `eth_call`.

## Rejected

- `ox` (tree-shaken): 54 KB min for the same primitives. See docs/research.md.
