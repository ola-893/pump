use super::*;
use near_sdk::{testing_env,test_utils::VMContextBuilder};
fn id(s:&str)->AccountId{s.parse().unwrap()}
fn ctx(who:&str,deposit:u128){let mut b=VMContextBuilder::new();b.current_account_id(id("katana.vault.testnet")).predecessor_account_id(id(who)).signer_account_id(id(who)).attached_deposit(NearToken::from_yoctonear(deposit)).account_balance(NearToken::from_near(100));testing_env!(b.build());}
fn setup()->Vault{ctx("owner.testnet",0);near_sdk::mock::with_mocked_blockchain(|b|{b.take_storage();});let mut v=Vault::new("12345678-1234-1234-1234-123456789abc".into(),"a".repeat(64),"12345678-1234-1234-1234-123456789abc".into(),"b".repeat(64),"katana".into(),id("owner.testnet"),id("reporter.testnet"));for a in ["alice.testnet","bob.testnet"]{v.token.internal_register_account(&id(a));}v}
fn deposit(v:&mut Vault,who:&str,n:u128){let nonce=v.nonce;ctx(TOKEN,0);let m=near_sdk::serde_json::json!({"kind":"deposit","min_shares":"1","expected_nonce":nonce});assert_eq!(v.ft_on_transfer(id(who),U128(n),m.to_string()).0,0)}
fn reserve(v:&mut Vault,n:u128){ctx(TOKEN,0);assert_eq!(v.ft_on_transfer(id("owner.testnet"),U128(n),"{\"kind\":\"reserve\"}".into()).0,0)}
fn begin(v:&mut Vault){ctx("reporter.testnet",0);v.begin_round("12345678-1234-1234-1234-123456789abc".into(),"b".repeat(64),U128(100_000_000),0,v.nonce)}
fn settle(v:&mut Vault,n:u128){ctx("reporter.testnet",0);v.settle_round("12345678-1234-1234-1234-123456789abc".into(),U128(n),4,"c".repeat(64),v.nonce)}
fn finish(v:&mut Vault,ok:bool){let op=v.pending.as_ref().unwrap().id;let mut b=VMContextBuilder::new();b.current_account_id(id("katana.vault.testnet")).predecessor_account_id(id("katana.vault.testnet")).account_balance(NearToken::from_near(100));testing_env!(b.build(),near_sdk::test_vm_config(),near_sdk::RuntimeFeesConfig::test(),Default::default(),vec![if ok{PromiseResult::Successful(vec![])}else{PromiseResult::Failed}]);assert_eq!(v.finish_payout(op),ok);assert!(!v.finish_payout(op));}
fn conserved(v:&Vault,n:u128){assert_eq!(v.assets+v.reserve+v.pending.as_ref().map_or(0,|p|p.assets.0),n)}
#[test]fn proportional_shares_and_reserve_exclusion(){let mut v=setup();deposit(&mut v,"alice.testnet",20_000_000);reserve(&mut v,30_000_000);assert_eq!(v.token.total_supply,20_000_000);begin(&mut v);settle(&mut v,110_000_000);assert_eq!(v.assets,22_000_000);assert_eq!(v.reserve,28_000_000);assert_eq!(v.preview_deposit(U128(11_000_000)).0,10_000_000);deposit(&mut v,"bob.testnet",11_000_000);assert_eq!(v.token.total_supply,30_000_000);assert_eq!(v.preview_redeem(U128(10_000_000)).0,11_000_000);conserved(&v,61_000_000)}
#[test]fn loss_and_failed_redemption_restore_exact_shares(){let mut v=setup();deposit(&mut v,"alice.testnet",20_000_000);reserve(&mut v,30_000_000);begin(&mut v);settle(&mut v,90_000_000);assert_eq!(v.assets,18_000_000);ctx("alice.testnet",1);v.redeem(U128(10_000_000),U128(9_000_000),v.nonce);conserved(&v,50_000_000);finish(&mut v,false);assert_eq!(v.token.internal_unwrap_balance_of(&id("alice.testnet")),20_000_000);assert_eq!(v.assets,18_000_000);conserved(&v,50_000_000);ctx("alice.testnet",1);v.redeem(U128(20_000_000),U128(18_000_000),v.nonce);finish(&mut v,true);assert_eq!(v.token.total_supply,0);conserved(&v,32_000_000)}
#[test]fn active_round_rejects_deposit_and_transfer_refunds(){let mut v=setup();deposit(&mut v,"alice.testnet",20);begin(&mut v);ctx(TOKEN,0);let m=format!("{{\"kind\":\"deposit\",\"min_shares\":\"1\",\"expected_nonce\":{}}}",v.nonce);assert_eq!(v.ft_on_transfer(id("bob.testnet"),U128(5),m).0,5);assert_eq!(v.token.total_supply,20)}
#[test]#[should_panic(expected="Paper round active")]fn redemption_locked_during_round(){let mut v=setup();deposit(&mut v,"alice.testnet",20);begin(&mut v);ctx("alice.testnet",1);v.redeem(U128(1),U128(0),v.nonce);}
#[test]#[should_panic(expected="Insufficient agent surplus")]fn no_unfunded_profit(){let mut v=setup();deposit(&mut v,"alice.testnet",20);begin(&mut v);settle(&mut v,110_000_000)}
#[test]#[should_panic(expected="Reporter only")]fn unauthorized_reporter(){let mut v=setup();deposit(&mut v,"alice.testnet",20);ctx("alice.testnet",0);v.begin_round("12345678-1234-1234-1234-123456789abc".into(),"b".repeat(64),U128(100),0,v.nonce)}
#[test]fn stale_nav_zero_mint_and_wrong_message_refund(){let mut v=setup();deposit(&mut v,"alice.testnet",20);ctx(TOKEN,0);for m in ["{}","{\"kind\":\"deposit\",\"min_shares\":\"1\",\"expected_nonce\":0}","{\"kind\":\"reserve\"}"]{assert_eq!(v.ft_on_transfer(id("bob.testnet"),U128(1),m.into()).0,1)}assert_eq!(v.assets,20)}
#[test]fn full_loss_allows_zero_asset_burn_then_new_deposits(){let mut v=setup();deposit(&mut v,"alice.testnet",20);begin(&mut v);settle(&mut v,0);ctx(TOKEN,0);let m=format!("{{\"kind\":\"deposit\",\"min_shares\":\"1\",\"expected_nonce\":{}}}",v.nonce);assert_eq!(v.ft_on_transfer(id("bob.testnet"),U128(1),m).0,1);ctx("alice.testnet",1);v.redeem(U128(20),U128(0),v.nonce);assert_eq!(v.token.total_supply,0);deposit(&mut v,"bob.testnet",10);assert_eq!(v.assets,10)}
#[test]#[should_panic(expected="NAV changed")]fn redemption_stale_nonce(){let mut v=setup();deposit(&mut v,"alice.testnet",20);ctx("alice.testnet",1);v.redeem(U128(1),U128(0),0);}
#[test]#[should_panic(expected="Redemption below minimum")]fn redemption_minimum(){let mut v=setup();deposit(&mut v,"alice.testnet",20);ctx("alice.testnet",1);v.redeem(U128(1),U128(2),v.nonce);}
#[test]#[should_panic(expected="Pinned test USDC only")]fn fake_token(){let mut v=setup();ctx("fake.testnet",0);v.ft_on_transfer(id("alice.testnet"),U128(20),"{}".into());}
#[test]fn paused_vault_still_redeems(){let mut v=setup();deposit(&mut v,"alice.testnet",20);ctx("owner.testnet",0);v.set_paused(true);ctx("alice.testnet",1);v.redeem(U128(20),U128(20),v.nonce);finish(&mut v,true);assert_eq!(v.assets,0)}
#[test]fn reserve_failure_restores_without_touching_shares(){let mut v=setup();deposit(&mut v,"alice.testnet",20);reserve(&mut v,30);ctx("owner.testnet",1);v.withdraw_reserve(U128(5),v.nonce);conserved(&v,50);finish(&mut v,false);assert_eq!(v.reserve,30);assert_eq!(v.token.total_supply,20)}

