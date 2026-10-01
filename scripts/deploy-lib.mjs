// Deterministic ERC-8244 deployment of dist/index.html.
// Every contract goes through the canonical CREATE2 deployer (Arachnid's
// 0x4e59b448…), so addresses depend only on content + salt, never on who deploys.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { keccak256 } from 'viem';
import { bytes, encode, hex, keccakHex, keccakText, str, strip, u } from '../src/abi.js';

export const DEPLOYER = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
export const CHUNK = 24575; // EIP-170 limit minus the leading STOP byte
const root = new URL('..', import.meta.url).pathname;

/** SSTORE2-style initcode: returns 0x00 ‖ data as the runtime code. */
export function dataInitcode(data) {
  const n = data.length + 1;
  return '0x61' + n.toString(16).padStart(4, '0') + '80600a3d393df3' + '00' + strip(hex(data));
}

/** Leading zero hex digits mined into the app contract's address (docs/deploy.md → Vanity address). */
export const VANITY = 5;
/**
 * The first salt, counting from 0, that puts `zeros` zero hex digits at the start of the CREATE2 address of
 * `initcode`. Deterministic: the same initcode always gives the same salt, so the deploy script and the deployer
 * page agree without sharing state. 5 digits take about a million tries (seconds).
 */
export function mineSalt(initcode, zeros) {
  const buf = new Uint8Array(85), full = zeros >> 1, half = zeros & 1;
  buf[0] = 0xff;
  buf.set(bytes(DEPLOYER), 1);
  buf.set(bytes(keccakHex(initcode)), 53);
  for (let n = 0; n < 2 ** 32; n++) {
    buf[49] = n >>> 24; buf[50] = (n >>> 16) & 255; buf[51] = (n >>> 8) & 255; buf[52] = n & 255;
    const h = keccak256(buf, 'bytes');
    let ok = true;
    for (let i = 0; i < full && ok; i++) ok = h[12 + i] === 0;
    if (ok && (!half || h[12 + full] < 16)) return '0x' + n.toString(16).padStart(64, '0');
  }
  throw Error('no salt found');
}

export const create2 = (salt, initcode) => '0x' + strip(keccakHex('0xff' + strip(DEPLOYER) + strip(salt) + strip(keccakHex(initcode)))).slice(24);

export function compile() {
  const home = homedir() + '/.foundry/bin/forge';
  const forge = process.env.FORGE || (existsSync(home) ? home : 'forge');
  execFileSync(forge, ['build', '--root', root], { stdio: 'ignore' });
  return JSON.parse(readFileSync(root + 'out/SafeWeiApp.sol/SafeWeiApp.json', 'utf8')).bytecode.object;
}

const indexOf = (b, m) => {
  outer: for (let i = 0; i + m.length <= b.length; i++) {
    for (let j = 0; j < m.length; j++) if (b[i + j] !== m[j]) continue outer;
    return i;
  }
  return -1;
};

/** Plan: the ordered list of CREATE2 deployments and their resulting addresses. */
// `vanity`: mine the app contract's own salt for that many leading zero hex digits. The chunks keep `salt`, so they
// keep their addresses (and are reused) whatever the app's salt is.
export function plan(html, bytecode, salt = '0x' + '00'.repeat(32), { vanity = 0 } = {}) {
  const b = typeof html === 'string' ? new TextEncoder().encode(html) : html;
  const steps = [];
  // A page built with a config head is cut right after <!--config-->: the head is its own tiny chunk,
  // so replacing the config only changes that chunk (the rest keeps its addresses).
  const marker = new TextEncoder().encode('<!--config-->');
  const at = indexOf(b, marker), cut = at >= 0 && at + marker.length <= CHUNK ? at + marker.length : 0;
  const add = (part) => {
    const init = dataInitcode(part);
    steps.push({ name: 'chunk ' + steps.length, salt, initcode: init, address: create2(salt, init) });
  };
  if (cut) add(b.subarray(0, cut));
  for (let i = cut; i < b.length; i += CHUNK) add(b.subarray(i, i + CHUNK));
  const chunks = steps.map((s) => s.address);
  const init = bytecode + encode([chunks]), appSalt = vanity ? mineSalt(init, vanity) : salt;
  steps.push({ name: 'SafeWeiApp', salt: appSalt, initcode: init, address: create2(appSalt, init) });
  return { salt, appSalt, steps, chunks, app: steps.at(-1).address, contentHash: keccakHex(hex(b)), size: b.length };
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
    const rc = await send({ to: DEPLOYER, data: s.salt + strip(s.initcode) });
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
