# Deploying safe.wei

The app is one HTML file served by an immutable ERC-8244 contract (`contract/SafeWeiApp.sol`). The page is stored as the runtime code of SSTORE2-style data contracts (`0x00` STOP byte + up to 24,575 bytes each). `html()` reassembles them with `extcodecopy`. `request()` / `resolveMode() == "5219"` serve the same page to ERC-4804 web3:// gateways.

All contracts go through the canonical CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, so every address depends only on the page bytes, the compiled bytecode and the salt, never on who deploys or the deployer's nonce.

## Build ID

The build embeds a short ID, `git rev-parse --short=7 HEAD:src`: the tree hash of `src/`, with a `+` when `src/` has uncommitted changes (never deploy those). It changes only when the code does, so the same ID always builds to the same bytes and therefore the same chunk and app addresses: anyone can check out a commit with that `src/` tree, run `npm run build`, and get the deployed app's address.

The footer shows the build ID and, at runtime, the app contract serving the page: from the gateway's hostname when it starts with the address (`0x<address>.<gateway>`), or by resolving the `.wei` / `.eth` name it starts with (`safe.wei.<gateway>` → `safe.wei`) onchain when the wallet is on Ethereum. No gateway hostname is hardcoded: any gateway that follows either pattern works. The page cannot embed its own address, since that address is derived from the page's bytes.

## Replacing the WalletConnect project ID

The WalletConnect project ID (`config/walletconnect.json`) and the links to roles.wei and the source code (`config/links.json`: roles.wei's gateways, behind "Open in roles.wei" next to a Roles modifier in Settings and the footer link, and the Source link) are built into their own tiny first chunk: the page's head up to the `<!--config-->` marker, about 300 bytes. Everything after the marker is in chunks 1…8. Changing either therefore changes only chunk 0 and, since the app contract lists its chunks, the app contract; chunks 1…8 keep their addresses and are reused. `test/unit/deployplan.test.mjs` pins this, and it was checked on the real build (a different ID changed only chunk 0 and the app). The config is outside `src/`, so the build ID in the footer stays the same.

When: the relay refuses the ID (WalletConnect bans it, or the project is deleted). Users see "the project ID was not accepted" when connecting. Until a new deployment is live, anyone can paste their own ID in the Dapps tab (WalletConnect project), and it applies to both directions of WalletConnect.

**The catch: build from the deployed code.** Chunks 1…8 are reused only if everything after the marker is byte-for-byte what was deployed, i.e. the same `src/` tree. If `main` has moved on since the deploy, rebuilding from `main` changes every chunk and becomes a full deploy (~42M gas). So start from the commit that was deployed (the `deployed-<n>` tag from the deploy steps below; `deploy/1.json` also records the chunks and `contentHash`).

To change those links instead, edit `config/links.json` in step 2 (`roles`: https gateway URLs ending in `/`, the one on the same gateway family as the page is used; `source`: an https URL).

Steps:

1. Create a new project on the WalletConnect (Reown) dashboard and copy its project ID. If it restricts domains, allow the gateway you use and `safe.caza.la`.
2. Check out the deployed code in a separate worktree, and put the new ID there:
   ```bash
   git worktree add ../safe-deployed <deployed tag or commit>
   cd ../safe-deployed && npm ci
   echo '{ "projectId": "<new id>" }' > config/walletconnect.json
   npm run build
   ```
3. Check the plan before sending anything: start the deployer (`node scripts/deployer/serve.mjs`) and connect a wallet on Ethereum. Chunks 1…8 must show as already deployed, and only chunk 0 and SafeWeiApp as to be deployed (about 60k + 590k gas). If more steps appear, the build does not match the deployed code: stop and find the right commit.
4. Deploy (the deployer's Deploy button, or `PRIVATE_KEY=0x… node scripts/deploy.mjs --rpc <mainnet rpc>`), then point `safe.wei` at the new app contract with `setAddr` (~50k gas; `node scripts/name.mjs --rpc <rpc> --app <new app>`).
5. Commit the new `config/walletconnect.json` and `deploy/1.json` in the worktree and tag that commit (`deployed-<n+1>`), then bring the new ID to `main` too (safe.caza.la picks it up on the next CI deploy).

Total: roughly 0.7M gas instead of a full deploy (~42M).

## Vanity address

The app contract's address starts with five zero hex digits (`0x00000…`, `VANITY` in `scripts/deploy-lib.mjs`). The chunks use the plain salt (all zeros by default); the app gets its own salt, mined by counting from 0 until its CREATE2 address has those leading zeros. That takes about a million tries on average, a few seconds. The mining is deterministic (the same build always gives the same salt), so `scripts/deploy.mjs` and the deployer page plan the same address independently, and the chunks keep their addresses (and are reused) whatever the app's salt is. Every change to the app contract (any rebuild, including a config-only one) changes its address, and the new one is mined the same way. `deploy/<chainId>.json` records both salts (`salt`, `appSalt`). `--no-vanity` uses the plain salt for the app too.

## Cost

Measured on a mainnet fork (`test/fork/deploy.test.mjs`, which prints it) for the current build (186,376 B: the config chunk plus 8 chunks of up to 24,575 B, and SafeWeiApp with a 2,004 B runtime): **41,766,553 gas** in 10 transactions.

Roughly 220 gas per page byte (200 code deposit + calldata). At 0.3 gwei that is ~0.0125 ETH; a full chunk is ~5.4M gas. Every transaction stays far below EIP-7825's 16,777,216 per-transaction gas cap; the script pins 15,000,000 so wallet estimation padding cannot push a chunk over it.

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
   The script is idempotent: re-running it skips contracts that already exist. It finishes by comparing `html()` with `dist/index.html` and writes `deploy/1.json` (address, chunks, `contentHash`, runtime `codeHash`, gas). Commit that file, and tag the deployed commit so it can be rebuilt byte for byte later (e.g. to replace the WalletConnect project ID, above):
   ```bash
   git tag deployed-1 && git push origin deployed-1
   ```
5. **Verify source** on Etherscan:
   ```bash
   forge verify-contract <app> contract/SafeWeiApp.sol:SafeWeiApp --chain mainnet \
     --constructor-args $(cast abi-encode "f(address[])" "[<config chunk>,<chunk1>,…,<chunk8>]") --etherscan-api-key <key>
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
- one run per PR: a new commit cancels the PR's run in progress, so the preview is always the latest commit; on `main`, runs queue and are never cancelled mid-deploy.

The site is the page plus a `_headers` file that refuses framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`); the app also refuses to run in a frame.

One-time setup (owner):

1. **API token**: Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token. Permissions: *Account · Cloudflare Pages · Edit*. Account resources: *Include · your account*. Create it and copy it.
2. **Account ID**: Cloudflare dashboard → Workers & Pages → the Account ID in the right column (or the id in the dashboard URL).
3. **GitHub secrets**: repository → Settings → Secrets and variables → Actions → New repository secret: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. The first CI run creates the Pages project `safe-wei` (production branch `main`).
5. **Domain**: Workers & Pages → safe-wei → Custom domains → Set up a custom domain → `safe.caza.la`. Since `caza.la` is on Cloudflare, it adds the DNS record and the certificate.
6. If the WalletConnect project restricts domains (dashboard → project → allowed domains), add `safe.caza.la` and `*.safe-wei.pages.dev`.
