// Test wallet for local development only: an injected EIP-1193 provider that forwards
// every request to an Anvil node and uses its unlocked accounts (?acct=N picks one).
// Never part of any build.
export const shim = (url) => `<script>(()=>{
let id=0;const L={};
const rpc=async(method,params=[])=>{const r=await fetch(${JSON.stringify(url)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}).then(r=>r.json());if(r.error)throw Object.assign(Error(r.error.message),r.error);return r.result};
const n=Number(new URLSearchParams(location.search).get('acct')||0);
const p={isDevAnvil:true,
request:async({method,params})=>{if(method==='eth_requestAccounts'||method==='eth_accounts'){const a=await rpc('eth_accounts');return[a[n]]}if(method==='wallet_revokePermissions')return null;return rpc(method,params)},
on:(e,f)=>(L[e]=L[e]||[]).push(f),removeListener(){}};
// Announce through EIP-6963 so it can be picked next to a real wallet extension,
// and fill window.ethereum only when no extension has taken it.
const info=Object.freeze({uuid:'00000000-0000-4000-8000-00000000a771',name:'Anvil test wallet (dev)',icon:'data:,',rdns:'dev.anvil.test'});
const ann=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:Object.freeze({info,provider:p})}));
window.addEventListener('eip6963:requestProvider',ann);ann();
try{if(!window.ethereum)window.ethereum=p}catch{}
})()</script>`;
