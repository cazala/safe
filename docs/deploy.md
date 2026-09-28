# Deploying safe.wei

The app is one HTML file served by an immutable ERC-8244 contract (`contract/SafeWeiApp.sol`). The page is stored as the runtime code of SSTORE2-style data contracts (`0x00` STOP byte + up to 24,575 bytes each). `html()` reassembles them with `extcodecopy`. `request()` / `resolveMode() == "5219"` serve the same page to ERC-4804 web3:// gateways.

All contracts go through the canonical CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, so every address depends only on the page bytes, the compiled bytecode and the salt, never on who deploys or the deployer's nonce.

## Build ID

The build embeds a short ID, `git rev-parse --short=7 HEAD:src`: the tree hash of `src/`, with a `+` when `src/` has uncommitted changes (never deploy those). It changes only when the code does, so the same ID always builds to the same bytes and therefore the same chunk and app addresses: anyone can check out a commit with that `src/` tree, run `npm run build`, and get the deployed app's address.

The footer shows the build ID and, at runtime, the app contract serving the page: from the gateway's hostname when it starts with the address (`0x<address>.<gateway>`), or by resolving the `.wei` / `.eth` name it starts with (`safe.wei.<gateway>` → `safe.wei`) onchain when the wallet is on Ethereum. No gateway hostname is hardcoded: any gateway that follows either pattern works. The page cannot embed its own address, since that address is derived from the page's bytes.

## Replacing the WalletConnect project ID

The project ID lives in `config/walletconnect.json` (outside `src/`, so it does not change the build ID) and is built into a tiny first chunk, cut at the `<!--config-->` marker. If the ID is ever banned:

1. Put the new ID in `config/walletconnect.json` and commit it.
2. Run the deployer as usual. Chunks 1… already exist onchain and are skipped: only the new head chunk (~60k gas) and the new app contract (~590k gas) are deployed.
3. Point `safe.wei` at the new app contract (`setAddr`, ~50k gas).

Roughly 0.7M gas instead of a full deploy (~35M). Meanwhile, users can paste their own project ID in the app.

## Cost

Measured on a mainnet fork (`test/fork/deploy.test.mjs`) for the Phase 7 build (31,419 B, 2 chunks):

| Step | Gas |
| --- | --- |
| chunk 0 (24,575 B) | 5,379,458 |
| chunk 1 (6,844 B) | 1,536,366 |
| SafeWeiApp (2,004 B runtime) | 588,429 |
| **Total** | **7,504,253** |

Roughly 220 gas per page byte (200 code deposit + calldata). At 0.3 gwei that is ~0.0023 ETH. Every transaction stays far below EIP-7825's 16,777,216 per-transaction gas cap; the script pins 15,000,000 so wallet estimation padding cannot push a chunk over it.

## Steps (spec §14)

Do not skip ahead: pointing `safe.wei` is the only step that changes what users load, and it should happen only after everything else is verified.

1. **Build and test.**
   ```bash
   npm ci && npm run test:all
   ```
2. **Rehearse on a fork.** Deploys, verifies `html()` byte for byte, and writes `deploy/local-1.json` (gitignored).
   ```bash
   node scripts/fork.mjs &
   node scripts/deploy.mjs --rpc http://127.0.0.1:8545 --from 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
   node scripts/dev.mjs --anvil http://127.0.0.1:8545 --onchain <app>   # operate the app served from html()
   ```
3. **Print the plan for mainnet** (addresses + exact calldata, nothing is sent):
   ```bash
   node scripts/deploy.mjs --rpc <mainnet rpc> --plan
   ```
   Each step is a plain transaction to the CREATE2 deployer, so it can be sent from any wallet, including from a Safe through safe.wei itself (a CALL to the deployer with that calldata).
   **Or use the LAN deployer page** when the deploying wallet is on another computer:
   ```bash
   node scripts/deployer/serve.mjs          # prints http://<lan-ip>:8080/
   ```
   It rebuilds `dist/index.html`, embeds the exact plan, and deploys from the browser wallet with one button: missing steps only, gas pinned under the EIP-7825 cap, then `html()` verified against `contentHash`. It prints the `setAddr` transaction for the name owner and the `deploy/<chainId>.json` record to commit. Rehearse with `--anvil http://127.0.0.1:8545` (test wallet on a fork) or on Sepolia (same addresses).
