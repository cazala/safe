// Conformance against the real WalletConnect relay: the official SDK plays the dapp, safe.wei's
// src/wc.js plays the wallet. Needs the network; run with `node --test test/net/`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SignClient } from '@walletconnect/sign-client';
import { create } from '../../src/wc.js';

const projectId = JSON.parse(readFileSync(new URL('../../config/walletconnect.json', import.meta.url), 'utf8')).projectId;
const SAFE = '0x3134dc9d36eac30aa69fe40b22b1311cabc12ec3';
const METHODS = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'eth_chainId', 'eth_accounts'];

test('official dapp SDK ↔ safe.wei wallet: pair, approve, request, respond, disconnect', { timeout: 120000 }, async () => {
  const dapp = await SignClient.init({ projectId, metadata: { name: 'Test dapp', description: 'conformance', url: 'https://example.invalid', icons: [] } });
  let saved = null;
  const events = [];
  const wallet = create({ projectId: () => projectId, load: () => saved, save: (s) => (saved = JSON.parse(JSON.stringify(s))), onEvent: (e) => events.push(e) });
  try {
    const { uri, approval } = await dapp.connect({ optionalNamespaces: { eip155: { chains: ['eip155:1'], methods: METHODS, events: ['chainChanged', 'accountsChanged'] } } });
    const proposal = await wallet.pair(uri);
    assert.equal(proposal.proposer.metadata.name, 'Test dapp');
    const s = await wallet.approve(proposal, { chainId: 1, account: SAFE, metadata: { name: 'safe.wei', description: 'Safe', url: 'https://safe.wei', icons: [] }, methods: METHODS, events: ['chainChanged', 'accountsChanged'] });
    const session = await approval();
    assert.deepEqual(session.namespaces.eip155.accounts, ['eip155:1:' + SAFE]);
    assert.equal(session.topic, s.topic);

    // The dapp asks for a signature; the wallet answers.
    const asked = dapp.request({ topic: session.topic, chainId: 'eip155:1', request: { method: 'personal_sign', params: ['0x68656c6c6f', SAFE] } });
    let req;
    for (let i = 0; i < 200 && !(req = events.find((e) => e.type === 'request')); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(req, 'the request reached the wallet');
    assert.equal(req.request.method, 'personal_sign');
    assert.deepEqual(req.request.params, ['0x68656c6c6f', SAFE]);
    assert.equal(wallet.pending().length, 1);
    await wallet.respond(req.request.topic, req.request.id, '0x' + 'ab'.repeat(65));
    assert.equal(await asked, '0x' + 'ab'.repeat(65));
    assert.equal(wallet.pending().length, 0);

    // A rejection comes back as an error.
    const rejected = dapp.request({ topic: session.topic, chainId: 'eip155:1', request: { method: 'eth_sendTransaction', params: [{ from: SAFE, to: SAFE, value: '0x0', data: '0x' }] } });
    const outcome = rejected.then(() => null, (e) => e); // settle-safe: checked below
    let req2;
    for (let i = 0; i < 200 && !(req2 = events.filter((e) => e.type === 'request')[1]); i++) await new Promise((r) => setTimeout(r, 100));
    await wallet.respond(req2.request.topic, req2.request.id, null, { code: 4001, message: 'User rejected.' });
    assert.match(String((await outcome)?.message), /User rejected/);

    // The wallet disconnects; the dapp hears it.
    const gone = new Promise((r) => dapp.on('session_delete', r));
    await wallet.disconnect(session.topic);
    await gone;
    assert.equal(wallet.sessions().length, 0);
  } finally {
    await dapp.core.relayer.transportClose().catch(() => {});
  }
});

test('after a reload (a new client with the saved state) the wallet can still answer and disconnect', { timeout: 120000 }, async () => {
  const dapp = await SignClient.init({ projectId, metadata: { name: 'Test dapp', description: 'conformance', url: 'https://example.invalid', icons: [] } });
  let saved = null;
  const events = [];
  const mk = () => create({ projectId: () => projectId, load: () => saved, save: (x) => (saved = JSON.parse(JSON.stringify(x))), onEvent: (e) => events.push(e) });
  try {
    const first = mk();
    const { uri, approval } = await dapp.connect({ optionalNamespaces: { eip155: { chains: ['eip155:1'], methods: METHODS, events: [] } } });
    await first.approve(await first.pair(uri), { chainId: 1, account: SAFE, metadata: { name: 'safe.wei', description: 'Safe', url: 'https://safe.wei', icons: [] }, methods: METHODS, events: [] });
    const session = await approval();
    const reloaded = mk(); // same localStorage, new page: new relay connection
    await reloaded.restore();
    const asked = dapp.request({ topic: session.topic, chainId: 'eip155:1', request: { method: 'personal_sign', params: ['0x01', SAFE] } });
    let req;
    for (let i = 0; i < 200 && !(req = events.find((e) => e.type === 'request')); i++) await new Promise((r) => setTimeout(r, 100));
    await reloaded.respond(req.request.topic, req.request.id, '0x' + 'cd'.repeat(65));
    assert.equal(await asked, '0x' + 'cd'.repeat(65));
    const gone = new Promise((r) => dapp.on('session_delete', r));
    await reloaded.disconnect(session.topic);
    await gone;
  } finally {
    await dapp.core.relayer.transportClose().catch(() => {});
  }
});
