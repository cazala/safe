import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFunctionData, parseAbi as viemParse, toFunctionSelector } from 'viem';
import { encodeCall, parseAbi, parseValue } from '../../src/abicoder.js';

const A = '0x' + '11'.repeat(20), B = '0x' + '22'.repeat(20);
const CASES = [
  ['function transfer(address to, uint256 amount)', [A, 5n]],
  ['function f(int8 a, int256 b, uint8 c, bool d)', [-1n, -(2n ** 200n), 255n, true]],
  ['function f(bytes data, string s, bytes32 h, bytes4 sel)', ['0xdeadbeef', 'héllo ✓', '0x' + 'ab'.repeat(32), '0x12345678']],
  ['function f(address[] a, uint256[3] b, string[] c)', [[A, B], [1n, 2n, 3n], ['x', '', 'yz']]],
  ['function f((address to, uint256 v) t, (address to, bytes d)[] ts)', [{ to: A, v: 9n }, [{ to: B, d: '0x01' }, { to: A, d: '0x' }]]],
  ['function f(uint256[][] m, (uint256 a, string b)[2] fx, bytes[2] bb)', [[[1n], [], [2n, 3n]], [{ a: 1n, b: 'a' }, { a: 2n, b: 'bb' }], ['0x', '0xff']]],
  ['function multicall(bytes[] data) payable', [['0x1234', '0x']]],
];

test('encodeCall matches viem for static, dynamic, array, fixed-array and tuple params', () => {
  for (const [sig, args] of CASES) {
    const [f] = parseAbi(sig);
    const abi = viemParse([sig]);
    const ours = encodeCall(f, args.map((a, i) => (f.inputs[i].type.startsWith('tuple') ? toArr(a) : a)));
    assert.equal(ours, encodeFunctionData({ abi, functionName: f.name, args }), sig);
    assert.equal('0x' + f.selector, toFunctionSelector(sig), sig);
  }
});
// viem takes tuples as objects; ours takes positional arrays (the form users type as JSON).
const toArr = (v) => (Array.isArray(v) ? v.map(toArr) : v && typeof v === 'object' ? Object.values(v).map(toArr) : v);

test('parseAbi reads JSON ABIs, artifacts and human-readable lines; write methods first', () => {
  const json = JSON.stringify([
    { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }], outputs: [] },
    { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [] },
    { type: 'function', name: 'swap', stateMutability: 'nonpayable', inputs: [{ name: 'p', type: 'tuple', components: [{ name: 'a', type: 'address' }, { name: 'n', type: 'uint256' }] }] },
    { type: 'event', name: 'X', inputs: [] },
  ]);
  const fs = parseAbi(json);
  assert.deepEqual(fs.map((f) => [f.name, f.write, f.payable]), [['deposit', true, true], ['swap', true, false], ['balanceOf', false, false]]);
  assert.equal(fs[1].sig, 'swap((address,uint256))');
  assert.equal(parseAbi(JSON.stringify({ abi: JSON.parse(json) })).length, 3);
  const hr = parseAbi('function approve(address spender, uint256 amount) external returns (bool)\nfunction name() view returns (string)\nsetStuff((address a, uint256[] b)[] items, bytes calldata data)');
  assert.deepEqual(hr.map((f) => f.sig), ['approve(address,uint256)', 'setStuff((address,uint256[])[],bytes)', 'name()']);
  assert.throws(() => parseAbi('[]'), /No functions/);
});

test('parseValue validates and converts user input', () => {
  const P = (type, extra) => ({ name: 'x', type, ...extra });
  assert.equal(parseValue(P('uint8'), '255'), 255n);
  assert.throws(() => parseValue(P('uint8'), '256'), /out of range/);
  assert.equal(parseValue(P('int16'), '-32768'), -32768n);
  assert.throws(() => parseValue(P('uint256'), '1.5'), /whole number/);
  assert.equal(parseValue(P('uint256'), '0xff'), 255n);
  assert.equal(parseValue(P('bool'), 'true'), true);
  assert.throws(() => parseValue(P('bytes4'), '0x12'), /exactly 4 bytes/);
  assert.throws(() => parseValue(P('address'), '0x12'), /not an address/);
  assert.deepEqual(parseValue(P('uint256[]'), '["1", 2]'), [1n, 2n]);
  assert.throws(() => parseValue(P('uint256[2]'), '[1]'), /exactly 2/);
  assert.deepEqual(parseValue(P('tuple', { components: [{ name: 'a', type: 'address' }, { name: 'b', type: 'bool' }] }), '["' + A + '", "false"]'), [A, false]);
  assert.throws(() => parseValue(P('address[]'), 'not json'), /JSON array/);
});
