# Size report

Budget (spec §19): ideal < 50 KB, good < 100 KB, acceptable < 200 KB raw. `npm run build` prints the numbers and fails above 200 KB.

| Phase | raw | gzip | js | css | notes |
| --- | --- | --- | --- | --- | --- |
| 0 spike | 4,186 | 2,408 | 3,389 | 475 | keccak + ABI helpers + Safe reads |
| 1 read-only | 8,864 | 4,491 | 6,448 | 2,085 | UI shell, routing, Safe view, dark mode |

## Major contributors

- `src/keccak.js` (~1.1 KB min): Keccak-256; replaces `@noble/hashes` / `ox`.
- `src/abi.js` (~1.9 KB min): hex, ABI encode/decode, checksum, amount parse/format.

## Rejected

- `ox` (tree-shaken): 54 KB min for the same primitives. See docs/research.md.
