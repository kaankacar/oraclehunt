//! Oracle Hunt ZK Fingerprint Contract
//!
//! Uses Stellar Protocol 25 (X-Ray) Poseidon host functions to derive
//! a deterministic, ZK-friendly identity fingerprint for each wallet address.
//!
//! The fingerprint is:
//!   Poseidon( wallet_address_bytes || salt )
//!
//! Properties:
//! - Deterministic: same wallet + same salt → same fingerprint, always
//! - ZK-friendly: Poseidon is circuit-efficient (optimal for SNARKs)
//! - Publicly verifiable: anyone can call verify_fingerprint to confirm
//!   a claimed fingerprint without needing the wallet private key
//! - Unlinkable in isolation: the fingerprint alone does not reveal
//!   the underlying wallet address without the salt

#![no_std]

use soroban_poseidon::poseidon2_hash;
use soroban_sdk::{
    contract, contractimpl, crypto::BnScalar, vec, xdr::ToXdr, Address, Bytes, BytesN, Env, U256,
};

#[contract]
pub struct ZkFingerprintContract;

#[contractimpl]
impl ZkFingerprintContract {
    /// Derive a Poseidon-based identity fingerprint for a wallet address.
    ///
    /// # Arguments
    /// * `wallet`  - The Stellar C-address (contract account) of the participant
    /// * `salt`    - 32-byte game-specific salt (stored server-side, same for all players)
    ///
    /// # Returns
    /// 32-byte Poseidon hash of (wallet_address_bytes || salt)
    pub fn derive_fingerprint(env: Env, wallet: Address, salt: BytesN<32>) -> BytesN<32> {
        // Serialize wallet address to raw bytes
        let wallet_bytes: Bytes = wallet.to_xdr(&env).into();

        // Build input vector: [wallet_bytes_as_field_element, salt_as_field_element]
        // Poseidon over BN254 Fr scalar field (32-byte field elements)
        let wallet_field = bytes_to_field_element(&env, &wallet_bytes);
        let salt_field = BnScalar::from_u256(U256::from_be_bytes(&env, &salt.to_bytes())).to_u256();

        let inputs = vec![&env, wallet_field, salt_field];
        let hash = poseidon2_hash::<3, BnScalar>(&env, &inputs);
        hash.to_be_bytes().try_into().unwrap()
    }

    /// Verify that a claimed fingerprint matches the on-chain derivation.
    ///
    /// # Arguments
    /// * `wallet`   - The wallet address to verify
    /// * `salt`     - The same salt used during derivation
    /// * `claimed`  - The fingerprint value the caller claims to own
    ///
    /// # Returns
    /// `true` if claimed == derive_fingerprint(wallet, salt), `false` otherwise
    pub fn verify_fingerprint(
        env: Env,
        wallet: Address,
        salt: BytesN<32>,
        claimed: BytesN<32>,
    ) -> bool {
        let expected = Self::derive_fingerprint(env, wallet, salt);
        expected == claimed
    }
}

/// Compress arbitrary-length bytes into a 32-byte BN254 Fr field element.
///
/// Strategy: SHA-256 the input, then mask the top byte to ensure
/// the result is < BN254 field prime (2^254 < p < 2^255).
/// This is standard practice for mapping arbitrary data into BN254 Fr.
fn bytes_to_field_element(env: &Env, input: &Bytes) -> U256 {
    // Hash to 32 bytes
    let hash: BytesN<32> = env.crypto().sha256(input).into();
    BnScalar::from_u256(U256::from_be_bytes(env, &hash.to_bytes())).to_u256()
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env};

    #[test]
    fn test_fingerprint_is_deterministic() {
        let env = Env::default();
        let contract_id = env.register(ZkFingerprintContract, ());
        let client = ZkFingerprintContractClient::new(&env, &contract_id);

        let wallet = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[42u8; 32]);

        let fp1 = client.derive_fingerprint(&wallet, &salt);
        let fp2 = client.derive_fingerprint(&wallet, &salt);

        assert_eq!(fp1, fp2, "Fingerprint must be deterministic");
    }

    #[test]
    fn test_different_wallets_produce_different_fingerprints() {
        let env = Env::default();
        let contract_id = env.register(ZkFingerprintContract, ());
        let client = ZkFingerprintContractClient::new(&env, &contract_id);

        let wallet_a = Address::generate(&env);
        let wallet_b = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[1u8; 32]);

        let fp_a = client.derive_fingerprint(&wallet_a, &salt);
        let fp_b = client.derive_fingerprint(&wallet_b, &salt);

        assert_ne!(fp_a, fp_b, "Different wallets must produce different fingerprints");
    }

    #[test]
    fn test_different_salts_produce_different_fingerprints() {
        let env = Env::default();
        let contract_id = env.register(ZkFingerprintContract, ());
        let client = ZkFingerprintContractClient::new(&env, &contract_id);

        let wallet = Address::generate(&env);
        let salt_a = BytesN::from_array(&env, &[0u8; 32]);
        let salt_b = BytesN::from_array(&env, &[255u8; 32]);

        let fp_a = client.derive_fingerprint(&wallet, &salt_a);
        let fp_b = client.derive_fingerprint(&wallet, &salt_b);

        assert_ne!(fp_a, fp_b, "Different salts must produce different fingerprints");
    }

    #[test]
    fn test_verify_fingerprint_correct() {
        let env = Env::default();
        let contract_id = env.register(ZkFingerprintContract, ());
        let client = ZkFingerprintContractClient::new(&env, &contract_id);

        let wallet = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[7u8; 32]);

        let fingerprint = client.derive_fingerprint(&wallet, &salt);
        let valid = client.verify_fingerprint(&wallet, &salt, &fingerprint);

        assert!(valid, "verify_fingerprint must return true for correct fingerprint");
    }

    #[test]
    fn test_verify_fingerprint_wrong_value() {
        let env = Env::default();
        let contract_id = env.register(ZkFingerprintContract, ());
        let client = ZkFingerprintContractClient::new(&env, &contract_id);

        let wallet = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[7u8; 32]);
        let wrong = BytesN::from_array(&env, &[0u8; 32]);

        let valid = client.verify_fingerprint(&wallet, &salt, &wrong);

        assert!(!valid, "verify_fingerprint must return false for wrong fingerprint");
    }
}
