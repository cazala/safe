// Local playground: a mainnet fork on :8545 with demo Safes owned by anvil accounts.
//   node scripts/fork.mjs            then: node scripts/dev.mjs --anvil http://127.0.0.1:8545
import { ACCOUNTS, deploySafe, startFork, tx } from '../test/fork/anvil.mjs';

const f = await startFork(Number(process.env.PORT || 8545));
const one = await deploySafe(f.rpc, '1.4.1', [ACCOUNTS[0]], 1);
const two = await deploySafe(f.rpc, '1.4.1', ACCOUNTS.slice(0, 3), 2);
const old = await deploySafe(f.rpc, '1.3.0', ACCOUNTS.slice(0, 3), 2);
for (const s of [one, two, old]) await tx(f.rpc, ACCOUNTS[0], s, '0x', 10n ** 18n);
console.log(f.url);
console.log('1-of-1 v1.4.1 ', one);
console.log('2-of-3 v1.4.1 ', two);
console.log('2-of-3 v1.3.0 ', old);
console.log('owners        ', ACCOUNTS.slice(0, 3).join(' '));
process.on('SIGINT', () => (f.stop(), process.exit()));
setInterval(() => {}, 1 << 30);
