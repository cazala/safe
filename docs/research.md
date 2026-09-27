# Phase 0 research

## Safe canonical addresses (Ethereum mainnet)

Source: `safe-global/safe-deployments`, `src/assets/v1.3.0` and `src/assets/v1.4.1`, `networkAddresses["1"]`, canonical deployment type. Every address is also asserted to have code on a mainnet fork in `test/fork/read.test.mjs`.

| Contract | v1.3.0 | v1.4.1 |
| --- | --- | --- |
| Safe (singleton) | `0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552` | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| SafeL2 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` |
| Proxy factory | `0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2` | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
| CompatibilityFallbackHandler | `0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4` | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` |
| MultiSendCallOnly | `0x40A2aCCbd92BCA938b02010E17A5b8929b49130D` | `0x9641d764fc13c8B624c04430C7356C1C7C8102e2` |

v1.3.0 also has "eip155" variant deployments at different addresses (second entry in `networkAddresses`). The app only needs v1.3.0 addresses for tests: it detects the version with `VERSION()` rather than by singleton address, so Safes on either variant are supported.

Other registries (mainnet):

| Contract | Address | Source |
| --- | --- | --- |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | mds1/multicall, same on all chains |
| ENS registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` | ENS docs |
| WNS NameNFT | `0x0000000000696760E15f265e828DB644A0c242EB` | z0r0z/wei-names README |
| zOrg TokenList | `0x0000006013dF75A31678B786061C2B54bf531524` | z-fi/zFi `deploy/TokenList.md` |

## Other chains

The v1.4.1 addresses above are CREATE2 deployments and are identical on every chain that supports Safe's deterministic deployment. `networkAddresses["137"]` (Polygon) lists exactly the same addresses, and `test/fork/polygon.test.mjs` creates a SafeL2, executes a transfer and a batch, and reads balances on a Polygon fork. Chains where deterministic deployment does not hold (for example zkSync Era) simply fail the `eth_getCode` probe, so creating and batching are disabled there while existing Safes still open.

## Protocol constants

- `SafeTx` typehash `0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8`
- `EIP712Domain(uint256 chainId,address verifyingContract)` typehash `0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218`
- Both are the same for v1.3.0 and v1.4.1, which is what makes supporting both cheap.
- Storage: slot 0 = singleton; guard at `keccak256("guard_manager.guard.address")`; fallback handler at `keccak256("fallback_manager.handler.address")`. Reading them costs one `eth_getStorageAt` each, so the Safe view shows them (spec §4.2 "nearly free").

## picosafe

`volga-sh/picosafe` is a TypeScript library on top of `ox`. Its protocol logic is straightforward to re-express directly (ABI fragments, EIP-712 SafeTx hash, signature concatenation, `execTransaction` calldata). Bundling it would bring `ox`; see the measurement below.

Its e2e harness injects an EIP-1193 provider that forwards to Anvil. `test/fork/anvil.mjs` uses the same idea in Node.

## zSwap / WeiDAO ERC-8244 packaging

- `html()` returns the whole page. zSwap stores the page as the runtime bytecode of N data contracts and reassembles them with `extcodecopy` in one assembly loop.
- It also implements ERC-5219 `request()` + `resolveMode() == "5219"` so web3:// gateways (w3link.io) work, and ERC-8244 gateways (`<addr>.w4eth.io`) call `html()` directly.
- WeiDAO keeps large CSS/JS blobs in SSTORE2 data contracts to stay under EIP-170.

## Option A vs Option B (spec §11)

Minified bundle of the primitives the app needs (keccak, ABI encode/decode, checksum, EIP-712 building blocks):

| Option | raw | gzip |
| --- | --- | --- |
| A: vanilla (`src/keccak.js` + `src/abi.js`) | 3,074 B | 1,598 B |
| B: `ox` (Hash, AbiParameters, AbiFunction, TypedData, Address; tree-shaken with esbuild) | 54,452 B | 17,497 B |

Decision: Option A. It is ~18x smaller, and every line is on the audited critical path anyway. Correctness is covered by cross-checks against `@noble/hashes` and `viem` in `test/unit` (dev dependencies only, never shipped).

## Test environment gotcha

On mainnet, the well-known Anvil mnemonic accounts are EIP-7702-delegated to sweeper contracts. A mainnet fork inherits that code, so the fork harness clears it with `anvil_setCode(account, "0x")` before running tests.
