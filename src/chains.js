// Chains. safe.wei works on any EVM chain the wallet is connected to: an existing Safe
// is read entirely from its own contract. Features that need other contracts (creating
// Safes, batches, token balances) are enabled only where those contracts actually have
// code on the connected chain, checked at connection time, never assumed.
//
// Safe's canonical contracts are deployed with CREATE2 at the same addresses on every
// chain that supports deterministic deployment. Verified in docs/research.md
// (safe-global/safe-deployments) and on Ethereum and Polygon in test/fork.
import { rpc } from './rpc.js';

export const SAFE = {
  singleton: '0x41675c099f32341bf84bfc5382af534df5c7461a', // Safe v1.4.1 (Ethereum mainnet)
  singletonL2: '0x29fcb43b46531bca003ddc8fcb67ffe91900c762', // SafeL2 v1.4.1 (every other chain, as Safe Wallet does)
  factory: '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67',
  fallback: '0xfd0732dc9e303f09fcef3a7388ad10a83459ec99',
  multiSendCallOnly: '0x9641d764fc13c8b624c04430c7356c1c7c8102e2',
  multicall3: '0xca11bde05977b3631167028862be2a173976ca11',
};

// Registries that exist on Ethereum mainnet only (names, token list).
export const MAINNET = {
  ens: '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e',
  wns: '0x0000000000696760e15f265e828db644a0c242eb',
  tokenList: '0x0000006013df75a31678b786061c2b54bf531524',
};

// Display names and native symbols only; any other chain works as "Chain <id>".
const KNOWN = {
  1: ['Ethereum', 'ETH'],
  10: ['OP Mainnet', 'ETH'],
  56: ['BNB Chain', 'BNB'],
  100: ['Gnosis', 'xDAI'],
  137: ['Polygon', 'POL'],
  8453: ['Base', 'ETH'],
  42161: ['Arbitrum One', 'ETH'],
  43114: ['Avalanche', 'AVAX'],
  59144: ['Linea', 'ETH'],
  534352: ['Scroll', 'ETH'],
  11155111: ['Sepolia', 'ETH'],
};
export const label = (id) => {
  const [name, sym] = KNOWN[id] || ['Chain ' + id, 'native'];
  return { name, sym };
};

// Safe versions tested end to end (test/fork). SafeTx typehash, EIP-712 domain, approveHash
// and execTransaction are identical across them.
export const TESTED = ['1.3.0', '1.4.1', '1.5.0'];

/**
 * Versions this app will operate. The app is immutable, so it cannot learn about future Safe
 * releases: any version from 1.3.0 up is allowed, and untested ones get a warning. That is
 * safe because nothing is signed unless the locally computed SafeTx hash equals the Safe's own
 * getTransactionHash (spec §6): a future version that changed the format would be refused.
 * Before 1.3.0 the EIP-712 domain had no chainId, so those versions are refused outright.
 */
export const operable = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v || '');
  return !!m && (+m[1] > 1 || (+m[1] === 1 && +m[2] >= 3));
};

/** Chain info for `id`, probing the connected wallet for the contracts each feature needs. */
export async function chainInfo(id) {
  const singleton = id === 1 ? SAFE.singleton : SAFE.singletonL2;
  const has = async (a) => (await rpc('eth_getCode', [a, 'latest']).catch(() => '0x')) !== '0x';
  const [s, f, fb, ms, mc] = await Promise.all([singleton, SAFE.factory, SAFE.fallback, SAFE.multiSendCallOnly, SAFE.multicall3].map(has));
  return { id, ...label(id), ...SAFE, singleton, canCreate: s && f && fb, canBatch: ms, canMulticall: mc, mainnet: id === 1 };
}
