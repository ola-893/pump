//! Testnet clearing for simulated performance. Reporter assertions are NOT exchange fills.
use near_sdk::{near, env, assert_one_yocto, AccountId, PanicOnDefault, Promise, PromiseResult, Gas, NearToken};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::serde::{Serialize, Deserialize};

pub const CIRCLE_TEST_USDC: &str = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const REGISTER_COST: u128 = 20_000_000_000_000_000_000_000; // 0.02 test NEAR; fixed demo registration fee.
const MAX_AMOUNT: u128 = 1_000_000_000_000; // 1m test USDC per operation/session.

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Claim {
    pub claim: U128, pub deposited: U128, pub withdrawn: U128,
    pub session_id: String, pub sequence: u64, pub evidence_hash: String,
    pub pending: Option<Pending>,
}
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Pending { pub id: u64, pub amount: U128 }
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct DepositMessage { kind: String, session_id: Option<String> }
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct State {
    pub version: &'static str, pub environment: &'static str, pub token_id: AccountId,
    pub controller_id: AccountId, pub reporter_id: AccountId, pub reserve: U128,
    pub total_claims: U128, pub in_flight: U128, pub registered: u32,
    pub max_gain_bps: u32, pub reserve_pending: Option<Pending>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Clearing {
    controller_id: AccountId, reporter_id: AccountId, token_id: AccountId,
    reserve: u128, total_claims: u128, in_flight: u128, registered: u32,
    operation_id: u64, max_gain_bps: u32, claims: LookupMap<AccountId, Claim>,
    reserve_pending: Option<Pending>,
}

#[near]
impl Clearing {
    #[init]
    pub fn new(controller_id: AccountId, reporter_id: AccountId) -> Self {
        assert!(env::current_account_id().as_str().ends_with(".testnet"), "Deploy only to a named .testnet contract account");
        Self {controller_id,reporter_id,token_id:CIRCLE_TEST_USDC.parse().unwrap(),reserve:0,total_claims:0,in_flight:0,registered:0,operation_id:0,max_gain_bps:10_000,claims:LookupMap::new(b"c"),reserve_pending:None}
    }
    pub fn get_state(&self) -> State {
        State {version:"PUMPCOIN-TESTNET-CLEARING-v1",environment:"testnet-simulated-performance",token_id:self.token_id.clone(),controller_id:self.controller_id.clone(),reporter_id:self.reporter_id.clone(),reserve:U128(self.reserve),total_claims:U128(self.total_claims),in_flight:U128(self.in_flight),registered:self.registered,max_gain_bps:self.max_gain_bps,reserve_pending:self.reserve_pending.clone()}
    }
    pub fn get_claim(&self, account_id: AccountId) -> Option<Claim> {self.claims.get(&account_id).cloned()}
    #[payable]
    pub fn register(&mut self) {
        let who=env::predecessor_account_id();
        assert!(!self.claims.contains_key(&who), "Already registered");
        assert!(self.registered<100, "Demo registration capacity reached");
        assert!(env::attached_deposit().as_yoctonear()==REGISTER_COST,"Attach exactly 0.02 test NEAR");
        self.claims.insert(who,Claim::default());self.registered+=1;
    }
    /// Only Circle's pinned testnet FT can invoke token crediting. Unknown/malformed inputs refund.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        assert_eq!(env::predecessor_account_id(),self.token_id,"Unexpected token contract");
        if amount.0==0 || amount.0>MAX_AMOUNT {return amount;}
        let Ok(m)=near_sdk::serde_json::from_str::<DepositMessage>(&msg) else {return amount;};
        if m.kind=="reserve" && m.session_id.is_none() {
            if sender_id!=self.controller_id {return amount;}
            self.reserve=self.reserve.checked_add(amount.0).expect("Reserve overflow");
            self.log("reserve_funded",near_sdk::serde_json::json!({"amount":amount,"sender_id":sender_id}));return U128(0);
        }
        if m.kind!="deposit" {return amount;}
        let Some(session)=m.session_id else {return amount;};
        if session.len()!=36 || !session.bytes().all(|b|b.is_ascii_hexdigit()||b==b'-') {return amount;}
        let Some(mut c)=self.claims.get(&sender_id).cloned() else {return amount;};
        if c.pending.is_some() {return amount;}
        if c.session_id!=session {
            if c.claim.0!=0 {return amount;}
            c=Claim {session_id:session.clone(),..Claim::default()};
        }
        if c.deposited.0.checked_add(amount.0).map_or(true,|n|n>MAX_AMOUNT) {return amount;}
        c.claim.0+=amount.0;c.deposited.0+=amount.0;self.total_claims+=amount.0;
        self.claims.insert(sender_id.clone(),c);
        self.log("deposited",near_sdk::serde_json::json!({"account_id":sender_id,"amount":amount,"session_id":session}));U128(0)
    }
    /// Trusted demo reporter reconciles a closed paper portfolio. Never claims an Intents fill.
    pub fn record_result(&mut self, account_id: AccountId, session_id: String, expected_claim: U128, new_claim: U128, sequence: u64, evidence_hash: String) {
        assert_eq!(env::predecessor_account_id(),self.reporter_id,"Reporter only");
        assert!(evidence_hash.len()==64 && evidence_hash.bytes().all(|b|b.is_ascii_hexdigit()),"Invalid evidence hash");
        let mut c=self.claims.get(&account_id).expect("Register and deposit first").clone();
        assert!(c.pending.is_none(),"Withdrawal pending");assert_eq!(c.session_id,session_id,"Session mismatch");
        assert_eq!(c.claim,expected_claim,"Claim changed");assert!(sequence>c.sequence,"Result already processed");
        assert!(new_claim.0<=c.deposited.0*(10_000+self.max_gain_bps as u128)/10_000,"Demo gain cap exceeded");
        if new_claim.0>c.claim.0 {
            let gain=new_claim.0-c.claim.0;assert!(gain<=self.reserve,"Insufficient demo surplus");
            self.reserve-=gain;self.total_claims+=gain;
        } else {let loss=c.claim.0-new_claim.0;self.reserve+=loss;self.total_claims-=loss;}
        c.claim=new_claim;c.sequence=sequence;c.evidence_hash=evidence_hash.clone();self.claims.insert(account_id.clone(),c);
        self.log("simulated_result",near_sdk::serde_json::json!({"account_id":account_id,"session_id":session_id,"sequence":sequence,"evidence_hash":evidence_hash,"old_claim":expected_claim,"new_claim":new_claim}));
    }
    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        assert_one_yocto();let who=env::predecessor_account_id();
        let mut c=self.claims.get(&who).expect("Not registered").clone();
        assert!(c.pending.is_none(),"Withdrawal pending");assert!(amount.0>0&&amount.0<=c.claim.0,"Insufficient claim");
        self.operation_id+=1;let id=self.operation_id;c.claim.0-=amount.0;
        c.pending=Some(Pending{id,amount});self.total_claims-=amount.0;self.in_flight+=amount.0;
        self.claims.insert(who.clone(),c);
        self.transfer(who.clone(),amount,"finish_withdraw",near_sdk::serde_json::json!({"account_id":who,"operation_id":id}))
    }
    #[private]
    pub fn finish_withdraw(&mut self, account_id: AccountId, operation_id: u64) -> bool {
        assert_eq!(env::predecessor_account_id(),env::current_account_id(),"Private callback");
        let mut c=self.claims.get(&account_id).expect("Missing withdrawal account").clone();
        let Some(p)=c.pending.clone() else {return false;};if p.id!=operation_id {return false;}
        let success=matches!(env::promise_result(0),PromiseResult::Successful(_));
        self.in_flight-=p.amount.0;
        if success {c.withdrawn.0+=p.amount.0;} else {c.claim.0+=p.amount.0;self.total_claims+=p.amount.0;}
        c.pending=None;self.claims.insert(account_id.clone(),c);
        self.log(if success{"withdrawn"}else{"withdraw_restored"},near_sdk::serde_json::json!({"account_id":account_id,"operation_id":operation_id,"amount":p.amount}));success
    }
    #[payable]
    pub fn withdraw_reserve(&mut self, amount: U128) -> Promise {
        assert_one_yocto();assert_eq!(env::predecessor_account_id(),self.controller_id,"Controller only");
        assert!(self.reserve_pending.is_none(),"Reserve withdrawal pending");assert!(amount.0>0&&amount.0<=self.reserve,"Insufficient free reserve");
        self.operation_id+=1;let id=self.operation_id;self.reserve-=amount.0;self.in_flight+=amount.0;self.reserve_pending=Some(Pending{id,amount});
        self.transfer(self.controller_id.clone(),amount,"finish_reserve",near_sdk::serde_json::json!({"operation_id":id}))
    }
    #[private]
    pub fn finish_reserve(&mut self, operation_id: u64) -> bool {
        assert_eq!(env::predecessor_account_id(),env::current_account_id(),"Private callback");
        let Some(p)=self.reserve_pending.clone() else {return false;};if p.id!=operation_id{return false;}
        let success=matches!(env::promise_result(0),PromiseResult::Successful(_));self.in_flight-=p.amount.0;
        if !success {self.reserve+=p.amount.0;}self.reserve_pending=None;success
    }
}
impl Clearing {
    fn transfer(&self, receiver_id:AccountId, amount:U128, callback:&str, args:near_sdk::serde_json::Value) -> Promise {
        Promise::new(self.token_id.clone()).function_call("ft_transfer".into(),near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"receiver_id":receiver_id,"amount":amount,"memo":"PumpCoin testnet demo payout; simulated performance"})).unwrap(),NearToken::from_yoctonear(1),Gas::from_tgas(20))
            .then(Promise::new(env::current_account_id()).function_call(callback.into(),near_sdk::serde_json::to_vec(&args).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(15)))
    }
    fn log(&self,event:&str,data:near_sdk::serde_json::Value){env::log_str(&format!("EVENT_JSON:{}",near_sdk::serde_json::json!({"standard":"pumpcoin_demo","version":"1.0.0","event":event,"data":[data]})));}
}

#[cfg(test)]
mod tests;
