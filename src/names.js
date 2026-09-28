// ENS and .wei name resolution (spec §25), onchain only. Names are a convenience:
// transactions always commit to the resolved address.
import { a, B, cd, dbytes, hex, keccakHex, keccakText, str, strip, utf8, ZERO } from './abi.js';
import { MAINNET } from './chains.js';
import { call } from './rpc.js';
import { S, T } from './sel.js';

// Lowercase ASCII labels only: no normalization library, no lookalike characters.
const NAME = /^([a-z0-9-]+\.)+(eth|wei)$/;
export const isName = (s) => NAME.test(s);

export function checkName(s) {
  if (isName(s)) return s;
  throw Error(
    /\.(eth|wei)$/i.test(s)
      ? 'Unsupported name "' + s + '": only lowercase letters, digits and hyphens are accepted (no uppercase, no accents or other scripts).'
      : 'Enter a 0x address or a .eth / .wei name.',
  );
}

export const namehash = (name) =>
  name.split('.').reverse().reduce((node, label) => keccakHex(node + strip(keccakText(label))), '0x' + '00'.repeat(32));

const dns = (name) => hex(Uint8Array.from(name.split('.').flatMap((l) => [l.length, ...utf8(l)]).concat(0)));

class Offchain extends Error {}
const OFFCHAIN = "This name's records are off chain (CCIP-read). safe.wei reads only onchain state, so it cannot resolve it.";

/** eth_call that turns an OffchainLookup revert into an Offchain error. */
async function ccall(to, data) {
  try {
    return await call(to, data);
  } catch (e) {
    const blob = JSON.stringify([e && e.data, e && e.message]);
    if (blob.includes(T.OffchainLookup)) throw new Offchain(OFFCHAIN);
    throw e;
  }
}

async function ens(name) {
  const reg = MAINNET.ens, node = namehash(name);
  // Find the resolver for the name, or the nearest ancestor's (ENSIP-10 wildcard).
  let labels = name.split('.'), resolver = ZERO, exact = true;
  while (labels.length > 1) {
    resolver = a(await call(reg, cd(S.resolver, namehash(labels.join('.')))));
    if (resolver !== ZERO) break;
    labels = labels.slice(1);
    exact = false;
  }
  if (resolver === ZERO) return ZERO;
  const addrCall = cd(S.addr, node);
  if (exact) {
    try {
      return a(await ccall(resolver, addrCall));
    } catch (e) {
      if (e instanceof Offchain) throw e; // otherwise fall through to ENSIP-10
    }
  }
  try {
    const inner = dbytes(await ccall(resolver, cd(S.resolve, B(dns(name)), B(addrCall))));
    return strip(inner).length === 64 ? a(inner) : ZERO;
  } catch (e) {
    if (e instanceof Offchain) throw e;
    return ZERO;
  }
}

/** Resolve a .eth or .wei name to an address on mainnet. Throws if not found. */
export async function resolveName(name, chainId) {
  checkName(name);
  if (chainId !== 1) throw Error('ENS and .wei names resolve on Ethereum only. On this chain, use the 0x address.');
  const addr = name.endsWith('.wei') ? a(await call(MAINNET.wns, cd(S.wnsResolve, namehash(name)))) : await ens(name);
  if (addr === ZERO) throw Error(name + ' does not resolve to an address' + (name.endsWith('.wei') ? ' (unregistered or expired).' : '.'));
  return addr;
}

/** Reverse name for display only: WNS primary name, else ENS reverse with a forward check. */
export async function nameOf(addr, chainId) {
  if (chainId !== 1) return null;
  addr = addr.toLowerCase();
  try {
    const w = str(await call(MAINNET.wns, cd(S.reverseResolve, addr)));
    if (isName(w)) return w; // WNS verifies the forward record itself
  } catch {}
  try {
    const node = namehash(strip(addr) + '.addr.reverse');
    const resolver = a(await call(MAINNET.ens, cd(S.resolver, node)));
    if (resolver === ZERO) return null;
    const n = str(await call(resolver, cd(S.name, node)));
    return isName(n) && (await resolveName(n, 1)) === addr ? n : null;
  } catch {
    return null;
  }
}
