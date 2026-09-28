# safe.wei — Minimal Onchain Safe Interface

## Status

Implementation specification for an agent.

Repository target: `cazala/safe`

Primary deployment target: `safe.wei`

Primary delivery format: ERC-8244 `html()` contract-hosted application.

## 1. Goal

Build the smallest practical, backendless interface for creating and operating standard Safe smart accounts.

The application should follow the philosophy of small ERC-8244 applications such as zSwap and WeiDAO:

- self-contained
- no hosted backend
- no Safe Transaction Service
- no CDN
- no remote JS
- no remote CSS
- no analytics
- no API keys
- no external metadata service
- no framework unless a framework produces a materially smaller artifact than vanilla code
- all critical state read directly from chain
- all signing done through the user's EIP-1193 wallet
- final production artifact deployable fully onchain through ERC-8244

The product is not intended to replicate the full Safe Wallet UI.

It is an emergency-grade, censorship-resistant, minimal operator for Safe vaults.

The interface MUST remain usable if:

- `app.safe.global` disappears
- Safe Transaction Service is unavailable
- IPFS gateways are unavailable
- DNS is unavailable
- every project-specific backend is unavailable

The only required external dependency at runtime should be:

1. an Ethereum-compatible RPC supplied by the browser/wallet, and
2. an EIP-1193 wallet/provider for signing and sending transactions.

---

## 2. Product philosophy

The order of priorities is:

1. correctness
2. verifiability
3. minimal byte size
4. independence from infrastructure
5. understandable transaction signing
6. aesthetics

Do not add a feature merely because Safe Wallet has it.

Every dependency and every feature must justify its byte cost.

The desired mental model is:

> "A tiny rescue console for Safe that lives on Ethereum."

The UI should expose protocol primitives clearly instead of hiding them behind large abstractions.

---

## 3. Reference implementations

Do not reinvent Safe transaction logic unnecessarily.

Research and reuse concepts/code where licensing permits from:

### 3.1 picosafe

Repository:

`https://github.com/volga-sh/picosafe`

This is the preferred reference for Safe protocol operations.

Relevant functionality:

- Safe v1.4.1 deployment
- Safe contract addresses
- EIP-1193 interaction
- account state
- transaction building
- EIP-712 Safe transaction signing
- Safe signature encoding
- `execTransaction`
- owner management
- MultiSend support

Important:

Do NOT blindly bundle the full library.

Inspect the code and extract or tree-shake only the minimal subset needed by this project.

For MVP the likely useful pieces are:

- Safe ABI fragments
- Safe Proxy Factory ABI fragments
- Safe v1.4.1 canonical addresses
- CREATE2 / deployment helpers
- `getOwners`
- `getThreshold`
- `nonce`
- `getTransactionHash`
- `approveHash`
- `approvedHashes`
- EIP-712 SafeTx encoding
- ECDSA signature handling
- prevalidated signature handling
- `execTransaction`

Avoid bundling:

- modules
- guards
- fallback handlers
- full signature validation helpers
- testing helpers
- batch support unless later justified

### 3.2 dSAFE

Repository:

`https://github.com/flotob/dSAFE`

Use as a SECURITY AND UX REFERENCE, not necessarily as copyable source.

Useful ideas:

- recompute SafeTx hash locally
- compare against Safe's onchain `getTransactionHash`
- refuse signing if hashes differ
- clearly display:
  - Safe address
  - chain ID
  - nonce
  - destination
  - value
  - operation
  - calldata
  - SafeTx hash
- highlight dangerous delegatecalls
- highlight suspicious/unlimited ERC-20 approvals when decoding exists

Do not copy its Vue/Swarm architecture into this project.

### 3.3 zSwap / WeiDAO / wei-names

References:

- `https://github.com/z-fi/zFi`
- `https://github.com/z0r0z/wei-names`

Use these as references for ERC-8244 packaging and onchain frontend construction.

Relevant ideas:

- `html()` returning a fully self-contained document
- SSTORE2/data-contract chunking if necessary
- no remote resources
- tiny inline CSS/JS
- deterministic deployment tooling
- gateway compatibility such as `w4eth.io`
- `.wei` resolution

---

## 4. MVP scope

MVP should support two main flows:

### 4.1 Create Safe

Inputs:

- owner addresses
- threshold
- optional salt nonce if required by deployment helper

Output:

- predicted Safe address
- deployment transaction
- confirmed Safe address

Target Safe version for creation: the latest canonical release deployed on the chain, currently v1.5.0 (falling back to v1.4.1 where 1.5.0 is not deployed).

Use canonical Safe singleton/proxy factory deployments for supported chains.