#[test]fn expired_round_can_be_cancelled_by_investor_without_inventing_profit(){let mut v=setup();deposit(&mut v,"alice.testnet",20);begin(&mut v);let start=v.round.as_ref().unwrap().started_at_ms;let mut b=VMContextBuilder::new();b.current_account_id(id("katana.vault.testnet")).predecessor_account_id(id("alice.testnet")).block_timestamp((start+86_400_001)*1_000_000);testing_env!(b.build());v.cancel_expired_round(v.nonce);assert!(v.round.is_none());assert_eq!(v.assets,20);assert_eq!(v.reserve,0);}
#[test]#[should_panic(expected="Round not expired")]fn premature_cancel_rejected(){let mut v=setup();deposit(&mut v,"alice.testnet",20);begin(&mut v);v.cancel_expired_round(v.nonce);}
#[test]#[should_panic(expected="Payout pending")]fn pending_redemption_prevents_new_nav_operation(){let mut v=setup();deposit(&mut v,"alice.testnet",20);ctx("alice.testnet",1);v.redeem(U128(5),U128(5),v.nonce);v.redeem(U128(5),U128(5),v.nonce);}
#[test]fn transfer_preserves_total_supply_and_redemption_rights(){use near_contract_standards::fungible_token::core::FungibleTokenCore;let mut v=setup();deposit(&mut v,"alice.testnet",20);ctx("alice.testnet",1);v.ft_transfer(id("bob.testnet"),U128(7),None);assert_eq!(v.token.total_supply,20);ctx("bob.testnet",1);v.redeem(U128(7),U128(7),v.nonce);finish(&mut v,true);assert_eq!(v.assets,13);}

