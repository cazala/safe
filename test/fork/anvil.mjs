// Test harness: an Anvil mainnet fork at a pinned block, an EIP-1193 provider
// backed by it, and helpers to deploy real Safe v1.3.0 / v1.4.1 proxies.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { cd, B, a as addrAt, ZERO } from '../../src/abi.js';
import { S } from '../../src/sel.js';

export const FORK_URL = process.env.FORK_URL || 'https://ethereum-rpc.publicnode.com';
export const FORK_BLOCK = Number(process.env.FORK_BLOCK || 26071000);
const ANVIL = process.env.ANVIL || homedir() + '/.foundry/bin/anvil';

// Anvil's default mnemonic accounts (unlocked on the node).
export const ACCOUNTS = [
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
];
export const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f8b60e5b92d1e2e89c3a79c5ddc3d8e2d1a8ad8f5c1',
];

export const V = {
  '1.3.0': {
    singleton: '0xd9db270c1b5e3bd161e8c8503c55ceabee709552',
    factory: '0xa6b71e26c5e0845f74c812102ca7114b6a896ab2',
    fallback: '0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4',
  },
  '1.4.1': {
    singleton: '0x41675c099f32341bf84bfc5382af534df5c7461a',
    factory: '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67',
    fallback: '0xfd0732dc9e303f09fcef3a7388ad10a83459ec99',
  },
};

/** Start a fork. Returns { url, provider, rpc, stop }. */
export async function startFork(port = 18545 + Math.floor(Math.random() * 1000), { url: forkUrl = FORK_URL, block = FORK_BLOCK } = {}) {
  const args = ['--fork-url', forkUrl, '--port', String(port), '--silent', ...(block ? ['--fork-block-number', String(block)] : [])];
  const proc = spawn(ANVIL, args, {
    stdio: 'ignore',
  });
  const url = 'http://127.0.0.1:' + port;
  let id = 0;
  const rpc = async (method, params = []) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }).then((r) => r.json());
    if (r.error) throw Object.assign(Error(r.error.message), { code: r.error.code, data: r.error.data });
    return r.result;
  };
  for (let i = 0; ; i++) {
    try {
      await rpc('eth_chainId');
      break;
    } catch (e) {
      if (i > 150) throw Error('anvil did not start: ' + e.message);
      await new Promise((f) => setTimeout(f, 200));
    }
  }
  // The well-known anvil keys are EIP-7702-delegated to sweeper contracts on mainnet.
  // Clear that code on the fork so they behave as plain EOAs, and fund them.
  for (const acc of ACCOUNTS) {
    await rpc('anvil_setCode', [acc, '0x']);
    await rpc('anvil_setBalance', [acc, '0x' + (10n ** 21n).toString(16)]);
  }
  // `from` selects which unlocked anvil account the "wallet" uses.
  const provider = { from: ACCOUNTS[0], request: ({ method, params }) => rpc(method, params) };
  return { url, rpc, provider, stop: () => proc.kill() };
}

/** Send a tx from an unlocked account and wait for success. */
export async function tx(rpc, from, to, data = '0x', value = 0n) {
  const h = await rpc('eth_sendTransaction', [{ from, to, data, value: '0x' + value.toString(16) }]);
  let r;
  while (!(r = await rpc('eth_getTransactionReceipt', [h]))) await new Promise((f) => setTimeout(f, 20));
  if (r.status !== '0x1') throw Error('reverted');
  return r;
}

/** Deploy a Safe of the given version with owners/threshold. Returns its address. */
export async function deploySafe(rpc, version, owners, threshold, salt = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))) {
  const v = V[version];
  const init = cd(S.setup, owners, threshold, ZERO, B('0x'), v.fallback, ZERO, 0, ZERO);
  const data = cd(S.createProxyWithNonce, v.singleton, B(init), salt);
  const predicted = addrAt(await rpc('eth_call', [{ from: ACCOUNTS[0], to: v.factory, data }, 'latest']));
  await tx(rpc, ACCOUNTS[0], v.factory, data);
  return predicted;
}