Always set the canonical `CompatibilityFallbackHandler` in `setup(...)`, matching Safes created by Safe Wallet. It is required for EIP-1271.

Predict the Safe address by simulating `createProxyWithNonce(...)` with `eth_call` rather than shipping proxy creation bytecode and CREATE2 code. After deployment, confirm the deployed address equals the prediction.

Do not deploy custom Safe implementations.

Chain support: any EVM chain the wallet is connected to.

- Opening, approving, signing and executing need nothing but the Safe itself, so they work everywhere.
- Features that need other contracts are enabled only when those contracts have code on the connected chain, probed with `eth_getCode` on connection: creating Safes (canonical v1.4.1 singleton, proxy factory, fallback handler), batches (MultiSendCallOnly), batched balance reads (Multicall3, with a per-call fallback).
- New Safes use `Safe` on Ethereum mainnet and `SafeL2` elsewhere, as Safe Wallet does.
- A small table maps well-known chain IDs to display names and native symbols; unknown chains show as "Chain <id>". No chain registry is shipped.
- Name resolution and the TokenList are mainnet registries; on other chains, names show a clear error and tokens are added by address.
- A DELEGATECALL to an address without code is a blocking error: the Safe would do nothing and still consume the nonce.

### 4.2 Open existing Safe

Input:

- Safe address

Read directly from chain:

- code existence
- Safe version via `VERSION()`
- owners
- threshold
- nonce
- ETH balance
- optionally fallback handler / guard only if nearly free in byte size

At minimum display:

- address
- connected chain
- owners
- threshold
- nonce
- native balance

---

## 5. Transaction flow

MVP MUST support arbitrary Safe calls.

Inputs:

- `to`
- `value`
- `data`
- `operation`

MVP operation default:

- CALL only

Delegatecall should either:

- be hidden behind an "advanced / dangerous" control, or
- be omitted completely in v1

If delegatecall support exists, display a strong warning.

Exception (post-MVP, §26): delegatecall to the hardcoded canonical `MultiSendCallOnly` address is the standard batching mechanism. It is allowed without the advanced control, but every inner call must be decoded and displayed individually. Delegatecall to any other address keeps the full warning.

Signed Safe transaction fields should default to:

- `safeTxGas = 0`
- `baseGas = 0`
- `gasPrice = 0`
- `gasToken = address(0)`
- `refundReceiver = address(0)`

This intentionally disables Safe's gas refund mechanism in the minimal flow.

The transaction object must include:

- Safe address
- chain ID
- to
- value
- data
- operation
- safeTxGas
- baseGas
- gasPrice
- gasToken
- refundReceiver
- nonce

---

## 6. Transaction hash verification

This is a hard requirement.

Before a user signs or approves a Safe transaction:

1. Compute the SafeTx hash locally.
2. Query the Safe contract's `getTransactionHash(...)`.
3. Compare both hashes.
4. If they differ:
   - display both
   - disable signing
   - disable approval
   - disable execution
   - show a fatal error

This protects against frontend encoding mistakes and makes signing behavior auditable.

It does NOT protect against a malicious RPC: both the Safe state and the `getTransactionHash` result come through the wallet's RPC. The local hash computation and the displayed transaction summary are the real protection. Hardware wallets that display the EIP-712 hash give an independent check.

The UI must display the final SafeTx hash prominently.

---

## 7. Signature / approval modes

The system should support two coordination modes.

### 7.1 Mode A — Onchain approvals

This should be the FIRST implementation because it minimizes coordination logic.

Each owner calls:

`approveHash(bytes32 safeTxHash)`

Then the app reads approval state from the Safe.

Once enough owners have approved:

- construct Safe prevalidated signatures
- sort signatures by signer address
- call `execTransaction(...)`

The executing owner does NOT need to call `approveHash` first. Safe's `checkNSignatures` accepts a v=1 signature for an owner when `msg.sender == owner`. The executor therefore adds its own prevalidated signature and executes in a single transaction. A 1-of-1 Safe executes with exactly one transaction. The final approver of an n-of-m Safe should be offered "Approve and execute".

Prevalidated Safe signature format:

- `r` = owner address left-padded to 32 bytes
- `s` = 0
- `v` = 1

Advantages:

- no backend
- no transaction service
- no signature sharing
- no IPFS/Swarm
- approvals are discoverable directly from chain
- easiest possible recovery UX

Tradeoffs:

- every non-executing signer pays gas for `approveHash`
- approvals alone do NOT reveal what is being approved: `approveHash` and the `ApproveHash` event carry only the hash. Other owners need the transaction contents, see §7.3.

This is acceptable for MVP.

The UI should clearly call this:

