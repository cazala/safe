// Tiny calldata decoder (spec §9). Decodes only exact, canonical encodings of a
// handful of selectors; anything else is shown raw. Never guesses.
import { strip } from './abi.js';
import { HANDLERS } from './chains.js';
import { S } from './sel.js';

const MAX = (1n << 256n) - 1n;
const A = 'address', U = 'uint256';

// selector → [label, safeSelfCall, ...[argName, type]]
const D = {
  [S.transfer]: ['ERC-20 transfer', 0, ['to', A], ['amount', U]],
  [S.approve]: ['ERC-20 approve', 0, ['spender', A], ['amount', U]],
  [S.transferFrom]: ['ERC-20 transferFrom', 0, ['from', A], ['to', A], ['amount', U]],
  [S.addOwnerWithThreshold]: ['Add owner', 1, ['owner', A], ['threshold', U]],
  [S.removeOwner]: ['Remove owner', 1, ['prevOwner', A], ['owner', A], ['threshold', U]],
  [S.swapOwner]: ['Replace owner', 1, ['prevOwner', A], ['oldOwner', A], ['newOwner', A]],
  [S.changeThreshold]: ['Change threshold', 1, ['threshold', U]],
  [S.enableModule]: ['Enable module', 1, ['module', A]],
  [S.disableModule]: ['Disable module', 1, ['prevModule', A], ['module', A]],
  [S.setGuard]: ['Set guard', 1, ['guard', A]],
  [S.setFallbackHandler]: ['Set fallback handler', 1, ['handler', A]],
};

/** Returns {label, args: [{name, type, value}], warnings, danger} or null for unknown/non-canonical calldata. */
export function decode(t) {
  const d = strip(t.data).toLowerCase(), spec = D[d.slice(0, 8)];
  if (!spec) return null;
  const [label, self, ...params] = spec;
  if (d.length !== 8 + 64 * params.length) return null;
  const args = [];
  for (let i = 0; i < params.length; i++) {
    const w = d.slice(8 + 64 * i, 72 + 64 * i), [name, type] = params[i];
    if (type === A && !w.startsWith('0'.repeat(24))) return null; // dirty address word: not canonical
    args.push({ name, type, value: type === A ? '0x' + w.slice(24) : BigInt('0x' + w) });
  }
  const v = Object.fromEntries(args.map((x) => [x.name, x.value]));
  const warnings = [], danger = [];
  if (self && t.to !== t.safe) warnings.push('This is a Safe-management call, but it targets another contract (' + t.to + '), not this Safe.');
  if (self && t.to === t.safe) {
    if (/owner|threshold/i.test(label)) warnings.push('Changes who controls this Safe. Check every address and the resulting threshold.');
    if (label === 'Enable module') danger.push('DANGEROUS: ENABLE MODULE. A module can execute any transaction from this Safe without owner signatures.');
    if (label === 'Set guard') danger.push('DANGEROUS: SET GUARD. A guard runs on every transaction and can block all future ones, including removing it.');
    if (label === 'Set fallback handler')
      HANDLERS[v.handler]
        ? warnings.push('Sets Safe’s canonical CompatibilityFallbackHandler ' + HANDLERS[v.handler] + '. It handles EIP-1271 signature checks and token callbacks for this Safe.')
        : danger.push('DANGEROUS: SET FALLBACK HANDLER. It receives every unknown call to the Safe and affects EIP-1271 signature validation.');
  }
  if (label === 'ERC-20 approve' && v.amount === MAX) danger.push('UNLIMITED APPROVAL: ' + v.spender + ' may spend the entire balance of this token, now and in the future.');
  return { label, args, warnings, danger };
}
