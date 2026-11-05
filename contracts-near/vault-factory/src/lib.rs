use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde_json::{json, to_vec};

const STORAGE_BUFFER: u128 = 300_000_000_000_000_000_000_000;
const STORAGE_PER_BYTE: u128 = 10_000_000_000_000_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    vault_code: Vec<u8>,
    reporter: AccountId,
}

#[near]
impl Factory {
    #[init]
    pub fn new(vault_code: Base64VecU8, reporter: AccountId) -> Self {
        let current = env::current_account_id();
        assert!(current.as_str().ends_with(".testnet"), "Testnet only");
        let parent = env::predecessor_account_id();
        assert_eq!(env::signer_account_id(), parent, "Parent wallet only");
        assert_eq!(current.as_str(), format!("pl.{parent}"), "Factory must be the parent's pv child");
        assert!((1..=450_000).contains(&vault_code.0.len()), "Invalid vault code size");
        Self { vault_code: vault_code.0, reporter }
    }

    pub fn funding(&self) -> U128 {
        U128(self.vault_code.len() as u128 * STORAGE_PER_BYTE + STORAGE_BUFFER)
    }

    pub fn reporter_id(&self)->AccountId {self.reporter.clone()}

    pub fn vault_code_hash(&self) -> Base64VecU8 {
        Base64VecU8(env::sha256(&self.vault_code))
    }

    #[payable]
    pub fn deploy(
        &mut self,
        agent_id: String,
        manifest_hash: String,
        strategy_id: String,
        strategy_hash: String,
        name: String,
        initial_equity: U128,
        public: bool,
        open_after_archive: bool,
        previous_vault: Option<AccountId>,
    ) -> Promise {
        let owner = env::predecessor_account_id();
        assert_eq!(owner, env::signer_account_id(), "Owner wallet only");
        assert_eq!(env::attached_deposit().as_yoctonear(), self.funding().0, "Incorrect vault funding");
        assert!(uuid(&agent_id) && uuid(&strategy_id), "Invalid strategy binding");
        assert!(hash(&manifest_hash) && hash(&strategy_hash), "Invalid commitment");
        assert!(!name.is_empty() && name.len() <= 64, "Invalid name");
        let factory = env::current_account_id();
        let digest = env::sha256(format!("{owner}:{strategy_id}").as_bytes());
        let label: String = digest[..12].iter().map(|byte| format!("{byte:02x}")).collect();
        let vault: AccountId = format!("s{label}.{factory}").parse().expect("Vault account too long");
        if let Some(old) = &previous_vault {
            assert_ne!(old, &vault, "Cannot archive the new vault");
            assert!(old.as_str().ends_with(&format!(".{factory}")), "Previous vault must belong to this factory");
        }
        Promise::new(vault.clone())
            .create_account()
            .transfer(env::attached_deposit())
            .deploy_contract(self.vault_code.clone())
            .function_call(
                "new_live".into(),
                to_vec(&json!({
                    "agent_id": agent_id, "manifest_hash": manifest_hash,
                    "strategy_id": strategy_id, "strategy_hash": strategy_hash,
                    "name": name, "owner_id": owner, "reporter_id": self.reporter, "initial_equity":initial_equity,
                    "public": public, "factory_id": factory
                })).unwrap(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(30),
            )
            .then(Promise::new(factory).function_call(
                "finish_deployment".into(),
                to_vec(&json!({"owner": owner, "previous_vault": previous_vault, "agent_id": agent_id, "vault": vault, "open_after_archive": open_after_archive})).unwrap(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(75),
            ))
    }

    #[private]
    pub fn finish_deployment(
        &self,
        owner: AccountId,
        previous_vault: Option<AccountId>,
        agent_id: String,
        vault: AccountId,
        open_after_archive: bool,
    ) -> PromiseOrValue<bool> {
        if !matches!(env::promise_result(0), near_sdk::PromiseResult::Successful(_)) {
            // The failed action batch refunds its transfer to the factory. Refund the wallet.
            return PromiseOrValue::Promise(Promise::new(owner).transfer(
                NearToken::from_yoctonear(self.funding().0),
            ));
        }
        let Some(old) = previous_vault else { return PromiseOrValue::Value(true) };
        let archive = Promise::new(old).function_call(
            "archive".into(),
            to_vec(&json!({"agent_id": agent_id})).unwrap(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(12),
        );
        if !open_after_archive { return PromiseOrValue::Promise(archive); }
        PromiseOrValue::Promise(archive.then(Promise::new(env::current_account_id()).function_call(
            "open_after_archive".into(),
            to_vec(&json!({"vault": vault})).unwrap(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(35),
        )))
    }

    #[private]
    pub fn open_after_archive(&self, vault: AccountId) -> Promise {
        assert!(matches!(env::promise_result(0), near_sdk::PromiseResult::Successful(_)),
            "Previous vault could not be archived");
        Promise::new(vault).function_call(
            "publish".into(), b"{}".to_vec(), NearToken::from_yoctonear(0), Gas::from_tgas(12),
        )
    }

}

fn uuid(value: &str) -> bool {
    value.len() == 36 && value.bytes().enumerate().all(|(i, byte)| {
        if [8, 13, 18, 23].contains(&i) { byte == b'-' } else { byte.is_ascii_hexdigit() }
    })
}

fn hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
