// Recognize Zodiac modules and guards: most are EIP-1167 minimal proxies to a canonical
// mastercopy (gnosisguild/zodiac src/contracts.ts). Recognition is by exact address match.
import { a, strip } from './abi.js';
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

/** { name, impl, faulty, proxy, owner } for a module/guard address; name is null if unknown. */
export async function identify(addr) {
  const code = strip(await rpc('eth_getCode', [addr, 'latest'])).toLowerCase();
  const m = /^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/.exec(code);
  const impl = m ? m[1] : strip(addr).toLowerCase();
  const name = Object.keys(KNOWN).find((k) => KNOWN[k] === impl) || null;
  const owner = name ? await call(addr, '0x8da5cb5b').then((r) => a(r), () => null) : null; // owner()
  return { name, impl: '0x' + impl, proxy: !!m, faulty: FAULTY.includes(name), owner };
}
