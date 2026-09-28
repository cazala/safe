// Chains. safe.wei works on any EVM chain the wallet is connected to: an existing Safe
// is read entirely from its own contract. Features that need other contracts (creating
// Safes, batches, token balances) are enabled only where those contracts actually have
// code on the connected chain, checked at connection time, never assumed.
//
// Safe's canonical contracts are deployed with CREATE2 at the same addresses on every
// chain that supports deterministic deployment. Verified in docs/research.md
// (safe-global/safe-deployments) and on Ethereum and Polygon in test/fork.
import { rpc } from './rpc.js';

// New Safes use the latest release present on the chain: v1.5.0, else v1.4.1.
// `singleton` is used on Ethereum mainnet, `singletonL2` everywhere else (as Safe Wallet does).
const RELEASES = [
  {
    version: '1.5.0',
    singleton: '0xff51a5898e281db6dfc7855790607438df2ca44b',
    singletonL2: '0xedd160febbd92e350d4d398fb636302fccd67c7e',
    factory: '0x14f2982d601c9458f93bd70b218933a6f8165e7b',
    fallback: '0x3efcbb83a4a7afcb4f68d501e2c2203a38be77f4',
    multiSendCallOnly: '0xa83c336b20401af773b6219ba5027174338d1836',
  },
  {
    version: '1.4.1',
    singleton: '0x41675c099f32341bf84bfc5382af534df5c7461a',
    singletonL2: '0x29fcb43b46531bca003ddc8fcb67ffe91900c762',
    factory: '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67',
    fallback: '0xfd0732dc9e303f09fcef3a7388ad10a83459ec99',
    multiSendCallOnly: '0x9641d764fc13c8b624c04430c7356c1c7c8102e2',
  },
];
export const SAFE = { ...RELEASES[0], multicall3: '0xca11bde05977b3631167028862be2a173976ca11' };
export const SAFE141 = RELEASES[1];
/**
 * Canonical MultiSendCallOnly contracts recognized as batches (only these; spec §26). New batches use
 * the latest release; the 1.3.0 ones (canonical and eip155 addresses, same bytecode) are read only.
 */
export const MULTISEND = [...RELEASES.map((r) => r.multiSendCallOnly), '0x40a2accbd92bca938b02010e17a5b8929b49130d', '0xa1dabef33b3b82c7814b6d82a79e50f4ac44102b'];

// Safe's canonical CompatibilityFallbackHandler and SignMessageLib per release line, from
// safe-global/safe-deployments (1.3.0 exists at a "canonical" and an "eip155" address). A Safe
// uses the ones of its own line: the 1.5.0 handler relies on functions older Safes lack.
export const LIBS = {
  '1.3': { handler: ['0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4', '0x017062a1de2fe6b99be3d9d37841fed19f573804'], signMessage: ['0xa65387f16b013cf2af4605ad8aa5ec25a2cba3a2', '0x98ffbbf51bb33a056b08ddf711f289936aaff717'] },
  '1.4': { handler: ['0xfd0732dc9e303f09fcef3a7388ad10a83459ec99'], signMessage: ['0xd53cd0ab83d845ac265be939c57f53ad838012c9'] },
  '1.5': { handler: ['0x3efcbb83a4a7afcb4f68d501e2c2203a38be77f4'], signMessage: ['0x4ffef8222648872b3de295ba1e49110e61f5b5aa'] },
};
const LINE_VERSION = { '1.3': '1.3.0', '1.4': '1.4.1', '1.5': '1.5.0' };
/**
 * Known fallback handlers: address → { name, version, messageHash }. `messageHash` says whether the
 * handler exposes getMessageHash (Compatibility) or not (Extensible: same SafeMessage hash, checked
 * through the Safe's domainSeparator instead). ExtensibleFallbackHandler 1.5.0 is in safe-deployments;
 * the 1.4.1-era one (used by CoW Protocol's TWAP orders) is Etherscan-verified as ExtensibleFallbackHandler.
 */
export const HANDLERS = {
  ...Object.fromEntries(Object.entries(LIBS).flatMap(([l, x]) => x.handler.map((a) => [a, { name: 'CompatibilityFallbackHandler', version: LINE_VERSION[l], messageHash: true }]))),
  '0x2f55e8b20d0b9fefa187aa7d00b6cbe563605bf5': { name: 'ExtensibleFallbackHandler', version: '1.4.1', messageHash: false },
  '0x85a8ca358d388530ad0fb95d0cb89dd44fc242c3': { name: 'ExtensibleFallbackHandler', version: '1.5.0', messageHash: false },
};
export const handlerName = (a) => HANDLERS[a] && HANDLERS[a].name + ' ' + HANDLERS[a].version;
export const SIGN_MESSAGE_LIBS = Object.values(LIBS).flatMap((x) => x.signMessage);
/** The release line whose libraries fit a Safe version (anything newer than 1.5 uses 1.5's). */
export const line = (v) => {
  const m = /^1\.(\d+)/.exec(v || '');
  return !m || +m[1] >= 5 ? '1.5' : +m[1] === 4 ? '1.4' : '1.3';
};

/**
 * Where a gateway says the page comes from, from generic hostname patterns (no gateway is named):
 * { app } when the hostname starts with the contract address (0x<address>.<gateway>), { name } when
 * it starts with a .wei / .eth name (<name>.wei.<gateway>), { local } for localhost / IPs, else {}.
 */
export function gatewayOf(host) {
  host = host.toLowerCase();
  const app = /^(0x[0-9a-f]{40})(?:\.|$)/.exec(host);
  if (app) return { app: app[1] };
  const name = /^((?:[a-z0-9-]+\.)+?(?:wei|eth))\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.exec(host);
  if (name) return { name: name[1] };
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^[\d.]+$/.test(host) || host.startsWith('[') ? { local: true } : {};
}

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
/** Chains safe.wei knows by name (offered to a WalletConnect wallet). */
export const KNOWN_IDS = Object.keys(KNOWN).map(Number);
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
  const has = async (a) => (await rpc('eth_getCode', [a, 'latest']).catch(() => '0x')) !== '0x';
  const probe = await Promise.all(
    RELEASES.map(async (r) => {
      const [s, f, fb, ms] = await Promise.all([id === 1 ? r.singleton : r.singletonL2, r.factory, r.fallback, r.multiSendCallOnly].map(has));
      return { r, create: s && f && fb, batch: ms };
    }),
  );
  const rel = (probe.find((p) => p.create) || probe[0]).r, batch = probe.find((p) => p.batch);
  const libs = Object.values(LIBS).flatMap((x) => [...x.handler, ...x.signMessage]);
  const deployed = new Set((await Promise.all(libs.map(async (a) => (await has(a)) && a))).filter(Boolean));
  return {
    id,
    ...label(id),
    ...rel,
    singleton: id === 1 ? rel.singleton : rel.singletonL2,
    multiSendCallOnly: batch ? batch.r.multiSendCallOnly : SAFE.multiSendCallOnly,
    multicall3: SAFE.multicall3,
    canCreate: probe.some((p) => p.create),
    canBatch: !!batch,
    canMulticall: await has(SAFE.multicall3),
    mainnet: id === 1,
    /** The deployed handler / SignMessageLib for a Safe of `version`, or null. */
    libFor: (version, kind) => LIBS[line(version)][kind].find((a) => deployed.has(a)) || null,
  };
}
