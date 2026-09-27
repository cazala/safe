// Safe protocol: state reads. Everything is read from the Safe contract itself.
import { a, arr, str, u, ZERO } from './abi.js';
import { VERSIONS } from './chains.js';
import { call, chainId, rpc } from './rpc.js';
import { S } from './sel.js';

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
