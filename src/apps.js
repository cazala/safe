// Safe Apps host (spec §27): answers the Safe Apps SDK postMessage protocol for an
// app loaded in a sandboxed iframe. Reads are forwarded to the wallet RPC only for an
// allow-list of read methods; transactions go through the normal review flow.
import { checksum, isAddr, isHex, ZERO } from './abi.js';
import { CHAINS } from './chains.js';
import { batch } from './multisend.js';
import { newTx, safeTxHash } from './safe.js';

export const SDK_VERSION = '9.1.0';

// Read-only JSON-RPC methods an app may use through rpcCall. Nothing that signs or sends.
export const READ = [
  'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_getLogs', 'eth_estimateGas', 'eth_gasPrice', 'eth_chainId',
];

/** Validate an app URL and return its URL object (https only, plus http on localhost for development). */
export function appURL(v) {
  v = v.trim();
  const u = new URL(/^[a-z]+:/i.test(v) ? v : ['https:', '', v].join('/'));
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw Error('Safe Apps must be served over https.');
  return u;
}

/** Turn sendTransactions params into a SafeTx (single CALL or MultiSendCallOnly batch). */
export function toSafeTx(s, params) {
  const txs = params && params.txs;
  if (!Array.isArray(txs) || !txs.length) throw Error('No transactions were passed.');
  const calls = txs.map((x, i) => {
    const to = String(x.to || '').toLowerCase(), data = String(x.data || '0x').toLowerCase();
    if (!isAddr(to)) throw Error('Transaction ' + (i + 1) + ': invalid "to".');
    if (!isHex(data)) throw Error('Transaction ' + (i + 1) + ': invalid "data".');
    const value = BigInt(x.value || 0);
    if (value < 0n) throw Error('Transaction ' + (i + 1) + ': invalid "value".');
    return { to, value, data };
  });
  return newTx(s, calls.length === 1 ? calls[0] : batch(s.chainId, calls));
}

/**
 * Handle one SDK request. `ctx` supplies: safe (readSafe result), account, rpc(method, params),
 * balances() → getSafeBalances data, txStatus(hash) → getTxBySafeTxHash data, and
 * propose(tx) → Promise<safeTxHash> (resolves once the user acted, rejects if they rejected).
 */
export async function handle(method, params, ctx) {
  const s = ctx.safe, c = CHAINS[s.chainId] || {};
  switch (method) {
    case 'getSafeInfo':
      return {
        safeAddress: checksum(s.address),
        chainId: s.chainId,
        threshold: Number(s.threshold),
        owners: s.owners.map(checksum),
        isReadOnly: !(ctx.account && s.owners.includes(ctx.account.toLowerCase())),
        nonce: Number(s.nonce),
        implementation: s.singleton,
        modules: [],
        fallbackHandler: s.fallback || ZERO,
        guard: s.guard || ZERO,
        version: s.version,
      };
    case 'getChainInfo':
      return {
        chainName: c.name,
        chainId: String(s.chainId),
        shortName: s.chainId === 1 ? 'eth' : String(s.chainId),
        nativeCurrency: { name: 'Ether', symbol: c.sym, decimals: 18, logoUri: '' },
        blockExplorerUriTemplate: { address: '', txHash: '', api: '' },
      };
    case 'getEnvironmentInfo':
      return { origin: ctx.origin };
    case 'rpcCall': {
      const call = params && params.call;
      if (call === 'safe_setSettings') return (params.params || [])[0] || {}; // acknowledged; nothing to configure
      if (!READ.includes(call)) throw Error('RPC method not allowed by safe.wei: ' + call);
      return ctx.rpc(call, Array.isArray(params.params) ? params.params : []);
    }
    case 'getSafeBalances':
      return ctx.balances();
    case 'getTxBySafeTxHash':
      return ctx.txStatus(String((params && params.safeTxHash) || '').toLowerCase());
    case 'sendTransactions': {
      const tx = toSafeTx(s, params);
      return { safeTxHash: await ctx.propose(tx, safeTxHash(tx)) };
    }
    case 'wallet_getPermissions':
      return [];
    default:
      throw Error(method + ' is not supported by safe.wei.');
  }
}
