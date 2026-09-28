// Transaction review: everything that must hold before any approve / sign / execute.
// `ok === false` means every action is disabled (spec §6, §15).
import { strip, u, ZERO } from './abi.js';
import { decode } from './decode.js';
import { unpack } from './multisend.js';
import { rpc } from './rpc.js';
import { chainTxHash, safeTxHash } from './safe.js';
import { S } from './sel.js';

const ERC20_BOOL = [S.transfer, S.approve, S.transferFrom];

/** eth_call the inner call from the Safe. Returns a warning string or null. */
export async function simulate(t) {
  const calls = unpack(t);
  if (calls) {
    // Each inner call is simulated on its own from the Safe; effects of earlier calls are not applied.
    const w = await Promise.all(calls.map((c) => simulate({ ...t, ...c, operation: 0 })));
    return w.map((x, i) => x && 'Call ' + (i + 1) + ' (simulated independently): ' + x).filter(Boolean).join(' ') || null;
  }
  if (t.operation) return 'DELEGATECALL is not simulated.';
  const [code, ret] = await Promise.all([
    rpc('eth_getCode', [t.to, 'latest']),
    rpc('eth_call', [{ from: t.safe, to: t.to, data: t.data, value: '0x' + t.value.toString(16) }, 'latest']).catch((e) => ({ e })),
  ]);
  if (ret.e) return 'Simulation: this call REVERTS if executed now (' + (ret.e.message || ret.e) + ').';
  if (code === '0x' && t.data !== '0x') return 'The destination has no contract code, but the transaction carries calldata.';
  if (ERC20_BOOL.includes(strip(t.data).slice(0, 8)) && strip(ret).length === 64 && u(ret) === 0n)
    return 'Simulation: the token returned FALSE. The transfer would not happen, yet the Safe would report success.';
  return null;
}

export async function review(tx, s, walletChain) {
  const batch = unpack(tx);
  const r = { tx, local: safeTxHash(tx), chain: null, errors: [], warnings: [], danger: [], decoded: batch ? null : decode(tx), batch };
  const err = (m) => r.errors.push(m), warn = (m) => r.warnings.push(m);
  try {
    r.chain = await chainTxHash(tx);
  } catch (e) {
    err('Could not read getTransactionHash from the Safe: ' + e.message);
  }
  if (r.chain && r.chain !== r.local) err('FATAL: SafeTx hash mismatch. The locally computed hash differs from the Safe’s getTransactionHash. Do not sign.');
  if (tx.chainId !== walletChain) err('Transaction is for chain ' + tx.chainId + ' but the wallet is on chain ' + walletChain + '.');
  if (tx.safe !== s.address) err('Transaction is for a different Safe (' + tx.safe + ').');
  if (!s.supported) err('Unsupported Safe version "' + s.version + '". Versions before 1.3.0 use a different signing format.');
  if (s.supported && !s.tested) warn('This Safe runs version ' + s.version + ', which safe.wei was not tested with. The transaction hash still had to match the Safe’s own getTransactionHash.');
  if (tx.nonce < s.nonce) err('Nonce ' + tx.nonce + ' was already used (Safe nonce is ' + s.nonce + '). Rebuild the transaction.');
  if (tx.nonce > s.nonce) warn('Queued: nonce ' + tx.nonce + ' can only execute after nonce ' + s.nonce + ' has executed.');
  // A DELEGATECALL into an address without code does nothing, yet succeeds and burns the nonce.
  if (tx.operation === 1 && (await rpc('eth_getCode', [tx.to, 'latest']).catch(() => '0x')) === '0x')
    err('DELEGATECALL target ' + tx.to + ' has no code on this chain: the Safe would do nothing and still consume the nonce.' + (batch ? ' MultiSendCallOnly is not deployed here.' : ''));
  if (tx.operation === 1 && !batch) r.danger.push('DANGEROUS: DELEGATECALL. The target code runs with full control of the Safe (owners, modules, funds).');
  if (r.decoded) r.danger.push(...r.decoded.danger), r.warnings.push(...r.decoded.warnings);
  if (batch)
    r.inner = batch.map((c, i) => {
      const d = decode({ ...c, safe: tx.safe });
      if (d) r.danger.push(...d.danger.map((m) => 'Call ' + (i + 1) + ': ' + m)), r.warnings.push(...d.warnings.map((m) => 'Call ' + (i + 1) + ': ' + m));
      return { ...c, decoded: d };
    });
  if (tx.safeTxGas || tx.baseGas || tx.gasPrice || tx.gasToken !== ZERO || tx.refundReceiver !== ZERO) warn('Gas refund fields are non-zero: the executor may be paid from the Safe.');
  if (r.ok = !r.errors.length) {
    const w = await simulate(tx).catch((e) => 'Simulation failed: ' + e.message);
    if (w) warn(w);
  }
  return r;
}
