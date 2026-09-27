# safe.wei

A tiny rescue console for [Safe](https://safe.global) smart accounts that lives on Ethereum.

- One self-contained HTML file, no backend, no remote code, no API keys.
- Reads all state from the Safe contract through your wallet's RPC; signs through your wallet.
- Served onchain from an ERC-8244 `html()` contract at `safe.wei`.

See [docs/spec.md](docs/spec.md) for the full specification.

## What it does

- Works on any EVM chain the wallet is on: open any Safe v1.3.0 / v1.4.1; create new v1.4.1 Safes and batch where the canonical contracts are deployed (checked on chain)
- Build transactions: ETH/ERC-20 sends, bulk sends, contract calls from an ABI (Etherscan-style builder with type helpers), raw calldata, MultiSend batches; every one shows its SafeTx hash verified against the Safe's own `getTransactionHash`
- Approve onchain (`approveHash`) or sign offchain (EIP-712); share by link; optionally publish the transaction onchain with the approval so other owners find it without a link
- ENS and `.wei` names wherever an address is accepted (onchain resolution only)
- Token balances from the zOrg TokenList; send ETH/tokens, or bulk-send many transfers from pasted CSV (`recipient,amount[,token]`)
- Deeplinks that prefill a send or a bulk send: `#/<safe>/send?to=…&amount=…&token=…`, `#/<safe>/batch?csv=…` (`<safe>` can be a name)

On mobile, use the in-app browser of a mobile wallet (safe.wei talks to the injected wallet; WalletConnect would need a relay server).

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

The dev server adds an "Anvil test wallet (dev)" to the wallet picker (EIP-6963). If a wallet extension is installed, choose the test wallet under Connect: the extension talks to real mainnet, where the demo Safes do not exist. `?acct=N` picks the Anvil account.

`FORK_URL` and `FORK_BLOCK` override the fork source (default: publicnode mainnet, pinned block; `FORK_BLOCK=0` forks the latest block). Public RPCs keep little history on fast chains, so a long-lived fork of Polygon or an L2 needs an archive RPC in `FORK_URL`.

## Deploy

See [docs/deploy.md](docs/deploy.md): deterministic CREATE2 deployment of the ERC-8244 contract, verification, gateway tests and pointing `safe.wei`.

## Use it without a gateway

```bash
cast call <app> "html()(string)" --rpc-url <rpc> > safe.wei.html   # then serve it from localhost
```

## Deployments

Not yet deployed to mainnet.