"Onchain approval"

### 7.2 Mode B — Offchain EIP-712 signatures

Implement after Mode A works.

Use:

`eth_signTypedData_v4`

The app should produce a compact shareable representation containing:

- chainId
- Safe address
- nonce
- transaction fields
- signer
- signature

Do NOT require a server.

Initially support:

- copy/paste JSON
- copy/paste compact encoded payload
- optionally URL fragment encoding if sufficiently small and safe

The app should:

- import multiple signatures
- validate signer is an owner
- deduplicate signatures
- sort signatures correctly
- build Safe signature bytes
- execute when threshold is met

The chain remains the source of truth.

Do not build decentralized messaging/storage in MVP.

### 7.3 Transaction sharing

A Safe transaction is identified by its SafeTx hash. Another owner can only approve or sign it if they can reconstruct every field that produces that hash. Sharing the transaction itself is therefore required for ANY multi-owner flow, including Mode A. It ships in Phase 3, not Phase 5.

The transaction payload contains:

- chainId
- Safe address
- to, value, data, operation
- safeTxGas, baseGas, gasPrice, gasToken, refundReceiver
- nonce
- optionally: offchain signatures collected so far (Mode B)

A payload is ALWAYS untrusted input. On import the app must:

1. recompute the SafeTx hash locally
2. verify it against `getTransactionHash` (§6)
3. check the nonce against the Safe's current nonce
4. display the full transaction summary before any action

A tampered payload simply produces a different hash and a different summary. The sharing channel never needs to be trusted.

#### Layer 1 — offchain payload (default)

- URL fragment: `#tx=<base64url(payload)>`. A fragment is never sent to a server.
- copy/paste JSON

Owners exchange it over any channel they like.

#### Layer 2 — onchain payload in `approveHash` calldata (optional)

Solidity ignores calldata bytes past the ABI-encoded arguments. The proposing owner may send:

`approveHash(safeTxHash) ‖ encodedPayload`

The Safe only reads the hash. The payload is stored permanently in that transaction's input, with no extra contract.

The onchain payload uses a compact binary encoding, not the Layer 1 JSON. Fields the transaction already carries are omitted: chainId (the transaction's chain), Safe address (the transaction's `to`), and the SafeTx hash (the `approveHash` argument).

```text
magic      2 bytes   0x5357 ("SW")
version    1 byte    0x01
flags      1 byte    bit0 = DELEGATECALL, bit1 = non-default gas fields present
to         20 bytes
nonce      uint      1-byte length + big-endian bytes (no leading zeros)
value      uint      same
data       3-byte big-endian length + bytes
if bit1:   safeTxGas, baseGas, gasPrice as uint; gasToken 20 bytes; refundReceiver 20 bytes
```

Cost is roughly 16 gas per non-zero calldata byte: about 1k gas extra for an ETH send, about 2k for an ERC-20 transfer, versus ~47k for the `approveHash` itself. Only the proposer pays it. The UI offers it as a checkbox on the proposer's approval, showing the extra byte count. Layer 1 remains the default.

Discovery ("pending transactions" for a Safe):

1. `eth_getLogs` for `ApproveHash` on the Safe address, scanning backwards in bounded block windows because wallet RPCs cap log ranges
2. `eth_getTransactionByHash` for each log to read its input
3. decode the trailing payload
4. accept a payload only if its recomputed hash equals the approved hash AND its nonce is not below the Safe's current nonce (payloads above it are listed as queued)

If the RPC refuses log ranges even at small windows, show what was found so far and let the user continue scanning older blocks.

Constraints:

- must be tested against both Safe v1.3.0 and v1.4.1 (trailing calldata accepted, approval recorded)
- owners that are smart contract wallets may not be able to append calldata; Layer 1 remains available
- the extra calldata costs gas (16 gas per non-zero byte)

---

## 8. Execution

Once threshold is satisfied:

call:

`execTransaction(...)`

Before sending execution transaction:

- re-read Safe nonce
- confirm it still equals the transaction nonce
- re-read owners and threshold if cheap
- recompute / verify SafeTx hash again
- verify enough valid approvals/signatures exist

Before proposing, approving, or executing, simulate the inner call with `eth_call({from: safe, to, value, data})`:

- a revert must be displayed prominently
- for recognized ERC-20 `transfer`/`transferFrom`/`approve`, a `false` return value must be displayed prominently. Some tokens return `false` without reverting, and the Safe would report `ExecutionSuccess` even though nothing moved.

This is a warning, not a hard block: state may change between simulation and execution.

If nonce changed:

- stop execution
- explain that another Safe transaction executed first
- require rebuilding the transaction

---

