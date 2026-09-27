# safe.wei

A tiny rescue console for [Safe](https://safe.global) smart accounts that lives on Ethereum.

- One self-contained HTML file, no backend, no remote code, no API keys.
- Reads all state from the Safe contract through your wallet's RPC; signs through your wallet.
- Served onchain from an ERC-8244 `html()` contract at `safe.wei`.

See [docs/spec.md](docs/spec.md) for the full specification.

## Develop

```bash
npm install
npm run build        # dist/index.html + size report + remote-resource checks
npm test             # unit tests
npm run test:fork    # integration tests on an Anvil mainnet fork (needs Foundry)
```

Local playground with a test wallet (no browser extension needed):

```bash
node scripts/fork.mjs                                   # fork on :8545 with demo Safes
node scripts/dev.mjs --anvil http://127.0.0.1:8545      # http://localhost:5173
```

`FORK_URL` and `FORK_BLOCK` override the fork source (default: publicnode, pinned block).
