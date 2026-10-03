# Size report

Budget (spec §19): ideal < 50 KB, good < 100 KB, acceptable < 300 KB raw (raised from 200 KB in October 2026, for transaction history, saved calls and faster scans). `npm run build` prints the numbers and fails above 300 KB (307,200 bytes).

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
| 13 safe apps + mobile | 51,813 | 20,125 | 48,280 | 3,181 | Safe Apps SDK host, app mode, responsive layout |
| Safe Apps removed | 44,431 | 17,484 | 41,604 | 2,496 | host dropped (docs/safe-apps.md); mobile layout kept |
| bulk send + deeplinks | 48,566 | 19,111 | 45,739 | 2,496 | CSV bulk transfers, send/batch deeplinks, Safe by name |
| wallet picker | 50,904 | 19,928 | 47,502 | 3,047 | EIP-6963 discovery, connect/switch/disconnect, chevrons |
| wallet dropdown | 51,710 | 20,218 | 47,841 | 3,469 | account dropdown (switch / disconnect), dedupe injected wallet |
| any chain | 53,698 | 20,959 | 49,465 | 3,857 | runtime contract probing, popover, chain labels |
| tabs + builder | 74,212 | 27,773 | 64,938 | 8,266 | Safe page tabs, ABI encoder + transaction builder |
| home + labels | 103,493 | 38,152 | 86,289 | 16,149 | saved Safes with folders/drag and drop, Settings, labels |
| backup & sync | 110,535 | 40,358 | 92,573 | 16,907 | export link/JSON/file, import preview + merge/replace |
| UI redesigns | 132,069 | — | — | — | wallet gates, Home (search-or-open, tree), Safe page polish, breadcrumb switcher, review next-step cards |
| call signatures | 134,917 | — | — | — | ABI decoder + byte-exact matcher, signature section in #tx= links |
| messages | 148,343 | 51,363 | 119,790 | 27,452 | EIP-191 / EIP-712 hashing, SafeMessage signing, #msg= links, message review |
| WalletConnect, both sides | 188,410 | 66,072 | 157,937 | 29,244 | wallet side (Dapps tab), dapp side (owner wallets by QR), ChaCha20-Poly1305, QR encoder |
| tidy + roles.wei readiness | 186,376 | 65,825 | 156,609 | 28,538 | shared storage helper, dead code removed; simulation inside the Safe, module identification, bytes32 text, ?chain= |
| deployModule decoding | 188,990 | — | — | — | Zodiac ModuleProxyFactory decode, CREATE2 prediction, setUp owner/avatar/target, batch enable check |
| links, Settings, roles.wei | 196,599 | 69,349 | 165,347 | 29,913 | account names, RPC endpoints and the roles.wei gateway in Settings, Open in / Set up Zodiac Roles links, custom and new prefills, config-chunk links |
| hide tokens | 197,553 | 69,714 | 166,204 | 29,985 | per-Safe hidden tokens in Assets (eye on the row, Show / Hide them under the table) |
| saved calls | 200,443 | — | — | — | Save… on a method card, Saved calls in Custom (Review, Add to batch, Edit, delete), in backups |
| Etherscan key, scan progress | 204,319 | — | — | — | optional Etherscan key in Settings (logs from its index, each block checked against the chain), progress and a tip while scanning block by block |
| transaction history | 208,658 | — | — | — | executed transactions kept and found onchain (ExecutionSuccess, execTransaction decoded and hash-checked), Review again, Add to batch |
| Redo, save from History | 209,581 | — | — | — | History rows: Redo, Save… (a batch as a whole) into Saved calls |

The page is now about 204 KB (208,658 bytes): under the 300 KB limit (307,200 bytes), with about 96 KB left. Each extra 24,575-byte chunk adds roughly 5M gas to the deploy. Recent growth: WalletConnect (about 25 KB with its crypto and the QR encoder), message signing, the ABI decoder. Onchain it takes 9 chunks of up to 24,575 bytes plus the config chunk (~44M gas, docs/deploy.md → Cost).

## Major contributors

- `src/keccak.js` (~1.1 KB min): Keccak-256; replaces `@noble/hashes` / `ox`.
- `src/share.js` (~2.5 KB min): compact payload, link fragment, JSON import with validation.
- `src/abi.js` (~1.9 KB min): hex, ABI encode/decode, checksum, amount parse/format.

## Avoided

- secp256k1 (e.g. `@noble/curves`, ~20 KB+): signer recovery uses the chain's `ecrecover` precompile via `eth_call`.

## Rejected

- `ox` (tree-shaken): 54 KB min for the same primitives. See docs/research.md.
