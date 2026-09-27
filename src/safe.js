// Safe protocol: state reads. Everything is read from the Safe contract itself.
import { a, arr, B, cd, encode, keccakHex, str, strip, u, word, ZERO } from './abi.js';
import { VERSIONS } from './chains.js';
import { call, chainId, rpc } from './rpc.js';
import { S, T } from './sel.js';

// keccak256("guard_manager.guard.address") / keccak256("fallback_manager.handler.address")
const GUARD_SLOT = '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8';
const FALLBACK_SLOT = '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5';

const slot = (addr, s) => rpc('eth_getStorageAt', [addr, s, 'latest']).then((r) => a(r));

/** Read everything the UI shows about a Safe. Throws if there is no contract. */
export async function readSafe(addr) {
  addr = addr.toLowerCase();
  const [code, chain] = await Promise.all([rpc('eth_getCode', [addr, 'latest']), chainId()]);
  if (code === '0x') throw Error('No contract at ' + addr + ' on chain ' + chain);
  const [version, owners, threshold, nonce, balance, singleton, guard, fallback] = await Promise.all([
    call(addr, '0x' + S.VERSION).then(str, () => null),
    call(addr, '0x' + S.getOwners).then((r) => arr(r)),
    call(addr, '0x' + S.getThreshold).then(u),
    call(addr, '0x' + S.nonce).then(u),
    rpc('eth_getBalance', [addr, 'latest']).then(BigInt),
    slot(addr, '0x0'),
    slot(addr, GUARD_SLOT),
    slot(addr, FALLBACK_SLOT),
  ]).catch((e) => {
    throw Error('Not a Safe, or unreadable: ' + (e.message || e));
  });
  return {
    address: addr,
    chainId: chain,
    version,
    supported: VERSIONS.includes(version),
    owners,
    threshold,
    nonce,
    balance,
    singleton,
    guard: guard === ZERO ? null : guard,
    fallback: fallback === ZERO ? null : fallback,
  };
}

// ---- SafeTx ----

/** A Safe transaction with the minimal-flow defaults (no gas refunds, spec §5). */
export const newTx = (s, { to, value = 0n, data = '0x', operation = 0, nonce = s.nonce }) => ({
  chainId: s.chainId,
  safe: s.address,
  to: to.toLowerCase(),
  value: BigInt(value),
  data: data.toLowerCase(),
  operation,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: ZERO,
  refundReceiver: ZERO,
  nonce: BigInt(nonce),
});

const fields = (t) => [t.to, t.value, B(t.data), t.operation, t.safeTxGas, t.baseGas, t.gasPrice, t.gasToken, t.refundReceiver, t.nonce];

/** EIP-712 SafeTx hash computed locally (identical for v1.3.0 and v1.4.1). */
export function safeTxHash(t) {
  const domain = keccakHex('0x' + encode([T.Domain, t.chainId, t.safe]));
  const struct = keccakHex(
    '0x' + encode([T.SafeTx, t.to, t.value, keccakHex(t.data), t.operation, t.safeTxGas, t.baseGas, t.gasPrice, t.gasToken, t.refundReceiver, t.nonce]),
  );
  return keccakHex('0x1901' + strip(domain) + strip(struct));
}

/** The Safe's own getTransactionHash for the same fields. */
export const chainTxHash = (t) => call(t.safe, cd(S.getTransactionHash, ...fields(t))).then((r) => '0x' + strip(r).slice(0, 64));

// ---- signatures / execution ----

/** Safe "pre-validated" signature: r = owner, s = 0, v = 1. */
export const prevalidated = (owner) => '0x' + word(owner) + word(0) + '01';

/** Concatenate signatures sorted by signer ascending, as checkNSignatures requires. */
export const pack = (sigs) =>
  '0x' + sigs.slice().sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1)).map((x) => strip(x.sig)).join('');

/** Owners that have called approveHash(hash) on this Safe. */
export const approvedBy = async (s, hash) => {
  const r = await Promise.all(s.owners.map((o) => call(s.address, cd(S.approvedHashes, o, hash)).then(u)));
  return s.owners.filter((_, i) => r[i] > 0n);
};

export const approveData = (hash, payload = '0x') => cd(S.approveHash, hash) + strip(payload);
export const execData = (t, sigs) => cd(S.execTransaction, ...fields(t).slice(0, 9), B(sigs));
