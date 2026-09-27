// Deterministic ERC-8244 deployment of dist/index.html.
// Every contract goes through the canonical CREATE2 deployer (Arachnid's
// 0x4e59b448…), so addresses depend only on content + salt, never on who deploys.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { bytes, encode, hex, keccakHex, keccakText, str, strip, u } from '../src/abi.js';

export const DEPLOYER = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
export const CHUNK = 24575; // EIP-170 limit minus the leading STOP byte
const root = new URL('..', import.meta.url).pathname;

/** SSTORE2-style initcode: returns 0x00 ‖ data as the runtime code. */
export function dataInitcode(data) {
  const n = data.length + 1;
  return '0x61' + n.toString(16).padStart(4, '0') + '80600a3d393df3' + '00' + strip(hex(data));
}

export const create2 = (salt, initcode) => '0x' + strip(keccakHex('0xff' + strip(DEPLOYER) + strip(salt) + strip(keccakHex(initcode)))).slice(24);

export function compile() {
  const home = homedir() + '/.foundry/bin/forge';
  const forge = process.env.FORGE || (existsSync(home) ? home : 'forge');
  execFileSync(forge, ['build', '--root', root], { stdio: 'ignore' });
  return JSON.parse(readFileSync(root + 'out/SafeWeiApp.sol/SafeWeiApp.json', 'utf8')).bytecode.object;
}

/** Plan: the ordered list of CREATE2 deployments and their resulting addresses. */
export function plan(html, bytecode, salt = '0x' + '00'.repeat(32)) {
  const b = typeof html === 'string' ? new TextEncoder().encode(html) : html;
  const steps = [];
  for (let i = 0; i < b.length; i += CHUNK) {
    const init = dataInitcode(b.subarray(i, i + CHUNK));
    steps.push({ name: 'chunk ' + steps.length, initcode: init, address: create2(salt, init) });
  }
  const chunks = steps.map((s) => s.address);
  const init = bytecode + encode([chunks]);
  steps.push({ name: 'SafeWeiApp', initcode: init, address: create2(salt, init) });
  return { salt, steps, chunks, app: steps.at(-1).address, contentHash: keccakHex(hex(b)), size: b.length };
}

/**
 * Execute a plan. `rpc(method, params)` reads chain state; `send({to, data})`
 * submits a transaction and resolves to its receipt. Already-deployed steps are skipped.
 */
export async function deploy(p, rpc, send, log = () => {}) {
  if ((await rpc('eth_getCode', [DEPLOYER, 'latest'])) === '0x') throw Error('CREATE2 deployer missing on this chain');
  let gas = 0n;
  for (const s of p.steps) {
    if ((await rpc('eth_getCode', [s.address, 'latest'])) !== '0x') {
      log(s.name + ' already at ' + s.address);
      continue;
    }
    const rc = await send({ to: DEPLOYER, data: p.salt + strip(s.initcode) });
    if (rc.status !== '0x1') throw Error(s.name + ' deployment reverted');
    if ((await rpc('eth_getCode', [s.address, 'latest'])) === '0x') throw Error(s.name + ' not found at ' + s.address);
    gas += BigInt(rc.gasUsed);
    log(s.name + ' → ' + s.address + ' (' + BigInt(rc.gasUsed) + ' gas)');
  }
  return gas;
}

/** Verify the live contract serves exactly the built page. */
export async function verify(p, rpc, html) {
  const call = (sig) => rpc('eth_call', [{ to: p.app, data: keccakText(sig).slice(0, 10) }, 'latest']);
  if (str(await call('html()')) !== html) throw Error('html() does not match dist/index.html');
  const hash = '0x' + strip(await call('contentHash()'));
  if (hash !== p.contentHash) throw Error('contentHash() mismatch');
  const size = Number(u(await call('size()')));
  if (size !== new TextEncoder().encode(html).length) throw Error('size() mismatch');
  const code = await rpc('eth_getCode', [p.app, 'latest']);
  return { size, contentHash: hash, codeHash: keccakHex(code), runtimeBytes: bytes(code).length };
}
