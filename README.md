# safe.wei

A minimal interface for [Safe](https://safe.global) multisig accounts that lives on Ethereum. Sibling app: **[roles.wei](https://github.com/cazala/roles)**, for Zodiac Roles permissions on a Safe.

- **One self-contained HTML file**: no backend, no remote code, no API keys of its own, no analytics.
- **Reads from the chain**: every Safe fact comes from the Safe contract itself, through your wallet's RPC (WalletConnect's RPC for a WalletConnect wallet, or your own RPC endpoint if you add one). No Safe Transaction Service, no indexer.
- **Signs through your wallet**: safe.wei never holds a key.
- **Served onchain** from an ERC-8244 `html()` contract at `safe.wei`, or from any copy of the file.
- **Agent ready**: everything starts from a link, so agents can propose transactions for people to review and sign. See [Agents](#agents).

## Features

**Safes**
- Open any Safe from v1.3.0 up by address or `.eth` / `.wei` name, on any EVM chain your wallet is on.
- Create new v1.5.0 Safes (v1.4.1 where 1.5.0 is not deployed), with a predicted address before deploying.
- Your Safes on Home: search or open, pin, rename, nested folders with drag and drop, and a switcher in the header.

**Transactions**
- Send the native coin or any ERC-20, to one recipient or to many from pasted CSV (up to 200 rows in one transaction).
- Call any contract from its ABI (Etherscan-style builder with unit, hex and hashing helpers), or send raw calldata.
- Manage owners, threshold, modules (Zodiac modules recognized) and guard.
- Batch any of the above into one atomic transaction (MultiSendCallOnly).

**Approvals**
- A review screen that says what the transaction does and what to do next, for owners and non-owners alike.
- Sign offchain for free (EIP-712), or approve onchain, optionally publishing the details so other owners find it without a link.
- Share by link (the transaction and its signatures travel in the URL fragment), merge signatures from several links, execute once the threshold is met.
- Transaction history: executed transactions, kept as you execute them and found onchain (each checked against its SafeTx hash); review one again or add its calls to the batch.
- Sign messages as the Safe (EIP-1271): text, EIP-712 typed data or a raw hash, with the owners' signatures combined and checked against the Safe's `isValidSignature`.
- Calls safe.wei cannot decode on its own are shown decoded when the link carries their function signatures, checked byte for byte against the calldata.
- Every transaction's hash is checked against the Safe's own `getTransactionHash`; calls are simulated and risky ones flagged.

**Zodiac Roles, with roles.wei**
- Settings → Modules recognizes a Roles modifier and opens it in roles.wei (**Open in roles.wei**), or, on a Safe without one, offers **Set up Zodiac Roles in roles.wei**, which opens its create wizard on this Safe.
- Permission changes made in roles.wei come back as a safe.wei link the owners review and sign like any transaction.

**Yours, in the browser**
- Address labels, remembered ABIs and added tokens, stored locally, and moved between devices with Backup & sync (roles.wei reads these backups too).
- **Settings**: your own RPC endpoints (reads on their chain go there; your wallet still signs), an optional Etherscan key (history searches in one request, each result checked against the chain) and which roles.wei gateway to link to.
- Links that open any screen or prefill a send, a CSV batch, any contract call or a new Safe ([docs/links.md](docs/links.md)).
- Use the Safe in other dapps through WalletConnect: requests go through the same review.
- Sign as an owner with a wallet on your phone: **Connect → WalletConnect** shows a QR code.

## Agents

[![skills.sh](https://skills.sh/b/cazala/safe)](https://skills.sh/cazala/safe)

Install the skill for your agent (Claude Code, Codex, Cursor and others) with the [skills](https://skills.sh) CLI: `npx skills add cazala/safe`, and its sibling with `npx skills add cazala/roles`.

safe.wei has no API: an agent builds a link, a person opens it, checks it and signs with their own wallet. Links only propose; safe.wei recomputes and checks everything it shows.

- **Skill**: [skills/safe-wei/SKILL.md](skills/safe-wei/SKILL.md) tells an agent which link fits which goal (send, pay many from CSV, any contract call, owners and threshold, create a Safe, collect signatures), how to build it, and what to tell the person before handing it over.
- **Links reference**: [docs/links.md](docs/links.md), with the frozen formats.
- **`#tx=` builder**: `node scripts/tx-link.mjs plan.json --rpc <url>` builds a shareable transaction link for one call or a batch, reading the nonce and refusing to print it unless its hash equals the Safe's own.
- For permissions on a Safe (a bot or agent allowed specific calls without the full threshold), use roles.wei and its skill, [skills/roles-wei](https://github.com/cazala/roles/tree/main/skills/roles-wei).

## Documentation

| Document | For |
| --- | --- |
| [User guide](docs/guide.md) | Every screen and feature, what is checked, what is stored, troubleshooting |
| [Links](docs/links.md) | URLs that open a screen, prefill a form or carry a transaction (integrations, agents) |
| [Specification](docs/spec.md) | Design, protocol details and security model |
| [Deploy](docs/deploy.md) | Deploying the ERC-8244 contract (vanity address, cost) and pointing `safe.wei` |
| [Research](docs/research.md) | Verified contract addresses and protocol references |
| [Size](docs/size.md) | Page size budget per feature |
| [Safe Apps](docs/safe-apps.md) | Why Safe Apps support was dropped |
| [AGENTS.md](AGENTS.md) | Rules for contributors and coding agents: git, frozen link formats, verification |

## Use it

- Open **https://safe.caza.la** (the same page, served by Cloudflare Pages from `main`; every PR gets a preview), or
- open `safe.wei` through an ERC-8244 gateway (`https://safe.wei.limo`, `https://safe.wei.is`), or
- read the page straight from the contract and serve it locally:

```bash
cast call <app> "html()(string)" --rpc-url <rpc> > safe.wei.html
```

Then open it on `localhost` (wallets need a secure origin). On a phone, open it in your wallet app's browser.

## Develop

```bash
npm install
npm run build        # dist/index.html + size report + remote-resource checks
npm test             # unit tests
npm run test:fork    # integration tests on an Anvil mainnet fork (needs Foundry)
```

A local playground with a test wallet (no browser extension needed):

```bash
node scripts/fork.mjs                                   # Anvil fork on :8545 with demo Safes
node scripts/dev.mjs --anvil http://127.0.0.1:8545      # http://localhost:5173
```

- The fork creates three demo Safes owned by the first three Anvil accounts (1-of-1 v1.4.1, 2-of-3 v1.4.1, 2-of-3 v1.3.0) and prints their addresses.
- The dev server adds an "Anvil test wallet (dev)" to the wallet picker (EIP-6963). If an extension is installed, pick the test wallet: the extension talks to real mainnet, where the demo Safes do not exist. `?acct=N` picks the Anvil account.
- It listens on the LAN too (it prints the addresses) and proxies the test wallet's RPC, so a phone on the same network can use the playground.
- `node scripts/dev.mjs --port N` serves without the test wallet, to use your own extension wallet or WalletConnect.
- `node scripts/wc-dapp.mjs` plays a dapp over the real WalletConnect relay (prints a `wc:` link to paste in the Dapps tab, then sends a signature and a transaction request). `node --test --test-force-exit 'test/net/*.test.mjs'` checks conformance against the official SDK, as the dapp and as the wallet (needs the network).
- `FORK_URL` and `FORK_BLOCK` change the fork source (default: publicnode mainnet at a pinned block; `FORK_BLOCK=0` forks the latest). Public RPCs keep little history on fast chains, so a long-lived fork of Polygon or an L2 needs an archive RPC.

## Deploy

See [docs/deploy.md](docs/deploy.md): deterministic CREATE2 deployment of the page and the ERC-8244 contract (the app's address is mined to start with `0x00000`), verification, gateway tests and pointing `safe.wei`. The WalletConnect project ID and the links to roles.wei and the source (`config/`) sit in a small first chunk, so changing them redeploys only that chunk and the app contract.

## Deployments

- Web: https://safe.caza.la, deployed from CI on every merge to `main` (docs/deploy.md → Web hosting).
- Onchain: not yet deployed to mainnet.

## License

[MIT](LICENSE)
