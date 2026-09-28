// safe.wei as the dapp: an owner's wallet (played by the official SDK) connects by the QR link,
// then answers signing requests. Over the real relay; run with `node --test --test-force-exit test/net/`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SignClient } from '@walletconnect/sign-client';
import { connector, provider } from '../../src/wc.js';

const projectId = JSON.parse(readFileSync(new URL('../../config/walletconnect.json', import.meta.url), 'utf8')).projectId;
const OWNER = '0x' + '5a'.repeat(20);
const until = async (f) => {
  for (let i = 0; i < 300; i++) {
    const x = f();
    if (x) return x;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('timed out');
};

test('owner wallet (official SDK) ↔ safe.wei dapp: connect by link, sign, reject, chain event, reload, disconnect both ways', { timeout: 180000 }, async () => {
  const wallet = await SignClient.init({ projectId, metadata: { name: 'Test wallet', description: 'conformance', url: 'https://example.invalid', icons: [] } });
  let saved = null;
  const events = [];
  const mk = () => connector({ projectId: () => projectId, load: () => saved, save: (x) => (saved = JSON.parse(JSON.stringify(x))), onEvent: (e) => events.push(e) });
  const requests = [];
  wallet.on('session_proposal', async ({ id, params }) => {
    const chains = params.optionalNamespaces.eip155.chains.filter((c) => c === 'eip155:1' || c === 'eip155:137');
    await wallet.approve({ id, namespaces: { eip155: { chains, accounts: chains.map((c) => c + ':' + OWNER), methods: params.optionalNamespaces.eip155.methods, events: params.optionalNamespaces.eip155.events } } });
  });
  wallet.on('session_request', (e) => requests.push(e));
  try {
    const conn = mk();
    let shown = null;
    const p = provider(conn, { rpcUrl: () => 'unused', chains: [1, 137, 8453], metadata: { name: 'safe.wei', description: 'Safe', url: 'https://safe.wei', icons: [] }, pair: (c) => ((shown = c.uri), () => (shown = 'hidden')) });
    const accounts = p.request({ method: 'eth_requestAccounts' });
    await until(() => shown && shown.startsWith('wc:'));
    await wallet.core.pairing.pair({ uri: shown });
    assert.deepEqual(await accounts, [OWNER]);
    assert.equal(shown, 'hidden', 'the QR code is hidden once connected');
    assert.deepEqual(conn.session().chains, [1, 137]);
    assert.equal(await p.request({ method: 'eth_chainId' }), '0x1');

    // Switching to an approved chain is local; an unapproved one is refused with 4902.
    const changes = [];
    p.on('chainChanged', (c) => changes.push(c));
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] });
    assert.equal(await p.request({ method: 'eth_chainId' }), '0x89');
    await assert.rejects(p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }), (e) => e.code === 4902);

    // A signing request reaches the wallet with the chain, and the answer comes back.
    const typed = JSON.stringify({ types: {}, domain: {}, primaryType: 'X', message: {} });
    const signed = p.request({ method: 'eth_signTypedData_v4', params: [OWNER, typed] });
    const r1 = await until(() => requests[0]);
    assert.equal(r1.params.chainId, 'eip155:137');
    assert.equal(r1.params.request.method, 'eth_signTypedData_v4');
    assert.deepEqual(r1.params.request.params, [OWNER, typed]);
    await wallet.respond({ topic: r1.topic, response: { id: r1.id, jsonrpc: '2.0', result: '0x' + '11'.repeat(65) } });
    assert.equal(await signed, '0x' + '11'.repeat(65));

    // A rejection keeps its code (4001), so the app shows "cancelled".
    const sent = p.request({ method: 'eth_sendTransaction', params: [{ from: OWNER, to: OWNER, value: '0x0', data: '0x' }] }).then(() => null, (e) => e);
    const r2 = await until(() => requests[1]);
    await wallet.respond({ topic: r2.topic, response: { id: r2.id, jsonrpc: '2.0', error: { code: 4001, message: 'User rejected.' } } });
    assert.equal((await sent).code, 4001);

    // The wallet switches chain: the dapp hears chainChanged.
    await wallet.emit({ topic: r1.topic, event: { name: 'chainChanged', data: 1 }, chainId: 'eip155:1' });
    await until(() => events.some((e) => e.type === 'chain'));
    assert.equal(conn.session().chainId, 1);

    // After a reload, a new connector with the saved state still gets answers.
    const again = mk();
    await again.restore();
    const signed2 = again.request('personal_sign', ['0x68656c6c6f', OWNER]);
    const r3 = await until(() => requests[2]);
    assert.equal(r3.params.chainId, 'eip155:1');
    await wallet.respond({ topic: r3.topic, response: { id: r3.id, jsonrpc: '2.0', result: '0x' + '22'.repeat(65) } });
    assert.equal(await signed2, '0x' + '22'.repeat(65));

    // The wallet disconnects: the dapp forgets the session.
    await wallet.disconnect({ topic: r3.topic, reason: { code: 6000, message: 'bye' } });
    await until(() => events.some((e) => e.type === 'disconnect'));
    assert.equal(again.session(), null);

    // Connect again; this time safe.wei disconnects and the wallet hears it.
    const c = await again.connect({ chains: [1], methods: ['personal_sign'], events: [], metadata: { name: 'safe.wei', description: 'Safe', url: 'https://safe.wei', icons: [] } });
    await wallet.core.pairing.pair({ uri: c.uri });
    const s2 = await c.approved;
    const gone = new Promise((r) => wallet.on('session_delete', r));
    await again.disconnect();
    assert.equal((await gone).topic, s2.topic);
    assert.equal(again.session(), null);
  } finally {
    await wallet.core.relayer.transportClose().catch(() => {});
  }
});

