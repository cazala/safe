// Recognize Zodiac modules and guards: most are EIP-1167 minimal proxies to a canonical
// mastercopy (gnosisguild/zodiac src/contracts.ts). Recognition is by exact address match.
import { a, keccakHex, strip, word } from './abi.js';
import { matchCall } from './abicoder.js';
import { call, rpc } from './rpc.js';

const KNOWN = {
  'Roles 1.0.0': '85388a8cd772b19a468f982dc264c238856939c9',
  'Roles 1.1.0': 'd8dfc1d938d7d163c5231688341e9635e9011889',
  'Roles 2.1.0': '9646fdad06d3e24444381f44362a3b0eb343d337',
  'Roles 2.1.1': 'f2964ce6161ce0e75964fe7927ce114cb0b283d5',
  'Delay 1.0.0': 'd62129bf40cd1694b3d9d9847367783a1a4d5cb4',
  'Delay 1.0.1': 'd54895b1121a2ee3f37b502f507631fa1331bed6',
  'Delay 1.1.0': '01f8cabb808d7de0df4202d4b60c8310d2f1339b',
  'Delay 1.1.1': '824175b945838d127c1ca83cbce11d8e44f6df01',
  'Reality.eth 2.0.0': '4e35da39fa5893a70a40ce964f993d891e607cc0',
  'Reality ERC-20 2.0.0': '7276813b21623d89ba8984b225d5792943dd7dbf',
  'Bridge 1.0.0': '03b5ebd2cb2e3339e93774a1eb7c8634b8c393a9',
  'Exit ERC-20 1.0.0': '35e35dcdc7cd112b93c7c55987c86e5d6d419c69',
  'Exit ERC-20 1.1.0': '33bca41bda8a3983afbad8fc8936ce2fb29121da',
  'Exit ERC-20 1.2.0': '3ed380a282adfa3460da28560ebeb2f6d967c9f5',
  'Exit ERC-721 1.1.0': 'd3579c14a4181efc3df35c3103d20823a8c8d718',
  'Exit ERC-721 1.2.0': 'e0ece32eb4be4e9224dcec6a4fcb335c1fe05cde',
  'Scope Guard 1.0.0': 'ef27fcd3965a866b22fb2d7c689de9ab7e611f1f',
  'Meta Guard 1.0.0': 'e2847462a574bfd43014d1c7bb6de5769c294691',
  'Optimistic Governor 1.2.0': '28cebfe94a03dbca9d17143e9d2bd1155dc26d5d',
  'Tellor 2.1.0': 'a89ec2c1e218cfbb0f82829e95352ceabdee9a69',
  'Connext 1.0.0': '7de07b9de0bf0fabf31a188de1527034b2af36db',
};
// Versions the Zodiac team lists as faulty.
const FAULTY = ['Roles 2.1.0', 'Delay 1.1.0'];

const nameOf = (impl) => Object.keys(KNOWN).find((k) => KNOWN[k] === strip(impl).toLowerCase()) || null;

// Zodiac's ModuleProxyFactory 1.0.0, 1.1.0 and 1.2.0 (gnosisguild/zodiac src/contracts.ts). All three deploy
// an EIP-1167 proxy to the mastercopy with CREATE2, salt = keccak256(keccak256(initializer) ‖ saltNonce).
export const FACTORIES = ['0x00000000062c52e29e8029dc2413172f6d619d85', '0x00000000000dc7f163742eb4abef650037b1f588', '0x000000000000addb49795b0f9ba5bc298cdda236'];
// setUp(bytes initParams) layouts, from the modules' sources: owner, avatar, target first; the number of words.
const SETUP = { Roles: 3, Delay: 5 }; // Delay adds cooldown, expiration

/**
 * A call to a Zodiac ModuleProxyFactory's deployModule, decoded exactly: { masterCopy, name, faulty, proxy
 * (the address it will deploy), saltNonce, initializer, setup: { owner, avatar, target } | null }; else null.
 */
export function deployModuleOf(t) {
  if (!FACTORIES.includes(t.to)) return null;
  const m = matchCall(['deployModule(address masterCopy, bytes initializer, uint256 saltNonce)'], t.data);
  if (!m) return null;
  const [masterCopy, initializer, saltNonce] = m.values, name = nameOf(masterCopy);
  const salt = keccakHex(keccakHex(initializer) + word(saltNonce));
  const code = '0x602d8060093d393df3363d3d373d3d3d363d73' + strip(masterCopy) + '5af43d82803e903d91602b57fd5bf3';
  const proxy = '0x' + strip(keccakHex('0xff' + strip(t.to) + strip(salt) + strip(keccakHex(code)))).slice(24);
  // The settings, only for layouts known exactly: setUp(bytes) whose bytes are exactly those words, addresses clean.
  const words = name && SETUP[name.split(' ')[0]], s = words && matchCall(['setUp(bytes initParams)'], initializer);
  const p = s ? strip(s.values[0]) : '', clean = (i) => p.slice(64 * i, 64 * i + 24) === '0'.repeat(24), at = (i) => '0x' + p.slice(64 * i + 24, 64 * i + 64);
  const setup = s && p.length === 64 * words && clean(0) && clean(1) && clean(2) ? { owner: at(0), avatar: at(1), target: at(2) } : null;
  return { masterCopy, name, faulty: FAULTY.includes(name), proxy, saltNonce, initializer, setup };
}

/** { name, impl, faulty, proxy, owner, empty } for a module/guard address; name is null if unknown, empty if no code. */
export async function identify(addr) {
  const code = strip(await rpc('eth_getCode', [addr, 'latest'])).toLowerCase();
  const m = /^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/.exec(code);
  const impl = m ? m[1] : strip(addr).toLowerCase();
  const name = nameOf(impl);
  const owner = name ? await call(addr, '0x8da5cb5b').then((r) => a(r), () => null) : null; // owner()
  return { name, impl: '0x' + impl, proxy: !!m, faulty: FAULTY.includes(name), owner, empty: !code };
}