## 9. Minimal transaction decoding

Raw calldata support is mandatory.

Human-readable decoding is optional but strongly desirable where cheap.

MVP decoder can recognize a tiny set of common selectors:

- ERC-20 `transfer(address,uint256)`
- ERC-20 `approve(address,uint256)`
- ERC-20 `transferFrom(address,address,uint256)`
- Safe owner management functions
- Safe threshold change
- module enable/disable if trivial

Do NOT ship a generic ABI database.

For unknown calldata:

show raw:

- selector
- calldata
- calldata byte length

For ERC-20 approve:

if amount == `type(uint256).max`, display:

"UNLIMITED APPROVAL"

For operation == DELEGATECALL:

display:

"DANGEROUS: DELEGATECALL"

These warnings should be visually obvious even in the minimal UI.

---

## 10. UI

Use vanilla HTML/CSS/JS unless testing proves another approach produces a smaller final artifact.

Preferred structure:

### Home

- logo/text: `safe.wei`
- current chain
- connect wallet
- Open Safe
- Create Safe

### Home

- Open a Safe (address or name), with Create as a secondary action in the same panel
- Your Safes: every opened Safe is saved in the browser. Drag to reorder (touch: long-press), drop one Safe onto another to make a folder (named "N safes" until renamed), onto a folder to move it in, onto the back bar to move it up. Folders nest, open with a short slide, and can be renamed or split back into their parent. Pinned Safes stay on top of their level. Pin, rename and remove (with undo) per Safe.

### Safe page

Modeled on how Safe Wallet and wallet UIs split the same content (identity, assets, activity, settings), using tabs instead of a sidebar.

Safe header (always visible):

- back to Home
- title: the name the Safe was opened by (`treasury.wei`), else its reverse name, else "Safe 0x1234…abcd"
- full address with copy
- chips: chain, "M of N owners", version, native balance, whether the connected wallet is an owner
- banners for an unsupported version or a guard

The app brand is a distinct logo mark in the top bar, so it cannot be mistaken for a Safe named `safe.wei`.

Tabs (each has its own URL, so Back and links work):

