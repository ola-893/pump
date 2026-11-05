//! Sandbox-only FT fixture. Never deployed to public testnet and never branded Circle-issued.
use near_sdk::{near, env, AccountId, PanicOnDefault, PromiseOrValue, NearToken};
use near_sdk::json_types::U128;
use near_contract_standards::fungible_token::FungibleToken;
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct FixtureToken {token:FungibleToken,owner:AccountId}
#[near]
impl FixtureToken {
    #[init]
    pub fn new(owner_id:AccountId)->Self{let mut token=FungibleToken::new(b"t");token.internal_register_account(&owner_id);Self{token,owner:owner_id}}
    pub fn mint(&mut self,account_id:AccountId,amount:U128){assert_eq!(env::predecessor_account_id(),self.owner);self.token.internal_deposit(&account_id,amount.0);}
}
near_contract_standards::impl_fungible_token_core!(FixtureToken,token);
#[near]
impl near_contract_standards::storage_management::StorageManagement for FixtureToken {
    #[payable]
    fn storage_deposit(&mut self,account_id:Option<AccountId>,registration_only:Option<bool>)->near_contract_standards::storage_management::StorageBalance{self.token.storage_deposit(account_id,registration_only)}
    #[payable]
    fn storage_withdraw(&mut self,amount:Option<NearToken>)->near_contract_standards::storage_management::StorageBalance{self.token.storage_withdraw(amount)}
    #[payable]
    fn storage_unregister(&mut self,force:Option<bool>)->bool{self.token.storage_unregister(force)}
    fn storage_balance_bounds(&self)->near_contract_standards::storage_management::StorageBalanceBounds{self.token.storage_balance_bounds()}
    fn storage_balance_of(&self,account_id:AccountId)->Option<near_contract_standards::storage_management::StorageBalance>{self.token.storage_balance_of(account_id)}
}