#[test]
#[should_panic(expected="Vault strategy ID mismatch")]
fn reporter_cannot_open_round_for_another_strategy() {
 let mut v=setup();
 deposit(&mut v,"alice.testnet",20);
 ctx("reporter.testnet",0);
 v.begin_round("22345678-1234-1234-1234-123456789abc".into(),"b".repeat(64),U128(100),0,v.nonce);
}
#[test]
#[should_panic(expected="Vault strategy hash mismatch")]
fn reporter_cannot_change_the_pinned_strategy_hash() {
 let mut v=setup();
 deposit(&mut v,"alice.testnet",20);
 ctx("reporter.testnet",0);
 v.begin_round("12345678-1234-1234-1234-123456789abc".into(),"c".repeat(64),U128(100),0,v.nonce);
}

fn live()->Vault {
 let mut vault=setup();
 vault.live_nav=Some(LiveNav{reference_equity:U128(100_000_000),equity:U128(100_000_000),sequence:0,observed_at_ms:0,tracking:false});
 vault
}
fn at(who:&str,ms:u64,deposit:u128){
 let mut b=VMContextBuilder::new();
 b.current_account_id(id("katana.vault.testnet")).predecessor_account_id(id(who)).signer_account_id(id(who))
  .block_timestamp(ms*1_000_000).attached_deposit(NearToken::from_yoctonear(deposit))
  .account_balance(NearToken::from_near(100));
 testing_env!(b.build());
}
fn report(v:&mut Vault,equity:u128,sequence:u64,ms:u64){
 at("reporter.testnet",ms,0);
 v.report_nav(v.strategy_id.clone(),v.strategy_hash.clone(),U128(equity),sequence,ms,"d".repeat(64),true,v.nonce);
}
#[test]
fn live_price_updates_assets_with_open_exposure_and_allows_redemption(){
 let mut v=live();deposit(&mut v,"alice.testnet",5_000_000);reserve(&mut v,5_000_000);
 report(&mut v,99_000_000,1,1_000);
 assert_eq!(v.assets,4_950_000);assert_eq!(v.reserve,5_050_000);
 assert_eq!(v.preview_redeem(U128(5_000_000)).0,4_950_000);
 report(&mut v,101_000_000,2,2_000);
 assert_eq!(v.assets,5_050_000);assert_eq!(v.reserve,4_950_000);
 assert!(v.round.is_none());conserved(&v,10_000_000);
 at("alice.testnet",2_000,1);v.redeem(U128(1_000_000),U128(1_010_000),v.nonce);
 assert_eq!(v.pending.as_ref().unwrap().assets.0,1_010_000);
}
#[test]
fn live_late_investor_mints_at_current_price_and_reports_do_not_compound_rounding(){
 let mut v=live();deposit(&mut v,"alice.testnet",5_000_000);reserve(&mut v,5_000_000);
 report(&mut v,101_000_000,1,1_000);
 assert_eq!(v.preview_deposit(U128(1_010_000)).0,1_000_000);
 deposit(&mut v,"bob.testnet",1_010_000);
 report(&mut v,100_000_000,2,2_000);
 assert_eq!(v.assets,6_000_000);assert_eq!(v.token.total_supply,6_000_000);
 report(&mut v,100_000_000,2,3_000);
 assert_eq!(v.assets,6_000_000);conserved(&v,11_010_000);
}
#[test]
fn stale_live_deposit_refunds_without_minting(){
 let mut v=live();deposit(&mut v,"alice.testnet",5_000_000);
 report(&mut v,99_000_000,1,1_000);
 at(TOKEN,62_000,0);
 assert!(!v.nav_fresh());
 let msg=format!("{{\"kind\":\"deposit\",\"min_shares\":\"1\",\"expected_nonce\":{}}}",v.nonce);
 assert_eq!(v.ft_on_transfer(id("bob.testnet"),U128(1_000_000),msg).0,1_000_000);
 assert_eq!(v.token.total_supply,5_000_000);
}
#[test]#[should_panic(expected="Live valuation stale")]
fn stale_live_redemption_requires_a_fresh_report(){
 let mut v=live();deposit(&mut v,"alice.testnet",5_000_000);
 report(&mut v,99_000_000,1,1_000);
 at("alice.testnet",62_000,1);v.redeem(U128(1_000_000),U128(0),v.nonce);
}
#[test]#[should_panic(expected="Insufficient agent surplus")]
fn live_report_refuses_unfunded_gain(){
 let mut v=live();deposit(&mut v,"alice.testnet",5_000_000);
 report(&mut v,101_000_000,1,1_000);
}
#[test]#[should_panic(expected="Valuation moved backward")]
fn live_report_rejects_replayed_sequence(){
 let mut v=live();deposit(&mut v,"alice.testnet",5_000_000);
 report(&mut v,99_000_000,2,1_000);report(&mut v,98_000_000,1,2_000);
}
#[test]#[should_panic(expected="Reporter only")]
fn live_report_rejects_owner_impersonation(){
 let mut v=live();at("owner.testnet",1_000,0);
 v.report_nav(v.strategy_id.clone(),v.strategy_hash.clone(),U128(100_000_000),1,1_000,"d".repeat(64),true,v.nonce);
}
#[test]#[should_panic(expected="Payout pending")]
fn live_report_cannot_modify_an_inflight_redemption(){
 let mut v=live();deposit(&mut v,"alice.testnet",5_000_000);
 ctx("alice.testnet",1);v.redeem(U128(1_000_000),U128(1_000_000),v.nonce);
 report(&mut v,99_000_000,1,1_000);
}
