pragma circom 2.2.3;

include "./vendor/circomlib/poseidon.circom";

template HiddenOracleProof() {
    signal input walletField;
    signal input phraseField;
    signal input saltField;

    signal input nonce;
    signal input expectedFingerprint;
    signal input expectedPhraseField;

    signal output nullifier;

    component fingerprintHasher = Poseidon(2);
    fingerprintHasher.inputs[0] <== walletField;
    fingerprintHasher.inputs[1] <== saltField;
    fingerprintHasher.out === expectedFingerprint;

    phraseField === expectedPhraseField;

    component nullifierHasher = Poseidon(3);
    nullifierHasher.inputs[0] <== expectedFingerprint;
    nullifierHasher.inputs[1] <== expectedPhraseField;
    nullifierHasher.inputs[2] <== nonce;
    nullifier <== nullifierHasher.out;
}

component main {public [nonce, expectedFingerprint, expectedPhraseField]} = HiddenOracleProof();
