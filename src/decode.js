// Tiny calldata decoder (spec §9). Decodes only exact, canonical encodings of a
// handful of selectors; anything else is shown raw. Never guesses.
import { strip } from './abi.js';
import { handlerName } from './chains.js';
import { S } from './sel.js';
import { deployModuleOf } from './zodiac.js';

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
  const z = deployModuleOf(t);
  if (z) return deployModule(z, t);
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
      handlerName(v.handler)
        ? warnings.push('Sets Safe’s ' + handlerName(v.handler) + ' as the fallback handler. It handles EIP-1271 signature checks and token callbacks for this Safe.')
        : danger.push('DANGEROUS: SET FALLBACK HANDLER. It receives every unknown call to the Safe and affects EIP-1271 signature validation.');
  }
  if (label === 'ERC-20 approve' && v.amount === MAX) danger.push('UNLIMITED APPROVAL: ' + v.spender + ' may spend the entire balance of this token, now and in the future.');
  return { label, args, warnings, danger };
}

/** Zodiac's deployModule: what is deployed, where, and who will control it. */
function deployModule(z, t) {
  const warnings = [], danger = [], o = z.setup;
  const args = [
    { name: 'module', type: A, value: z.masterCopy },
    { name: 'new module', type: A, value: z.proxy },
    ...(o ? ['owner', 'avatar', 'target'].map((k) => ({ name: k, type: A, value: o[k] })) : [{ name: 'initializer', type: 'bytes', value: z.initializer }]),
    { name: 'saltNonce', type: U, value: z.saltNonce },
  ];
  if (!z.name) warnings.push('Deploys a copy of ' + z.masterCopy + ', which is not a Zodiac module safe.wei knows.');
  if (z.faulty) warnings.push('Zodiac lists ' + z.name + ' as a faulty version.');
  if (z.name && !o) warnings.push('The new module’s settings (initializer) are not decoded: check them where this transaction was built.');
  if (o && o.owner !== t.safe) danger.push('DANGEROUS: THE NEW MODULE’S OWNER IS ' + o.owner + ', NOT THIS SAFE. Its owner can change what the module allows, without the owners.');
  if (o && o.avatar !== t.safe) warnings.push('The new module’s avatar is ' + o.avatar + ', not this Safe: it acts for that account.');
  if (o && o.target !== t.safe) warnings.push('The new module’s target is ' + o.target + ', not this Safe: it executes through that account.');
  return { label: 'Deploy module' + (z.name ? ': Zodiac ' + z.name : ''), args, warnings, danger, proxy: z.proxy, module: z.name };
}
