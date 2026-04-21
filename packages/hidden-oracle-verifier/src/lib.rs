#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Fr},
    vec, BytesN, Env, U256, Vec,
};

mod generated;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum HiddenOracleVerifierError {
    InvalidPublicSignalCount = 1,
}

#[contract]
pub struct HiddenOracleVerifier;

#[contractimpl]
impl HiddenOracleVerifier {
    pub fn verify(
        env: Env,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        pub_signals: Vec<U256>,
    ) -> Result<bool, HiddenOracleVerifierError> {
        if pub_signals.len() + 1 != generated::IC_LEN as u32 {
            return Err(HiddenOracleVerifierError::InvalidPublicSignalCount);
        }

        let bn254 = env.crypto().bn254();
        let alpha = Bn254G1Affine::from_array(&env, &generated::ALPHA_G1);
        let beta = Bn254G2Affine::from_array(&env, &generated::BETA_G2);
        let gamma = Bn254G2Affine::from_array(&env, &generated::GAMMA_G2);
        let delta = Bn254G2Affine::from_array(&env, &generated::DELTA_G2);

        let proof_a = Bn254G1Affine::from_array(&env, &proof_a.to_array());
        let proof_b = Bn254G2Affine::from_array(&env, &proof_b.to_array());
        let proof_c = Bn254G1Affine::from_array(&env, &proof_c.to_array());

        let mut vk_x = Bn254G1Affine::from_array(&env, &generated::IC[0]);
        for (index, signal) in pub_signals.iter().enumerate() {
            let ic_point = Bn254G1Affine::from_array(&env, &generated::IC[index as usize + 1]);
            let scalar = Fr::from_u256(signal);
            let product = bn254.g1_mul(&ic_point, &scalar);
            vk_x = bn254.g1_add(&vk_x, &product);
        }

        let neg_a = -proof_a;
        let g1_points = vec![&env, neg_a, alpha, vk_x, proof_c];
        let g2_points = vec![&env, proof_b, beta, gamma, delta];

        Ok(bn254.pairing_check(g1_points, g2_points))
    }
}
