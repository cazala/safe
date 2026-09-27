// Supported chains. Addresses verified in docs/research.md (safe-global/safe-deployments,
// canonical deployments) and checked for code on chain in test/fork.
// Adding a chain = adding an entry; every field must be verified the same way.

export const CHAINS = {
  1: {
    name: 'Ethereum',
    sym: 'ETH',
    // Safe v1.4.1 (creation target)
    singleton: '0x41675c099f32341bf84bfc5382af534df5c7461a',
    factory: '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67',
    fallback: '0xfd0732dc9e303f09fcef3a7388ad10a83459ec99',
    multiSendCallOnly: '0x9641d764fc13c8b624c04430c7356c1c7c8102e2',
    multicall3: '0xca11bde05977b3631167028862be2a173976ca11',
    // mainnet-only registries
    ens: '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e',
    wns: '0x0000000000696760e15f265e828db644a0c242eb',
    tokenList: '0x0000006013df75a31678b786061c2b54bf531524',
  },
};

// Safe versions this app can operate. SafeTx typehash, domain, approveHash and
// execTransaction are identical across these.
export const VERSIONS = ['1.3.0', '1.4.1'];