4. **Deploy to mainnet** with a funded key (or send the planned transactions by hand):
   ```bash
   PRIVATE_KEY=0x… node scripts/deploy.mjs --rpc <mainnet rpc>
   ```
   The script is idempotent: re-running it skips contracts that already exist. It finishes by comparing `html()` with `dist/index.html` and writes `deploy/1.json` (address, chunks, `contentHash`, runtime `codeHash`, gas). Commit that file.
5. **Verify source** on Etherscan:
   ```bash
   forge verify-contract <app> contract/SafeWeiApp.sol:SafeWeiApp --chain mainnet \
     --constructor-args $(cast abi-encode "f(address[])" "[<chunk0>,<chunk1>]") --etherscan-api-key <key>
   ```
6. **Test `html()` directly** (no gateway):
   ```bash
   cast call <app> "html()(string)" --rpc-url <rpc> > safe.wei.html
   cast keccak "$(cat safe.wei.html)"   # equals contentHash() and deploy/1.json
   ```
7. **Test through gateways:** `https://<app>.w4eth.io/` (ERC-8244) and `https://<app>.1.w3link.io/` (ERC-5219). Connect a wallet, open a Safe, and run a small transaction end to end.
8. **Point `safe.wei`** at the app. A `.wei` name serves the `html()` of the address it resolves to (the way `dao.wei.limo` and `zswap.wei.limo` work), so pointing is one `setAddr` from the name owner. The helper is read-only; it prints the owner, the current resolution and the exact transaction:
   ```bash
   node scripts/name.mjs --rpc <mainnet rpc> --app <app>
   ```
   As of 2026-09-27, `safe.wei` (tokenId `0x5ee9ac06…c938c62d`) is owned by `0x3107af70f278d3824f9bab4222b3361a545356c2` and resolves to that same address. Send the printed `setAddr(uint256,address)` from that wallet. This was rehearsed on a mainnet fork by impersonating the owner.
9. **Verify resolution:** re-run `node scripts/name.mjs --rpc <rpc> --app <app>` (it must say "already points at the app" and "html() matches"), then open `https://safe.wei.limo/` and run a small transaction.
10. **Record** the deployment address, `contentHash` and runtime `codeHash` in the README.

## Using safe.wei without any gateway or DNS

Everything needed is the contract address and any Ethereum RPC:

```bash
cast call <app> "html()(string)" --rpc-url <rpc> > safe.wei.html
cast keccak "$(cat safe.wei.html)"      # compare with the published contentHash
npx serve .                            # or: python3 -m http.server
```

Open it from `http://localhost:…`. Most wallets do not inject into `file://` pages, so serve the file locally rather than double-clicking it.

## Web hosting: Cloudflare Pages (safe.caza.la)

Besides the onchain deploy, the same `dist/index.html` is served at **https://safe.caza.la** by Cloudflare Pages, from CI (`.github/workflows/ci.yml`, job `deploy`, after the tests pass):

- every push to `main` deploys to production;
- every PR from this repository deploys a preview at `https://<branch>.safe-wei.pages.dev` and comments the URL on the PR (one comment, updated on each push).

The site is the page plus a `_headers` file that refuses framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`); the app also refuses to run in a frame.

One-time setup (owner):

1. **API token**: Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token. Permissions: *Account · Cloudflare Pages · Edit*. Account resources: *Include · your account*. Create it and copy it.
2. **Account ID**: Cloudflare dashboard → Workers & Pages → the Account ID in the right column (or the id in the dashboard URL).
3. **GitHub secrets**: repository → Settings → Secrets and variables → Actions → New repository secret: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. The first CI run creates the Pages project `safe-wei` (production branch `main`).
5. **Domain**: Workers & Pages → safe-wei → Custom domains → Set up a custom domain → `safe.caza.la`. Since `caza.la` is on Cloudflare, it adds the DNS record and the certificate.
6. If the WalletConnect project restricts domains (dashboard → project → allowed domains), add `safe.caza.la` and `*.safe-wei.pages.dev`.