- **Assets** (default): balances with a Send action per asset; add a token by address; a callout when pending transactions exist
- **Send**: one recipient (asset picker, recipient, amount, Max) or Many (CSV)
- **Transactions**: the review in progress, pending transactions found onchain (count badge on the tab), import a shared link
- **Custom**: transaction builder in the style of Etherscan's Write Contract. Pick a contract and an ABI (built-in ERC-20 / ERC-721 / ERC-1155 / WETH / this Safe, pasted JSON or human-readable signatures, or an uploaded `.json` artifact; remembered per contract in the browser), then fill a write method's typed inputs and Review or Add to batch. Helpers by type: unit multiplier for integers (×10^6/8/9/18/custom, defaulting to the token's decimals), max for uints, keccak256(text) and text→hex for bytes, JSON for arrays and tuples, and prevOwner/prevModule from the owner list for this Safe. Raw calldata stays available. Calls encoded from a user ABI are labeled as such in the review; ABIs are never fetched.
- **Settings**: owners (add / replace / remove), threshold (change), modules (listed and recognized: Zodiac mastercopies by EIP-1167 implementation, faulty versions flagged, module owner shown; disable; enable behind a danger section), guard (recognized, remove), contract details

Review is its own screen (`#tx=…`) with a single back link to wherever it was opened from. Executing returns to Assets with a confirmation.

Batch: a sticky bar at the bottom of every tab while calls are queued (expand to list/remove, Review batch, Clear).

Transaction summary (review screen):

- Safe
- chain
- nonce
- to
- value
- operation
- decoded action if known
- calldata
- SafeTx hash

Actions:

- Share transaction (link / JSON)
- Import transaction
- Approve onchain
- Approve and execute (when this approval reaches threshold)
- Sign offchain
- Import signature
- Execute

Avoid:

- sidebar navigation
- animations
- icon libraries
- web fonts
- charts
- token logos
- ENS avatars
- modal frameworks
- toast libraries

Prefer native:

- buttons
- `<dialog>` only if needed
- monospace system font for addresses
- CSS variables
- no images unless tiny inline SVG provides clear value

---

## 11. Runtime dependencies

The target is ZERO large runtime dependencies.

The agent should test two implementations:

### Option A

Vanilla JS with selected logic adapted from picosafe / ox primitives.

### Option B

A heavily tree-shaken build using picosafe + ox.

Measure final minified artifact size.

Choose whichever produces the smallest maintainable and auditable output.

Do not use:

- React
- Vue
- Angular
- Next.js
- ethers.js
- full viem
- Safe SDK

unless measurements prove otherwise.

If `ox` tree-shakes efficiently enough, it is acceptable.

---

## 12. Build architecture

Suggested repository layout:

```text
/
├── docs/
│   └── spec.md
├── src/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── safe.js
│   ├── encoding.js
│   └── chains.js
├── contract/
│   └── SafeWeiApp.sol
├── scripts/
│   ├── build.mjs
│   └── deploy.mjs
├── test/
├── package.json
└── README.md
```

The build should output:

```text
dist/index.html
```

as ONE completely self-contained HTML file.

Requirements:

- inline CSS
- inline JS
- no source maps
- minified
- no fetches for local assets
- no network-loaded modules
- no fonts
- no images unless data URI or inline SVG
- deterministic build if possible

---

## 13. ERC-8244 contract

The application contract must expose:

```solidity
function html() external view returns (string memory);
```

The exact storage architecture should be selected based on final payload size.

Preferred progression:

### Small payload

Return HTML stored directly in contract bytecode/constants.

Only viable for payloads well under the EIP-170 limit (24,576 bytes of runtime code). At the 50–100 KB targets in §19, expect SSTORE2 chunks from the start.

### Medium payload

Store HTML chunks in SSTORE2-style data contracts.

`html()` concatenates chunks.

### Larger payload

Use multiple deterministic data contracts.

Still keep:

- all content on Ethereum
- no external storage requirement

Review the current WeiDAO / zSwap implementations for best practice.

The app contract should be immutable after final production deployment unless there is a compelling reason otherwise.

Prefer redeploy + update `safe.wei` over upgradeability.

Avoid proxy patterns for the frontend.

---

## 14. `.wei` integration

The user owns:

`safe.wei`

The final production contract should become the content/application target for `safe.wei`.

Deployment docs must include:

1. deploy ERC-8244 application contract
2. verify source
3. test direct `html()` result
4. test through an ERC-8244 gateway/browser
5. point `safe.wei` to deployment
6. verify resolution
7. record deployment address and code hash in README

Do not automate irreversible name updates until tests are complete.

---

## 15. Security model

The application itself handles high-value multisig operations.

Treat every UI mutation as security-sensitive.

### Required properties

- never trust offchain transaction state
- Safe contract is source of truth
- chain ID must always be explicit
- Safe address must always be explicit
- nonce must always be explicit
- transaction hash must always be explicit
- locally computed SafeTx hash must match Safe's `getTransactionHash`
- signatures must correspond to current owners
- signatures must be sorted as Safe expects
- threshold must be read from chain
- nonce must be rechecked before execution
- unknown calldata must not be presented as decoded
- delegatecall must never look like ordinary CALL
- unlimited approval must be highlighted

### No blind signing

The UI must show the transaction summary BEFORE:

- `approveHash`
- EIP-712 signing
- execution

### No mutable remote code

Production artifact must perform zero remote code loads.

Add a build check that fails if output HTML contains:

- `<script src=`
- `<link rel="stylesheet"`
- `http://`
- `https://`

Exceptions:

- the SVG namespace string `http://www.w3.org/2000/svg` (allow-list it exactly, or check only fetchable contexts: `src=`, `href=`, `url(`, `import`, `fetch(`)
- plain text links inside documentation/UI are okay only if they are not fetched as dependencies

Prefer zero external links in the deployed document itself.

### Wallet events

On `chainChanged` or `accountsChanged`, discard all loaded Safe state and any in-progress transaction, then reload from chain.

### Infrastructure-free access path

ERC-8244 gateways such as `w4eth.io` still depend on DNS, and most injected wallets do not inject into `file://` pages. The README must document a fallback that needs only an RPC:

1. fetch `html()` directly, e.g. `cast call <app> "html()(string)"`
2. verify the result against the recorded artifact hash
3. serve it from `localhost` with any static server

---

## 16. Safe version support

- create: the newest canonical release present on the chain (v1.5.0, else v1.4.1)
- open / approve / sign / execute: any version from 1.3.0 up, including `SafeL2` variants
- tested end to end on a mainnet fork: v1.3.0, v1.4.1, v1.5.0 (every fork suite runs against all three)

The app is immutable and cannot learn about future releases, so it does not keep an allow-list. A version newer than the tested ones is usable with a visible warning. This is safe because nothing is signed, approved or executed unless the locally computed SafeTx hash equals the Safe's own `getTransactionHash` (§6): a future version that changed the transaction format would be refused automatically.

Versions before 1.3.0 are refused: their EIP-712 domain has no chainId.

Batches are recognized for the canonical MultiSendCallOnly of v1.4.1 and v1.5.0; new batches use the newest one deployed on the chain.

---

## 17. Deployment support

MVP deployment should use canonical Safe v1.4.1 infrastructure.

The agent must verify current canonical addresses from authoritative Safe sources before hardcoding them.

Do not rely on remembered addresses.

For each supported chain store only:

- the canonical CREATE2 addresses of Safe v1.4.1 (singleton, SafeL2 singleton, proxy factory, CompatibilityFallbackHandler, MultiSendCallOnly) and Multicall3, identical on every supporting chain
- a display name and native symbol per well-known chain ID

Mainnet-only registries (read only when connected to chain 1):

- ENS registry
- WNS `NameNFT`: `0x0000000000696760E15f265e828DB644A0c242EB`
- zOrg TokenList: `0x0000006013dF75A31678B786061C2B54bf531524`

Verify every address from its authoritative source (Safe deployments repo, ENS docs, wei-names repo, zFi repo) before hardcoding.

Start with Ethereum mainnet.

A local Anvil chain may be used for development/testing.

---

## 18. Tests

Tests are important because this app is intentionally removing abstraction layers.

Required tests:

### Encoding

- SafeTx local hash equals Safe `getTransactionHash`
- EIP-712 encoding matches canonical Safe behavior
- prevalidated signature encoding
- ECDSA signature encoding
- signer sorting

### Transaction

- 1-of-1 Safe execution
- 2-of-3 with onchain `approveHash`
- 2-of-3 with EIP-712 signatures
- mixed prevalidated + ECDSA signatures if supported
- executor's own prevalidated signature without `approveHash` (1-of-1 and final approver)
- nonce mismatch rejection
- all of the above against both Safe v1.3.0 and v1.4.1

### Transaction sharing

- payload export → import round trip reproduces the same SafeTx hash
- tampered payload produces a different hash and is shown as a different transaction
- `approveHash` with trailing payload calldata succeeds and records the approval (v1.3.0 and v1.4.1)
- onchain discovery ignores payloads whose hash does not match the approved hash, or whose nonce is stale

### Deployment

- predicted Safe address matches deployed address
- owners correct
- threshold correct

### Security regression

- hash mismatch blocks signing
- delegatecall warning appears
- unlimited approval warning appears
- non-owner signature rejected
- duplicate signature rejected
- insufficient signatures cannot execute

### Post-MVP features

- ERC-20 amount parsing: decimal string ↔ bigint round trips, no floating point
- token list filtering excludes foreign-chain, non-ERC-20 and undeployed listings
- ENS and `.wei` resolution against forked mainnet
- names with non-`[a-z0-9-]` labels are rejected
- CCIP-read (`OffchainLookup`) names are reported as unsupported, never silently resolved
- MultiSend encoding round trip; each inner call decoded

### Build

- output is one HTML file
- no remote JS
- no remote CSS
- no external asset requests
- output size printed in CI/test output

Use real Safe contracts in local Anvil tests.

Avoid mocks for protocol-critical hash/signature behavior where practical.

---

## 19. Size budget

Size is a first-class metric.

Every build must print:

- raw HTML bytes
- gzip bytes for reference
- JS bytes
- CSS bytes

Initial targets:

### Ideal

< 50 KB raw

### Good

< 100 KB raw

### Acceptable MVP

< 200 KB raw

If output exceeds 200 KB:

stop and investigate dependencies before adding more features.

The agent should maintain:

`docs/size.md`

containing major contributors to bundle size.

Do not optimize readability of source at the expense of correctness, but aggressively optimize shipped bytes.

---

## 20. Development phases

### Phase 0 — research and spike

Before building the UI:

1. inspect picosafe's relevant source
2. inspect zSwap ERC-8244 deployment structure
3. inspect WeiDAO frontend storage pattern
4. verify Safe v1.4.1 canonical addresses
5. create a tiny HTML spike that:
   - connects wallet
   - reads owners/threshold/nonce from a Safe
6. measure bytes

Deliverable:

working spike + size report.

### Phase 1 — Open Safe / read-only

Implement:

- wallet connection
- chain detection
- input Safe address
- validate bytecode exists
- owners
- threshold
- nonce
- native balance

No signing yet.

### Phase 2 — raw transaction builder

Implement:

- to
- value
- calldata
- CALL
- transaction preview
- local SafeTx hash
- onchain `getTransactionHash` comparison

No execution unless hashes match.

### Phase 3 — onchain approval flow

Implement:

- `approveHash`
- query owner approvals
- build prevalidated signatures
- threshold detection
- executor's own prevalidated signature ("Approve and execute")
- `execTransaction`
- nonce revalidation
- inner-call `eth_call` simulation
- transaction payload export/import (§7.3 Layer 1)

This is the first complete usable release.

### Phase 4 — Safe deployment

Implement:

- owner list
- threshold
- predicted address
- canonical proxy factory deployment
- deployed Safe opening automatically

### Phase 5 — offchain signatures

Implement:

- EIP-712 signing
- export signature payload
- import signature payload
- validate
- combine
- execute

No backend.

### Phase 6 — tiny decoder

Implement only high-value selector decoding:

- transfer
- approve
- transferFrom
- core Safe configuration selectors

Warnings:

- unlimited approval
- delegatecall

### Phase 7 — ERC-8244 deployment

Implement:

- single-file build
- app storage contract
- `html()`
- deployment script
- content verification
- gateway/browser test

Measure deployment gas.

### Phase 8 — `safe.wei`

After full verification:

- deploy final immutable frontend
- verify source
- point `safe.wei`
- document contract address/code hash

### Phase 9 — onchain transaction discovery

Implement §7.3 Layer 2:

- optional trailing payload on `approveHash`
- pending-transaction discovery from `ApproveHash` logs

### Phase 10 — tokens

Implement §24.

### Phase 11 — names

Implement §25.

### Phase 12 — MultiSend

Implement §26.

### Phase 13 — Safe Apps (dropped)

Built, spiked, and removed: no major app accepts a non-Safe host (§27).

Each post-MVP phase ships as a new immutable deployment and a `safe.wei` update.

---

## 21. Non-goals for MVP

Do NOT implement:

- Safe Transaction Service integration
- transaction history indexing
- token lists other than the zOrg TokenList (§24)
- token logos
- NFT display
- DeFi positions
- fiat values
- ENS avatar lookup
- ENS CCIP-read / offchain names
- bundled ENSIP-15 normalization library
- WalletConnect SDK
- Safe Apps (§27)
- module marketplace
- guard marketplace
- Zodiac UI
- social recovery
- spending policies
- address book sync
- notifications
- mobile push
- analytics
- account abstraction / ERC-4337 unless required later
- passkeys
- hosted relayers
- gas sponsorship
- simulation services
- remote ABI lookup

Raw calldata is the escape hatch.

---

## 22. Agent implementation rules

The implementing agent should behave autonomously.

Do not stop for cosmetic decisions.

When uncertain:

1. choose the simpler design
2. prefer fewer dependencies
3. prefer direct Safe contract calls
4. prefer deterministic behavior
5. prefer functionality that is verifiable onchain

Before introducing ANY runtime dependency:

- record why it is needed
- record its minified contribution
- test whether 20–50 lines of local code can replace it safely

Do not prematurely optimize Solidity storage before measuring the final HTML.

Do not build the ERC-8244 contract until the basic UI flow is functional.

Commit incrementally by phase.

---

## 23. Definition of done for MVP

MVP is complete when a user can:

1. visit the locally built single HTML page
2. connect an EIP-1193 wallet
3. open an existing Ethereum Safe v1.4.1
4. inspect owners / threshold / nonce / balance
5. construct an arbitrary CALL transaction
6. see all transaction fields
7. see locally computed SafeTx hash
8. see that hash verified against `getTransactionHash`
9. share the transaction with other owners and import it on their side
10. approve the transaction onchain from multiple owners
11. observe approval threshold
12. execute the transaction through the Safe, with the executor's approval included in the same transaction
13. create a new Safe
14. repeat the above with the newly created Safe
15. build a self-contained HTML artifact
16. deploy that artifact through an ERC-8244 `html()` contract
17. load and operate the app from the onchain deployment

After that, add offchain EIP-712 signature sharing.

---

## 24. Post-MVP — Token balances and sends

Source: zOrg TokenList on mainnet (`0x0000006013dF75A31678B786061C2B54bf531524`), the same registry zSwap reads.

Read:

- one `summariesPaged(0, 256)` call. It returns id, account, chainId, decimals, kind, standard, deployed, name and symbol without logos.
- keep only entries with `kind == EVM`, `standard ∈ {NATIVE, ERC20}`, `deployed == true`, `chainId == connected chain`
- one Multicall3 `aggregate3` (allowFailure) of `balanceOf(safe)` over the filtered list

Also support "add token by address". It reads `decimals()` and `symbol()` from the token and labels it "unlisted". A Safe's visible balances must not depend solely on a third party's curation.

Send:

- native: a CALL with `value`
- ERC-20: a CALL to the token with `transfer(to, amount)`, through the normal transaction flow (§5–8)
- amounts are parsed from decimal strings into bigint using the token's decimals. Never use floating point.
- "max" uses the exact balance

Display:

- always show the token address next to its symbol in balances and in the transaction summary. Symbols are not unique and can be spoofed.
- the decoder (§9) uses listed decimals and symbol for known tokens; unknown tokens show raw amounts

No logos, no fiat values.

### Bulk send (CSV)

Paste one transfer per line: `recipient,amount[,token]`.

- separators: comma, semicolon, tab or spaces; an optional header row and `#` comments are ignored
- recipient: 0x address or `.eth` / `.wei` name (§25)
- token: empty or the native symbol for ETH, a TokenList symbol (must be unambiguous), or a token address (unlisted tokens are labeled)
- every row is validated with its line number; per-token totals are checked against the Safe balance
- the rows become one MultiSendCallOnly batch (§26), or a plain transfer for a single row; at most 200 rows per transaction

### Deeplinks

Links prefill forms; they never approve, sign or submit anything, and a prefilled form says so.

- `#/<safe>/send?to=<address|name>&amount=<decimal>&token=<symbol|address>` opens the send form (`token` omitted = native)
- `#/<safe>/batch?csv=<url-encoded CSV>` opens the bulk-send panel with the rows and previews them
- `<safe>` may be a 0x address or a `.eth` / `.wei` name
- the send form and the bulk panel have "Copy link" to produce these

---

## 25. Post-MVP — ENS and `.wei` name resolution

Wherever the app accepts an address (recipient, owner, `to`, Safe address), also accept a `.eth` or `.wei` name.

### `.wei` (WNS)

- tokenId = `keccak256(WEI_NODE ‖ keccak256(label))`, applied per label for subnames
- `WEI_NODE = 0xa82820059d5df798546bcc2985157a77c3eef25eba9ba01899927333efacbd6f`
- `resolve(uint256 tokenId)` on `NameNFT`. Expired names resolve to empty; treat that as "not found".

### ENS

- `registry.resolver(namehash)` → `resolver.addr(namehash)`
- fallback: ENSIP-10 `resolve(dnsEncode(name), addr(namehash))` for wildcard resolvers
- do not depend on the Universal Resolver, whose address has changed over time
- if the resolver reverts with `OffchainLookup` (CCIP-read), report "this name's records are off chain; safe.wei reads only onchain state". Never make the gateway HTTP request.

### Input restrictions

Do not bundle an ENSIP-15 normalization library. Accept only lowercase labels matching `[a-z0-9-]+`, separated by `.`, and reject anything else with a clear message. This also rules out lookalike-character (homograph) names.

### Security

- names are a UX convenience. The SafeTx always commits to the resolved address.
- the transaction summary shows `name → 0x…`
- re-resolve immediately before signing or approving, and warn if the result changed since input

### Reverse resolution (display only)

- WNS: `reverseResolve(address)`, which already verifies the forward record
- ENS: reverse record plus an explicit forward check; show the name only if it resolves back to the same address

Used for owner lists and the connected wallet. Never used as input to transaction construction.

---

## 26. Post-MVP — MultiSend

Batches let one Safe transaction do several things atomically (for example approve + swap, or many token transfers).

- use only the canonical `MultiSendCallOnly` (v1.4.1) address from §17
- the outer Safe transaction is a DELEGATECALL to that address. Display it as "Batch of N calls", not as a dangerous delegatecall, and only for that exact address.
- decode and display every inner call (to, value, data, decoded action) with the same warnings as single calls
- `MultiSendCallOnly` rejects nested delegatecalls by design; never use the plain `MultiSend` contract

---

## 27. Safe Apps — dropped

A Safe Apps host was built and tested (Phase 13), then removed. The compatibility spike (docs/safe-apps.md) found that none of the major apps work outside `app.safe.global`: some forbid framing, the rest ignore replies from any other parent origin. A feature that works with no real app is not worth its bytes or its attack surface.

Raw calldata, batches and the share link remain the way to act on any protocol.

---

## 28. Future work

Only after MVP:

- compact QR signature exchange
- owner management UI
- threshold management UI
- module management
- custom RPC selector
- broader chain support (ENS, WNS and TokenList live on mainnet; using them from other chains needs an L1 read path, which conflicts with the wallet-RPC-only rule)
- hardware-wallet-specific UX
- ERC-5219 compatibility if useful
- alternate fully onchain compression/storage techniques

---

## 29. Final guiding principle

If there is a choice between:

- a convenient abstraction that adds significant code, and
- a small amount of explicit Safe protocol code,

prefer the explicit protocol code.

The production artifact should be small enough that an experienced Ethereum developer can audit the entire critical path without navigating a large framework or dependency graph.

`safe.wei` should remain useful precisely when everything else is broken.
