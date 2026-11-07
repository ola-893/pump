import test from 'node:test';
import assert from 'node:assert/strict';
import type { NearConnector } from '@hot-labs/near-connect';
import { rememberWalletAccount, withAccountWallet } from '../app/src/lib/near-wallet-account.js';

function fixture(walletId='meteor-wallet') {
 const wallet={manifest:{id:walletId},getAccounts:async()=>[{accountId:'alice.testnet'},{accountId:'bob.testnet'}]};
 let selected='bob.testnet',connections=0,approvals=0;
 const connector={network:'testnet',wallet:async()=>wallet,connect:async()=>{
  connections++;rememberWalletAccount(walletId,[{accountId:selected}]);return wallet;
 }} as unknown as NearConnector;
 return {connector,action:async()=>{approvals++;return 'approved';},setSelected:(account:string)=>{selected=account;},
  counts:()=>({connections,approvals})};
}

test('Meteor reconnects before signing with a different listed account',async()=>{
 const f=fixture();
 rememberWalletAccount('meteor-wallet',[{accountId:'alice.testnet'}]);
 assert.equal(await withAccountWallet(f.connector,'bob.testnet',f.action),'approved');
 assert.deepEqual(f.counts(),{connections:1,approvals:1});
 await withAccountWallet(f.connector,'bob.testnet',f.action);
 assert.deepEqual(f.counts(),{connections:1,approvals:2});
 rememberWalletAccount('meteor-wallet',[]);
});

test('choosing the wrong account in Meteor never opens the transaction approval',async()=>{
 const f=fixture();f.setSelected('alice.testnet');
 rememberWalletAccount('meteor-wallet',[]);
 await assert.rejects(withAccountWallet(f.connector,'bob.testnet',f.action),/Connect bob.testnet in Meteor/);
 assert.deepEqual(f.counts(),{connections:1,approvals:0});
 rememberWalletAccount('meteor-wallet',[]);
});

test('wallets with signerId support keep their connected-account selection',async()=>{
 const f=fixture('other-wallet');
 await withAccountWallet(f.connector,'bob.testnet',f.action);
 assert.deepEqual(f.counts(),{connections:0,approvals:1});
});

test('network or account mismatches are rejected before requesting approval',async()=>{
 const f=fixture('other-wallet');
 await assert.rejects(withAccountWallet(f.connector,'unknown.testnet',f.action),/account or network changed/);
 f.connector.network='mainnet';
 await assert.rejects(withAccountWallet(f.connector,'alice.testnet',f.action),/testnet wallet/);
 assert.equal(f.counts().approvals,0);
});
