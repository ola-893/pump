use super::*;
use near_sdk::{testing_env, test_utils::VMContextBuilder, test_utils::get_logs};

fn id(s:&str)->AccountId{s.parse().unwrap()}
fn context(who:&str,deposit:u128){let mut b=VMContextBuilder::new();b.current_account_id(id("clearing.testnet")).predecessor_account_id(id(who)).signer_account_id(id(who)).attached_deposit(NearToken::from_yoctonear(deposit)).account_balance(NearToken::from_near(100));testing_env!(b.build());}
fn setup()->Clearing{
    context("owner.testnet",0);near_sdk::mock::with_mocked_blockchain(|b|{b.take_storage();});
    let mut v=Clearing::new(id("owner.testnet"),id("reporter.testnet"));
    context("alice.testnet",REGISTER_COST);v.register();v
}
fn deposit(v:&mut Clearing,amount:u128){context(CIRCLE_TEST_USDC,0);assert_eq!(v.ft_on_transfer(id("alice.testnet"),U128(amount),r#"{"kind":"deposit","session_id":"12345678-1234-1234-1234-123456789abc"}"#.into()).0,0);}
fn reserve(v:&mut Clearing,amount:u128){context(CIRCLE_TEST_USDC,0);assert_eq!(v.ft_on_transfer(id("owner.testnet"),U128(amount),r#"{"kind":"reserve"}"#.into()).0,0);}
fn report(v:&mut Clearing,old:u128,new:u128,seq:u64){context("reporter.testnet",0);v.record_result(id("alice.testnet"),"12345678-1234-1234-1234-123456789abc".into(),U128(old),U128(new),seq,"a".repeat(64));}
fn invariant(v:&Clearing,total:u128){assert_eq!(v.reserve+v.total_claims+v.in_flight,total);}
fn callback_env(result:PromiseResult){let mut b=VMContextBuilder::new();b.current_account_id(id("clearing.testnet")).predecessor_account_id(id("clearing.testnet")).account_balance(NearToken::from_near(100));testing_env!(b.build(),near_sdk::test_vm_config(),near_sdk::RuntimeFeesConfig::test(),Default::default(),vec![result]);}

#[test]fn reserve_is_separate_from_claims(){let mut v=setup();deposit(&mut v,20_000_000);reserve(&mut v,10_000_000);assert_eq!(v.get_claim(id("alice.testnet")).unwrap().claim.0,20_000_000);assert_eq!(v.reserve,10_000_000);invariant(&v,30_000_000);}
#[test]fn gains_consume_reserve_and_losses_restore_it(){let mut v=setup();deposit(&mut v,20_000_000);reserve(&mut v,10_000_000);report(&mut v,20_000_000,23_000_000,2);assert_eq!(v.reserve,7_000_000);invariant(&v,30_000_000);report(&mut v,23_000_000,18_000_000,3);assert_eq!(v.reserve,12_000_000);invariant(&v,30_000_000);assert!(get_logs().iter().any(|s|s.contains("simulated_result")));}
#[test]#[should_panic(expected="Insufficient demo surplus")]fn unfunded_gain_rejected(){let mut v=setup();deposit(&mut v,20);report(&mut v,20,21,1);}
#[test]#[should_panic(expected="Demo gain cap exceeded")]fn gain_cap_enforced(){let mut v=setup();deposit(&mut v,20);reserve(&mut v,100);report(&mut v,20,41,1);}
#[test]#[should_panic(expected="Result already processed")]fn replay_result_rejected(){let mut v=setup();deposit(&mut v,20);reserve(&mut v,10);report(&mut v,20,21,1);report(&mut v,21,22,1);}
#[test]#[should_panic(expected="Reporter only")]fn arbitrary_reporter_rejected(){let mut v=setup();deposit(&mut v,20);context("alice.testnet",0);v.record_result(id("alice.testnet"),"x".into(),U128(20),U128(20),1,"a".repeat(64));}
#[test]#[should_panic(expected="Unexpected token contract")]fn fake_token_rejected(){let mut v=setup();context("fake.testnet",0);v.ft_on_transfer(id("alice.testnet"),U128(20),"{}".into());}
#[test]fn malformed_or_unregistered_deposits_refund(){let mut v=setup();context(CIRCLE_TEST_USDC,0);assert_eq!(v.ft_on_transfer(id("alice.testnet"),U128(20),"{}".into()).0,20);assert_eq!(v.ft_on_transfer(id("bob.testnet"),U128(20),r#"{"kind":"deposit","session_id":"12345678-1234-1234-1234-123456789abc"}"#.into()).0,20);}
#[test]fn failed_withdraw_restores_exact_claim_and_duplicate_is_noop(){let mut v=setup();deposit(&mut v,20);reserve(&mut v,10);context("alice.testnet",1);v.withdraw(U128(7));invariant(&v,30);assert_eq!(v.total_claims,13);callback_env(PromiseResult::Failed);assert!(!v.finish_withdraw(id("alice.testnet"),1));assert_eq!(v.total_claims,20);invariant(&v,30);assert!(!v.finish_withdraw(id("alice.testnet"),1));invariant(&v,30);}
#[test]fn successful_withdraw_and_reserve_recovery(){let mut v=setup();deposit(&mut v,20);reserve(&mut v,10);context("alice.testnet",1);v.withdraw(U128(20));callback_env(PromiseResult::Successful(vec![]));assert!(v.finish_withdraw(id("alice.testnet"),1));invariant(&v,10);assert_eq!(v.get_claim(id("alice.testnet")).unwrap().withdrawn.0,20);context("owner.testnet",1);v.withdraw_reserve(U128(4));callback_env(PromiseResult::Failed);assert!(!v.finish_reserve(2));invariant(&v,10);assert_eq!(v.reserve,10);}
#[test]#[should_panic(expected="Withdrawal pending")]fn report_while_withdrawal_pending_rejected(){let mut v=setup();deposit(&mut v,20);context("alice.testnet",1);v.withdraw(U128(5));report(&mut v,15,16,1);}
#[test]#[should_panic(expected="Private callback")]fn forged_callback_rejected(){let mut v=setup();deposit(&mut v,20);context("alice.testnet",1);v.withdraw(U128(5));context("attacker.testnet",0);v.finish_withdraw(id("alice.testnet"),1);}
