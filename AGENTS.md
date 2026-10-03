# Working rules for agents (safe.wei)

Read this before changing anything. It applies to every agent and every change.

## Git

- Commit with `git -c commit.gpgsign=false commit …`. **Never add Claude, a co-author or any attribution trailer** to commits or PR descriptions, whatever a tool's default says.
- One branch and one PR per feature or fix; merge it (`gh pr merge --merge --delete-branch`) and pull `main` before starting the next. Never push to `main` directly.

## Frozen formats (do not break)

Other apps and already-shared links depend on these. They are specified in [docs/links.md](docs/links.md) → Stability and pinned by golden vectors in `test/unit/links.test.mjs`:

- `#tx=` share links and the `compact` payload (also stored **onchain forever** in published `approveHash` calldata), including the call-signature section: `src/share.js`
- `#msg=` message links: `src/share.js`
- `#import=` backup links and their JSON: `src/backup.js`
- the routes and prefill parameters (`#/<safe>/send?to&amount&token`, `#/<safe>/batch?csv`): `route()` and the send forms in `src/app.js`
- the transaction JSON (Copy as JSON)

Extend only with optional additions (a new flag bit plus an appended section, a new parameter, a new JSON key). If a golden vector fails, fix the code, never the vector.

## Principles

- One self-contained HTML file: no backend, no remote resources (the build fails on them), no API keys of its own (only ones you add), no analytics. Size budget: good < 100 KB, hard limit 300 KB raw (`npm run build` prints it; keep `docs/size.md` current).
- Reads only through the connected wallet's RPC; the wallet signs. Three exceptions: a wallet connected with WalletConnect cannot serve reads, so those go to WalletConnect's RPC (docs/spec.md §27d); an RPC endpoint you add yourself in ▾ → Settings takes the reads on its chain (§27e); and with an Etherscan key you add there, event logs come from Etherscan's index, each block checked against the chain (§27f). Nothing else is contacted.
- Nothing is signed unless the locally computed hash equals the Safe's own (`getTransactionHash`, `getMessageHash`). Decode only exact, canonical encodings; never guess.
- Addresses show short for browsing and **in full wherever something is signed** (`.fulladdr`).
- The UI conventions are described in `~/Code/roles/DESIGN.md` (derived from this app); follow them.

## Verifying a change

1. `npm run build` and `npm test`; `npm run test:fork` when touching protocol code (`safe.js`, `flow.js`, `share.js`, `message.js`, `review.js`, `pending.js`).
2. Check it in the browser: `node scripts/fork.mjs` and `node scripts/dev.mjs --anvil http://127.0.0.1:8545` (the Anvil test wallet; `?acct=N` picks the account). Try the real states (owner, non-owner, not connected, your own or a WalletConnect wallet via `--port N` without `--anvil`, phone width), and type into inputs for real.
3. Update the docs with the change: `docs/guide.md` (behavior), `docs/links.md` (links), `docs/spec.md` (design), `README.md` (overview).

## Deploying

Mainnet deploys and pointing `safe.wei` are done by the owner. Agents rehearse on a fork (`docs/deploy.md`) and hand over exact steps.
