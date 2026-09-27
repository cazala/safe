# Deploying safe.wei

The app is one HTML file served by an immutable ERC-8244 contract (`contract/SafeWeiApp.sol`). The page is stored as the runtime code of SSTORE2-style data contracts (`0x00` STOP byte + up to 24,575 bytes each). `html()` reassembles them with `extcodecopy`. `request()` / `resolveMode() == "5219"` serve the same page to ERC-4804 web3:// gateways.

All contracts go through the canonical CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, so every address depends only on the page bytes, the compiled bytecode and the salt, never on who deploys or the deployer's nonce.

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
