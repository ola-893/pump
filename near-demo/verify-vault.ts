import {readFileSync} from 'node:fs';
import {testnetReads} from './rpc.js';
import {testAccount} from './types.js';
import {ownedVaultAccount,type VaultConfig} from './agent-vaults.js';

/** Reads one finalized block and compares the contract with reviewed deployment pins. */
export async function verifiedVaultState(contractId:string){
 testAccount(contractId);
 const config=JSON.parse(readFileSync(new URL('../deployments/near-agent-vaults.json',import.meta.url),'utf8')) as VaultConfig;
 const pinned=config.vaults.find(v=>v.contractId===contractId);
 const factory=config.factory;
 const codeHash=pinned?.codeHash??(factory&&contractId.endsWith('.'+factory.id)?factory.vaultCodeHash:null);
 if(config.network!=='testnet'||!codeHash)throw new Error('Vault is outside the reviewed testnet deployment.');
 const rpc=testnetReads();
 const account=await rpc.query('query',{request_type:'view_account',finality:'final',account_id:contractId});
 const params={block_id:account.block_hash,account_id:contractId};
 const [response,keys]=await Promise.all([
  rpc.query('query',{...params,request_type:'call_function',method_name:'get_state',args_base64:Buffer.from('{}').toString('base64')}),
  rpc.query('query',{...params,request_type:'view_access_key_list'})
 ]);
 const state=JSON.parse(Buffer.from(response.result).toString());
 if(account.code_hash!==codeHash||!Array.isArray(keys.keys)||keys.keys.length!==0)throw new Error('Vault code or access keys differ from the reviewed deployment.');
 if(!pinned&&(!factory||state.factory_id!==factory.id||contractId!==ownedVaultAccount(state.strategy_id,state.controller_id,factory.id)))throw new Error('Vault differs from its owner and factory binding.');
 return {state,blockHeight:account.block_height,blockHash:account.block_hash,codeHash};
}
