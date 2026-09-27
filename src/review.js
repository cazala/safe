// Transaction review: everything that must hold before any approve / sign / execute.
// `ok === false` means every action is disabled (spec §6, §15).
import { ZERO } from './abi.js';
import { chainTxHash, safeTxHash } from './safe.js';

export async function review(tx, s, walletChain) {
  const r = { tx, local: safeTxHash(tx), chain: null, errors: [], warnings: [] };
  const err = (m) => r.errors.push(m), warn = (m) => r.warnings.push(m);
  try {
    r.chain = await chainTxHash(tx);
  } catch (e) {
    err('Could not read getTransactionHash from the Safe: ' + e.message);
  }
  if (r.chain && r.chain !== r.local) err('FATAL: SafeTx hash mismatch. The locally computed hash differs from the Safe’s getTransactionHash. Do not sign.');
  if (tx.chainId !== walletChain) err('Transaction is for chain ' + tx.chainId + ' but the wallet is on chain ' + walletChain + '.');
  if (tx.safe !== s.address) err('Transaction is for a different Safe (' + tx.safe + ').');
  if (!s.supported) err('Unsupported Safe version "' + s.version + '".');
  if (tx.nonce < s.nonce) err('Nonce ' + tx.nonce + ' was already used (Safe nonce is ' + s.nonce + '). Rebuild the transaction.');
  if (tx.nonce > s.nonce) warn('Queued: nonce ' + tx.nonce + ' can only execute after nonce ' + s.nonce + ' has executed.');
  if (tx.operation === 1) warn('DANGEROUS: DELEGATECALL. The target code runs with full control of the Safe (owners, modules, funds).');
  if (tx.safeTxGas || tx.baseGas || tx.gasPrice || tx.gasToken !== ZERO || tx.refundReceiver !== ZERO) warn('Gas refund fields are non-zero: the executor may be paid from the Safe.');
  r.ok = !r.errors.length;
  return r;
}
