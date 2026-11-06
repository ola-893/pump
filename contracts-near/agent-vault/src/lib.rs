//! Isolated TESTNET custody and NEP-141 pump coin. Returns are trusted paper assertions.
use near_sdk::{near,env,assert_one_yocto,AccountId,Gas,NearToken,PanicOnDefault,Promise,PromiseResult,PromiseOrValue};
use near_sdk::json_types::U128;
use near_sdk::serde::{Serialize,Deserialize};
use near_contract_standards::fungible_token::{FungibleToken,events::{FtMint,FtBurn},metadata::{FungibleTokenMetadata,FungibleTokenMetadataProvider,FT_METADATA_SPEC}};
use near_contract_standards::storage_management::{StorageManagement,StorageBalance,StorageBalanceBounds};
const TOKEN:&str="3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const MAX_ASSETS:u128=1_000_000_000_000;
const MAX_SHARES:u128=1_000_000_000_000_000_000_000_000;
#[near(serializers=[borsh,json])]
#[derive(Clone)]
pub struct LiveNav {
 pub reference_equity:U128,
 pub equity:U128,
 pub sequence:u64,
 pub observed_at_ms:u64,
 pub tracking:bool,
}
#[near(serializers=[borsh,json])]
#[derive(Clone)]
pub struct Round {pub run_id:String,pub strategy_hash:String,pub reference_equity:U128,pub start_sequence:u64,pub started_at_ms:u64}
#[near(serializers=[borsh,json])]
#[derive(Clone)]
pub struct Pending {pub id:u64,pub account:AccountId,pub shares:U128,pub assets:U128,pub reserve:bool}
#[derive(Deserialize)]
#[serde(crate="near_sdk::serde",deny_unknown_fields)]
struct Deposit {kind:String,min_shares:Option<U128>,expected_nonce:Option<u64>}
const SEED_KEY:&[u8]=b"pump-owner-seed-v1";
#[near(serializers=[borsh,json])]
#[derive(Clone)]
pub struct SeedFunding {pub required:U128,pub received:U128}
#[derive(Serialize)]
#[serde(crate="near_sdk::serde")]
pub struct State {pub version:&'static str,pub environment:&'static str,pub agent_id:String,pub manifest_hash:String,pub strategy_id:String,pub strategy_hash:String,pub name:String,pub controller_id:AccountId,pub reporter_id:AccountId,pub token_id:AccountId,pub assets:U128,pub reserve:U128,pub total_supply:U128,pub nonce:u64,pub paused:bool,pub round:Option<Round>,pub pending:Option<Pending>,pub last_evidence_hash:String,pub archived:bool,pub public:bool,pub factory_id:Option<AccountId>,pub live_nav:Option<LiveNav>,pub nav_fresh:bool}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {token:FungibleToken,agent_id:String,manifest_hash:String,strategy_id:String,strategy_hash:String,name:String,controller:AccountId,reporter:AccountId,assets:u128,reserve:u128,nonce:u64,paused:bool,round:Option<Round>,pending:Option<Pending>,last_evidence_hash:String,archived:bool,public:bool,factory:Option<AccountId>,live_nav:Option<LiveNav>}
fn hash(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_hexdigit())}
fn uuid(s:&str)->bool{s.len()==36&&s.bytes().enumerate().all(|(i,b)|if [8,13,18,23].contains(&i){b==b'-'}else{b.is_ascii_hexdigit()})}
fn muldiv(a:u128,b:u128,d:u128)->u128{assert!(d>0,"Zero denominator");a.checked_mul(b).expect("Arithmetic overflow")/d}
#[near]
impl Vault {
 #[init]
 pub fn new(agent_id:String,manifest_hash:String,strategy_id:String,strategy_hash:String,name:String,controller_id:AccountId,reporter_id:AccountId)->Self{
  assert!(env::current_account_id().as_str().ends_with(".testnet"),"Testnet only");assert!(uuid(&agent_id)&&hash(&manifest_hash),"Invalid agent binding");assert!(uuid(&strategy_id)&&hash(&strategy_hash),"Invalid strategy binding");assert!(!name.is_empty()&&name.len()<=64,"Invalid name");
  Self{token:FungibleToken::new(b"s"),agent_id,manifest_hash,strategy_id,strategy_hash,name,controller:controller_id,reporter:reporter_id,assets:0,reserve:0,nonce:0,paused:false,round:None,pending:None,last_evidence_hash:String::new(),archived:false,public:true,factory:None,live_nav:None}
 }
 #[init]
 pub fn new_owned(agent_id:String,manifest_hash:String,strategy_id:String,strategy_hash:String,name:String,owner_id:AccountId,reporter_id:AccountId,public:bool,factory_id:AccountId)->Self {
  assert_eq!(env::predecessor_account_id(),factory_id,"Factory only");
  assert!(env::current_account_id().as_str().ends_with(&format!(".{factory_id}")),"Factory child only");
  let mut vault=Self::new(agent_id,manifest_hash,strategy_id,strategy_hash,name,owner_id,reporter_id);
  vault.public=public;
  vault.factory=Some(factory_id);
  vault
 }
 #[init]
 pub fn new_live(agent_id:String,manifest_hash:String,strategy_id:String,strategy_hash:String,name:String,owner_id:AccountId,reporter_id:AccountId,public:bool,factory_id:AccountId,initial_equity:U128)->Self {
  assert!(initial_equity.0>0&&initial_equity.0<=MAX_ASSETS,"Invalid initial equity");
  let mut vault=Self::new_owned(agent_id,manifest_hash,strategy_id,strategy_hash,name,owner_id,reporter_id,public,factory_id);
  vault.live_nav=Some(LiveNav{reference_equity:initial_equity,equity:initial_equity,sequence:0,observed_at_ms:env::block_timestamp_ms(),tracking:false});
  vault
 }
 #[init]
 pub fn new_seeded(agent_id:String,manifest_hash:String,strategy_id:String,strategy_hash:String,owner_id:AccountId,factory_id:AccountId,seed:U128)->Self {
  assert!(seed.0>0&&seed.0<=MAX_ASSETS,"Invalid seed amount");
  let mut vault=Self::new_owned(agent_id,manifest_hash,strategy_id,strategy_hash,"Pump agent vault".into(),owner_id.clone(),factory_id.clone(),false,factory_id);
  vault.token.internal_register_account(&owner_id);
  Self::write_seed(&SeedFunding{required:seed,received:U128(0)});
  vault
 }
 pub fn seed_funding(&self)->Option<SeedFunding>{
  env::storage_read(SEED_KEY).map(|bytes|near_sdk::borsh::from_slice(&bytes).expect("Invalid seed state"))
 }
 /// Trusted quote reporter updates redeemable assets while positions remain open.
 pub fn report_nav(&mut self,run_id:String,strategy_hash:String,equity:U128,sequence:u64,observed_at_ms:u64,evidence_hash:String,tracking:bool,expected_nonce:u64) {
  assert_eq!(env::predecessor_account_id(),self.reporter,"Reporter only");
  assert!(!self.archived,"Archived vault");
  assert!(self.pending.is_none(),"Payout pending");
  assert_eq!(expected_nonce,self.nonce,"NAV changed");
  assert_eq!(run_id,self.strategy_id,"Vault strategy ID mismatch");
  assert_eq!(strategy_hash,self.strategy_hash,"Vault strategy hash mismatch");
  assert!(hash(&evidence_hash),"Invalid evidence");
  assert!(equity.0<=MAX_ASSETS,"Equity exceeds demo cap");
  let nav=self.live_nav.as_ref().expect("Live pricing unavailable");
  let now=env::block_timestamp_ms();
  assert!(observed_at_ms<=now&&now-observed_at_ms<=60_000,"Stale valuation");
  assert!(observed_at_ms>=nav.observed_at_ms&&sequence>=nav.sequence,"Valuation moved backward");
  if sequence==nav.sequence {assert_eq!(equity,nav.equity,"Changed equity without a new journal event");}
  let next=if self.token.total_supply==0 {0}else{muldiv(self.token.total_supply,equity.0,nav.reference_equity.0)};
  assert!(next<=MAX_ASSETS,"Asset cap exceeded");
  assert!(next<=self.assets+self.reserve,"Insufficient agent surplus");
  if next>self.assets {self.reserve-=next-self.assets;}else{self.reserve+=self.assets-next;}
  self.assets=next;
  let reference=if self.token.total_supply==0&&equity.0>0{equity}else{nav.reference_equity};
  self.live_nav=Some(LiveNav{reference_equity:reference,equity,sequence,observed_at_ms,tracking});
  self.last_evidence_hash=evidence_hash;
  self.nonce+=1;
  self.event("nav_reported",near_sdk::serde_json::json!({"run_id":run_id,"equity":equity,"sequence":sequence,"assets":U128(next),"observed_at_ms":observed_at_ms,"evidence_hash":self.last_evidence_hash,"tracking":tracking}));
 }
 pub fn archive(&mut self,agent_id:String) {
  assert_eq!(self.agent_id,agent_id,"Agent mismatch");
  assert_eq!(env::signer_account_id(),self.controller,"Owner only");
  let predecessor=env::predecessor_account_id();
  assert!(predecessor==self.controller || self.factory.as_ref()==Some(&predecessor),"Owner or factory only");
  self.idle();
  assert!(!self.live_nav.as_ref().is_some_and(|nav|nav.tracking),"Stop live tracking before archiving");
  if !self.archived {self.archived=true;self.paused=true;self.nonce+=1;}
 }
 pub fn publish(&mut self) {
  assert!(self.seed_funding().is_none(),"Seed vault is closed to investors");
  let predecessor=env::predecessor_account_id();
  assert_eq!(env::signer_account_id(),self.controller,"Owner only");
  assert!(predecessor==self.controller || self.factory.as_ref()==Some(&predecessor),"Owner or factory only");
  assert!(!self.archived,"Archived vault");
  if !self.public {self.public=true;self.nonce+=1;}
 }
 pub fn get_state(&self)->State{State{version:if self.live_nav.is_some(){"PUMP-STRATEGY-VAULT-v4"}else if self.factory.is_some(){"PUMP-STRATEGY-VAULT-v3"}else{"PUMP-STRATEGY-VAULT-v2"},environment:if self.live_nav.is_some(){"testnet-live-nav"}else{"testnet-paper-rounds"},agent_id:self.agent_id.clone(),manifest_hash:self.manifest_hash.clone(),strategy_id:self.strategy_id.clone(),strategy_hash:self.strategy_hash.clone(),name:self.name.clone(),controller_id:self.controller.clone(),reporter_id:self.reporter.clone(),token_id:TOKEN.parse().unwrap(),assets:U128(self.assets),reserve:U128(self.reserve),total_supply:U128(self.token.total_supply),nonce:self.nonce,paused:self.paused,round:self.round.clone(),pending:self.pending.clone(),last_evidence_hash:self.last_evidence_hash.clone(),archived:self.archived,public:self.public,factory_id:self.factory.clone(),live_nav:self.live_nav.clone(),nav_fresh:self.nav_fresh()}}
 pub fn preview_deposit(&self,amount:U128)->U128{U128(self.mint_amount(amount.0))}
 pub fn preview_redeem(&self,shares:U128)->U128{if self.token.total_supply==0{return U128(0)}U128(muldiv(shares.0.min(self.token.total_supply),self.assets,self.token.total_supply))}
 /// Returns the full unused amount on rejected deposits, letting the FT resolver refund it.
 pub fn ft_on_transfer(&mut self,sender_id:AccountId,amount:U128,msg:String)->U128{
  assert_eq!(env::predecessor_account_id().as_str(),TOKEN,"Pinned test USDC only");
  if amount.0==0||amount.0>MAX_ASSETS||self.pending.is_some(){return amount}
  let Ok(m)=near_sdk::serde_json::from_str::<Deposit>(&msg)else{return amount};
  if let Some(mut seed)=self.seed_funding(){
   if m.kind!="seed"||m.min_shares.is_some()||m.expected_nonce.is_some()||sender_id!=self.controller||
      seed.received.0!=0||amount.0!=seed.required.0||self.archived||self.paused{return amount}
   self.assets=amount.0;
   self.token.internal_deposit(&sender_id,amount.0);
   self.nonce+=1;
   seed.received=amount;
   Self::write_seed(&seed);
   FtMint{owner_id:&sender_id,amount,memo:Some("Agent seed")}.emit();
   self.event("seed_funded",near_sdk::serde_json::json!({"account_id":sender_id,"assets":amount}));
   return U128(0)
  }
  if m.kind=="reserve"&&m.min_shares.is_none()&&m.expected_nonce.is_none(){if sender_id!=self.controller||self.reserve>MAX_ASSETS-amount.0{return amount}self.reserve+=amount.0;self.nonce+=1;self.event("reserve_funded",near_sdk::serde_json::json!({"amount":amount}));return U128(0)}
  if m.kind!="deposit"||!self.nav_fresh()||!self.public||self.archived||self.paused||self.round.is_some()||m.expected_nonce!=Some(self.nonce)||self.assets>MAX_ASSETS-amount.0||self.token.accounts.get(&sender_id).is_none(){return amount}
  if self.token.total_supply==0 {
   if let Some(nav)=self.live_nav.as_mut() {
    if nav.equity.0==0 {return amount;}
    nav.reference_equity=nav.equity;
   }
  }
  let minted=self.mint_amount(amount.0);if minted==0||m.min_shares.is_none()||minted<m.min_shares.unwrap().0||minted>MAX_SHARES-self.token.total_supply{return amount}
  self.assets+=amount.0;self.token.internal_deposit(&sender_id,minted);self.nonce+=1;FtMint{owner_id:&sender_id,amount:U128(minted),memo:Some("pump coin")}.emit();self.event("deposit",near_sdk::serde_json::json!({"account_id":sender_id,"assets":amount,"shares":U128(minted)}));U128(0)
 }
 #[payable]
 pub fn redeem(&mut self,shares:U128,min_assets:U128,expected_nonce:u64)->PromiseOrValue<bool>{
  assert_one_yocto();self.idle();assert!(self.nav_fresh(),"Live valuation stale");assert_eq!(expected_nonce,self.nonce,"NAV changed");assert!(shares.0>0,"Positive shares required");let who=env::predecessor_account_id();assert!(shares.0<=self.token.internal_unwrap_balance_of(&who),"Insufficient shares");
  let payout=self.preview_redeem(shares).0;assert!(payout>=min_assets.0,"Redemption below minimum");self.token.internal_withdraw(&who,shares.0);self.assets-=payout;self.nonce+=1;FtBurn{owner_id:&who,amount:shares,memo:Some("Redeem pump coin")}.emit();
  if payout==0{self.event("redeemed",near_sdk::serde_json::json!({"account_id":who,"shares":shares,"assets":U128(0)}));return PromiseOrValue::Value(true)}
  let p=Pending{id:self.nonce,account:who.clone(),shares,assets:U128(payout),reserve:false};self.pending=Some(p);PromiseOrValue::Promise(self.pay(who,payout,self.nonce))
 }
 #[private]
 pub fn finish_payout(&mut self,operation_id:u64)->bool{
  assert_eq!(env::predecessor_account_id(),env::current_account_id(),"Private callback");assert_eq!(env::promise_results_count(),1,"One payout outcome required");let Some(p)=self.pending.clone()else{return false};if p.id!=operation_id{return false}
  let success=matches!(env::promise_result(0),PromiseResult::Successful(_));if !success{if p.reserve{self.reserve+=p.assets.0}else{self.assets+=p.assets.0;self.token.internal_deposit(&p.account,p.shares.0);FtMint{owner_id:&p.account,amount:p.shares,memo:Some("Failed redemption restored")}.emit();}}
  self.pending=None;self.nonce+=1;self.event(if success{"payout_complete"}else{"payout_restored"},near_sdk::serde_json::json!({"operation_id":operation_id,"account_id":p.account,"assets":p.assets,"shares":p.shares,"reserve":p.reserve}));success
 }
 pub fn begin_round(&mut self,run_id:String,strategy_hash:String,reference_equity:U128,start_sequence:u64,expected_nonce:u64){
  assert!(self.live_nav.is_none(),"Live vaults use automatic NAV reports");assert_eq!(env::predecessor_account_id(),self.reporter,"Reporter only");self.idle();assert!(self.public&&!self.archived&&!self.paused,"Deposits and rounds paused");assert_eq!(expected_nonce,self.nonce,"NAV changed");assert!(self.assets>0&&self.token.total_supply>0,"Deposit first");assert_eq!(run_id,self.strategy_id,"Vault strategy ID mismatch");assert_eq!(strategy_hash,self.strategy_hash,"Vault strategy hash mismatch");assert!(reference_equity.0>0&&reference_equity.0<=MAX_ASSETS,"Invalid paper reference");
  self.round=Some(Round{run_id,strategy_hash,reference_equity,start_sequence,started_at_ms:env::block_timestamp_ms()});self.nonce+=1;self.event("round_started",near_sdk::serde_json::json!({"round":self.round}));
 }
 /// Trusted reporter applies a proportional return from a CLOSED, explicitly bound paper round.
 pub fn settle_round(&mut self,run_id:String,ending_equity:U128,sequence:u64,evidence_hash:String,expected_nonce:u64){
  assert_eq!(env::predecessor_account_id(),self.reporter,"Reporter only");assert!(self.pending.is_none(),"Payout pending");assert_eq!(expected_nonce,self.nonce,"NAV changed");let r=self.round.clone().expect("No active round");assert_eq!(r.run_id,run_id,"Round mismatch");assert!(sequence>=r.start_sequence&&hash(&evidence_hash),"Invalid evidence");assert!(ending_equity.0<=r.reference_equity.0*2,"Demo return exceeds 100 percent");
  let next=muldiv(self.assets,ending_equity.0,r.reference_equity.0);assert!(next<=MAX_ASSETS,"Asset cap exceeded");if next>self.assets{let gain=next-self.assets;assert!(gain<=self.reserve,"Insufficient agent surplus");self.reserve-=gain}else{self.reserve+=self.assets-next}
  self.assets=next;self.last_evidence_hash=evidence_hash;self.round=None;self.nonce+=1;self.event("simulated_round_settled",near_sdk::serde_json::json!({"run_id":run_id,"sequence":sequence,"ending_equity":ending_equity,"assets":U128(next),"evidence_hash":self.last_evidence_hash}));
 }
 pub fn cancel_expired_round(&mut self,expected_nonce:u64){assert_eq!(self.nonce,expected_nonce,"NAV changed");assert!(self.pending.is_none(),"Payout pending");let r=self.round.clone().expect("No active round");assert!(env::block_timestamp_ms()>=r.started_at_ms+86_400_000,"Round not expired");self.round=None;self.nonce+=1;self.event("expired_round_cancelled",near_sdk::serde_json::json!({"run_id":r.run_id,"simulated_return_applied":false}));}
 pub fn set_paused(&mut self,paused:bool){assert_eq!(env::predecessor_account_id(),self.controller,"Controller only");assert!(!self.archived,"Archived vault");self.paused=paused;self.nonce+=1;}
 #[payable]
 pub fn withdraw_reserve(&mut self,amount:U128,expected_nonce:u64)->Promise{assert_one_yocto();assert_eq!(env::predecessor_account_id(),self.controller,"Controller only");self.idle();assert_eq!(self.nonce,expected_nonce,"NAV changed");assert!(amount.0>0&&amount.0<=self.reserve,"Insufficient free surplus");self.reserve-=amount.0;self.nonce+=1;self.pending=Some(Pending{id:self.nonce,account:self.controller.clone(),shares:U128(0),assets:amount,reserve:true});self.pay(self.controller.clone(),amount.0,self.nonce)}
}
impl Vault {
 fn write_seed(seed:&SeedFunding){env::storage_write(SEED_KEY,&near_sdk::borsh::to_vec(seed).expect("Invalid seed state"));}
 fn nav_fresh(&self)->bool{
  self.live_nav.as_ref().is_none_or(|nav| !nav.tracking||env::block_timestamp_ms().saturating_sub(nav.observed_at_ms)<=60_000)
 }
 fn mint_amount(&self,amount:u128)->u128{if self.token.total_supply==0{amount}else if self.assets==0{0}else{muldiv(amount,self.token.total_supply,self.assets)}}
 fn idle(&self){assert!(self.pending.is_none(),"Payout pending");assert!(self.round.is_none(),"Paper round active; flows locked");}
 fn pay(&self,to:AccountId,amount:u128,id:u64)->Promise{Promise::new(TOKEN.parse().unwrap()).function_call("ft_transfer".into(),near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"receiver_id":to,"amount":U128(amount),"memo":"pump testnet vault payout"})).unwrap(),NearToken::from_yoctonear(1),Gas::from_tgas(20)).then(Promise::new(env::current_account_id()).function_call("finish_payout".into(),near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"operation_id":id})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(20)))}
 fn event(&self,event:&str,data:near_sdk::serde_json::Value){env::log_str(&format!("EVENT_JSON:{}",near_sdk::serde_json::json!({"standard":"pump_agent_vault","version":"1.0.0","event":event,"data":[data]})));}
}
near_contract_standards::impl_fungible_token_core!(Vault,token);
#[near]
impl StorageManagement for Vault {
 #[payable]
 fn storage_deposit(&mut self,account_id:Option<AccountId>,registration_only:Option<bool>)->StorageBalance{self.token.storage_deposit(account_id,registration_only)}
 #[payable]
 fn storage_withdraw(&mut self,amount:Option<NearToken>)->StorageBalance{self.token.storage_withdraw(amount)}
 #[payable]
 fn storage_unregister(&mut self,force:Option<bool>)->bool{let _=force;assert_one_yocto();env::panic_str("Share accounts stay registered in this testnet demo")}
 fn storage_balance_bounds(&self)->StorageBalanceBounds{self.token.storage_balance_bounds()}
 fn storage_balance_of(&self,account_id:AccountId)->Option<StorageBalance>{self.token.storage_balance_of(account_id)}
}
#[near]
impl FungibleTokenMetadataProvider for Vault {fn ft_metadata(&self)->FungibleTokenMetadata{FungibleTokenMetadata{spec:FT_METADATA_SPEC.into(),name:"pump coin".into(),symbol:"PUMP".into(),icon:None,reference:None,reference_hash:None,decimals:6}}}
#[cfg(test)]mod tests;
