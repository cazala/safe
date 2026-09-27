import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { compile, CHUNK, deploy, plan, verify } from '../../scripts/deploy-lib.mjs';
import { ACCOUNTS, startFork } from './anvil.mjs';

const root = new URL('../..', import.meta.url).pathname;
const abi = parseAbi([
  'function html() view returns (string)',
  'function request(string[], (string key, string value)[]) view returns (uint16, string, (string key, string value)[])',
  'function resolveMode() pure returns (bytes32)',
  'function chunks() view returns (address[])',
]);
let f, bytecode;
before(async () => {
  f = await startFork();
  bytecode = compile();
});
after(() => f.stop());

const send = async (tx) => {
  const h = await f.rpc('eth_sendTransaction', [{ from: ACCOUNTS[0], ...tx }]);
  let r;
  while (!(r = await f.rpc('eth_getTransactionReceipt', [h]))) await new Promise((x) => setTimeout(x, 20));
  return r;
};
const call = async (to, functionName, args = []) =>
  decodeFunctionResult({ abi, functionName, data: await f.rpc('eth_call', [{ to, data: encodeFunctionData({ abi, functionName, args }) }, 'latest']) });

test('dist/index.html deploys and html() returns it byte for byte', async () => {
  const html = readFileSync(root + 'dist/index.html', 'utf8');
  const p = plan(html, bytecode);
  const gas = await deploy(p, f.rpc, send);
  const v = await verify(p, f.rpc, html);
  assert.equal(await call(p.app, 'html'), html);
  assert.equal(v.size, Buffer.byteLength(html));
  assert.deepEqual((await call(p.app, 'chunks')).map((a) => a.toLowerCase()), p.chunks);
  console.log('# deployment gas ' + gas + ' for ' + v.size + ' B in ' + p.chunks.length + ' chunk(s); app runtime ' + v.runtimeBytes + ' B');
  // idempotent: a second run deploys nothing
  assert.equal(await deploy(p, f.rpc, send), 0n);
});

test('ERC-5219 request() and resolveMode()', async () => {
  const html = readFileSync(root + 'dist/index.html', 'utf8');
  const p = plan(html, bytecode);
  await deploy(p, f.rpc, send);
  const [status, body, headers] = await call(p.app, 'request', [['index.html'], []]);
  assert.equal(status, 200);
  assert.equal(body, html);
  assert.equal(headers[0].value, 'text/html; charset=utf-8');
  assert.equal(Buffer.from((await call(p.app, 'resolveMode')).slice(2, 10), 'hex').toString(), '5219');
});

test('multi-chunk pages reassemble in order, including multi-byte UTF-8 across boundaries', async () => {
  const page = '<!doctype html>' + '✓é€'.repeat(Math.ceil((CHUNK * 2.5) / 9)) + '</html>';
  const p = plan(page, bytecode, '0x' + '01'.repeat(32));
  assert.equal(p.chunks.length, 3);
  await deploy(p, f.rpc, send);
  assert.equal(await call(p.app, 'html'), page);
  await verify(p, f.rpc, page);
});

test('data contracts cannot be executed (leading STOP)', async () => {
  const p = plan('<p>x</p>', bytecode, '0x' + '02'.repeat(32));
  await deploy(p, f.rpc, send);
  assert.equal(await f.rpc('eth_call', [{ to: p.chunks[0], data: '0x' }, 'latest']), '0x');
  assert.equal(await f.rpc('eth_getCode', [p.chunks[0], 'latest']), '0x00' + Buffer.from('<p>x</p>').toString('hex'));
});
