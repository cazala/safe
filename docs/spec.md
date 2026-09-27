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

Target Safe version:

- Safe v1.4.1

Use canonical Safe singleton/proxy factory deployments for supported chains.

Do not deploy custom Safe implementations.

Initial chain support:

- Ethereum mainnet first

Architecture should make adding other EVM chains trivial, but avoid shipping a huge chain registry.

A small hardcoded map is acceptable.

### 4.2 Open existing Safe

Input:

- Safe address

Read directly from chain:

- code existence
- Safe version if practical
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

Prevalidated Safe signature format:

- `r` = owner address left-padded to 32 bytes
- `s` = 0
- `v` = 1

Advantages:

- no backend
- no transaction service
- no mailbox
- no signature sharing
- no URL fragments
- no IPFS/Swarm
- approvals are discoverable directly from chain
- easiest possible recovery UX

Tradeoff:

- every signer pays gas for `approveHash`

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

### Safe view

Header:

- Safe address
- chain
- native balance
- threshold
- nonce

Owners section:

- owner address
- current wallet indicator
- approval state for current transaction

Transaction builder:

- To
- Value
- Data
- Advanced operation

Transaction summary:

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

- Approve onchain
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

Exception:

plain text links inside documentation/UI are okay only if they are not fetched as dependencies.

Prefer zero external links in the deployed document itself.

---

## 16. Safe version support

MVP:

- Safe v1.4.1

When opening a Safe:

- detect version if cheap
- if unsupported version is detected, show a clear warning

Do not attempt broad backwards compatibility in v1.

The architecture should isolate ABI/version-specific behavior so support can be added later.

---

## 17. Deployment support

MVP deployment should use canonical Safe v1.4.1 infrastructure.

The agent must verify current canonical addresses from authoritative Safe sources before hardcoding them.

Do not rely on remembered addresses.

For each supported chain store only:

- chain ID
- name
- Safe singleton
- Safe proxy factory
- fallback handler if needed
- MultiSend only if MultiSend is shipped

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
- nonce mismatch rejection

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
- `execTransaction`
- nonce revalidation

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

---

## 21. Non-goals for MVP

Do NOT implement:

- Safe Transaction Service integration
- transaction history indexing
- automatic token lists
- NFT display
- DeFi positions
- fiat values
- ENS avatar lookup
- WalletConnect SDK
- Safe Apps
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
9. approve the transaction onchain from multiple owners
10. observe approval threshold
11. execute the transaction through the Safe
12. create a new Safe
13. repeat the above with the newly created Safe
14. build a self-contained HTML artifact
15. deploy that artifact through an ERC-8244 `html()` contract
16. load and operate the app from the onchain deployment

After that, add offchain EIP-712 signature sharing.

---

## 24. Future work

Only after MVP:

- compact QR signature exchange
- URL-fragment transaction/signature sharing
- MultiSend
- owner management UI
- threshold management UI
- module management
- custom RPC selector
- broader chain support
- minimal transaction simulation using `eth_call`
- hardware-wallet-specific UX
- ENS / `.wei` address display
- ERC-5219 compatibility if useful
- alternate fully onchain compression/storage techniques

---

## 25. Final guiding principle

If there is a choice between:

- a convenient abstraction that adds significant code, and
- a small amount of explicit Safe protocol code,

prefer the explicit protocol code.

The production artifact should be small enough that an experienced Ethereum developer can audit the entire critical path without navigating a large framework or dependency graph.

`safe.wei` should remain useful precisely when everything else is broken.
