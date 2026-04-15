/**
 * x402 fee & re-simulation test
 *
 * Diagnoses why the x402 facilitator returns HTTP 402 after our signing step.
 *
 * Root-cause hypothesis:
 *   The first AssembledTransaction.build() simulates BEFORE auth entries are
 *   signed (signature = scvVoid).  The passkey wallet's __check_auth runs
 *   cryptographic verification, so the second simulation (with a real signature)
 *   requires MORE instructions / fee.  Our code returns tx.toXDR() from the
 *   first simulation; the facilitator re-simulates and finds clientFee < minFee.
 *
 * What this test does:
 *   1. Build a USDC SAC transfer AssembledTransaction on testnet (= first sim).
 *   2. Record fee_1 = tx.simulation.minResourceFee.
 *   3. Sign auth entries with a fresh Ed25519 keypair (mock of passkey signing).
 *      This is a SIMPLIFIED model: the real passkey wallet's __check_auth
 *      verifies a secp256r1/webauthn signature which is heavier than Ed25519.
 *      The goal is to show that re-simulation CAN change the fee.
 *   4. Update tx.built with the signed transaction XDR.
 *   5. Re-simulate (= second sim) — record fee_2.
 *   6. Compare fee_1 vs fee_2.
 *   7. Optionally hit the x402.org /verify endpoint to show the exact error.
 *
 * Run with:
 *   node src/lib/__tests__/x402-fee-resim.cjs
 *
 * Note: requires active testnet RPC and a funded testnet account.
 * The signing here is Ed25519, NOT passkey. The real passkey wallet has a
 * heavier __check_auth and the fee difference would be even larger.
 */

'use strict';

const path = require('path');

// ── Resolve stellar-sdk from the pnpm store ────────────────────────────────
const PNPM_STORE = '/Users/kaan/oraclehunt/node_modules/.pnpm';
const SDK_PATH = path.join(
  PNPM_STORE,
  '@stellar+stellar-sdk@14.6.1/node_modules/@stellar/stellar-sdk/lib/index.js',
);
const sdk = require(SDK_PATH);
const { contract, nativeToScVal, TransactionBuilder, Keypair, xdr } = sdk;

// ── Constants ─────────────────────────────────────────────────────────────
const RPC_URL        = 'https://soroban-testnet.stellar.org';
const NETWORK        = 'Test SDF Network ; September 2015';

// Testnet USDC (Circle USDC SAC on testnet)
const USDC_CONTRACT  =
  process.env.USDC_CONTRACT ??
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

// A dummy payer contract address — we just need any valid Cxxx address
// to put in the `from` argument of the transfer. Use a known testnet
// passkey-kit wallet or fall back to a placeholder.
const PAYER_CONTRACT =
  process.env.PAYER_CONTRACT ??
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M';  // invalid — will fail sim; override via env

const PAY_TO         =
  process.env.PAY_TO ??
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'; // stellar null address

// 0.10 USDC = 1_000_000 stroops (7 decimal places)
const AMOUNT         = process.env.AMOUNT ?? '1000000';

// ── Helper ────────────────────────────────────────────────────────────────
function fmtFee(stroops) {
  return stroops != null ? `${Number(stroops).toLocaleString()} stroops` : 'n/a';
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== x402 fee re-simulation test ===\n');
  console.log(`RPC:           ${RPC_URL}`);
  console.log(`USDC contract: ${USDC_CONTRACT}`);
  console.log(`Payer:         ${PAYER_CONTRACT}`);
  console.log(`Pay to:        ${PAY_TO}`);
  console.log(`Amount:        ${AMOUNT} (= 0.10 USDC)\n`);

  // ── Step 1: Build + first simulation ──────────────────────────────────
  console.log('Step 1: building USDC transfer AssembledTransaction (first simulation)…');
  let tx;
  try {
    tx = await contract.AssembledTransaction.build({
      contractId: USDC_CONTRACT,
      method: 'transfer',
      args: [
        nativeToScVal(PAYER_CONTRACT, { type: 'address' }),
        nativeToScVal(PAY_TO, { type: 'address' }),
        nativeToScVal(AMOUNT, { type: 'i128' }),   // string form, matching ExactStellarScheme
      ],
      networkPassphrase: NETWORK,
      rpcUrl: RPC_URL,
      parseResultXdr: (result) => result,
    });
  } catch (e) {
    console.error('✗ AssembledTransaction.build failed:', e.message);
    console.log('\n  If PAYER_CONTRACT is a placeholder, simulation will fail because the');
    console.log('  address has no USDC trustline.  Set env vars:');
    console.log('    PAYER_CONTRACT=<real testnet passkey wallet address>');
    console.log('    PAY_TO=<oracle treasury address>');
    process.exit(1);
  }

  if (!tx.simulation || 'error' in tx.simulation) {
    const errMsg = tx.simulation ? tx.simulation.error : 'no simulation result';
    console.error('✗ First simulation failed:', errMsg);
    console.log('\n  Likely the PAYER_CONTRACT has no USDC balance/trustline or is invalid.');
    console.log('  Set PAYER_CONTRACT env var to a funded testnet wallet.');
    process.exit(1);
  }

  const fee1 = tx.simulation.minResourceFee;
  const txFee1 = tx.built?.fee;
  console.log(`✓ First simulation succeeded`);
  console.log(`  minResourceFee (sim 1):  ${fmtFee(fee1)}`);
  console.log(`  tx.built.fee   (sim 1):  ${fmtFee(txFee1)}`);

  // Inspect auth entries BEFORE signing
  const invokeOp = tx.built.operations[0];
  const authsBefore = invokeOp.auth ?? [];
  console.log(`\n  Auth entries before signing: ${authsBefore.length}`);
  for (const [i, auth] of authsBefore.entries()) {
    const credType = auth.credentials().switch().name;
    console.log(`    [${i}] credential type: ${credType}`);
    if (credType === 'sorobanCredentialsAddress') {
      const addr = auth.credentials().address();
      const sigSwitch = addr.signature().switch().name;
      console.log(`         address: ${sdk.Address.fromScAddress(addr.address()).toString()}`);
      console.log(`         signature switch (before sign): ${sigSwitch}  ← should be scvVoid`);
    }
  }

  // ── Step 2: Sign auth entries (Ed25519 mock) ───────────────────────────
  console.log('\nStep 2: signing auth entries with a fresh Ed25519 keypair (mock passkey)…');
  console.log('  (Real passkey uses secp256r1/WebAuthn — __check_auth is heavier than Ed25519)');

  const mockKeypair = Keypair.random();
  console.log(`  Mock signing key: ${mockKeypair.publicKey()}`);

  // Get current ledger for expiration
  const rpcServer = new sdk.rpc.Server(RPC_URL);
  const latestLedger = await rpcServer.getLatestLedger();
  const maxLedger = latestLedger.sequence + 12;  // 60s / 5s per ledger

  // signAuthEntries with our Ed25519 keypair — this is how the official
  // ExactStellarScheme signs for regular Stellar accounts.
  // For a passkey wallet (contract wallet), the real signAuthEntry is much
  // heavier (secp256r1 verification in __check_auth).
  await tx.signAuthEntries({
    address: PAYER_CONTRACT,
    signAuthEntry: async (authEntryXdr) => {
      // Ed25519 signing (simplified model of the passkey signing)
      const entryFromXdr = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
      const credentials = entryFromXdr.credentials().address();

      // Build the HashIdPreimage that passkey-kit would hash and sign
      const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
        new xdr.HashIdPreimageSorobanAuthorization({
          networkId: sdk.hash(Buffer.from(NETWORK)),
          nonce: credentials.nonce(),
          signatureExpirationLedger: maxLedger,
          invocation: entryFromXdr.rootInvocation(),
        }),
      );
      const payload = sdk.hash(preimage.toXDR());
      const sig = mockKeypair.sign(payload);

      // Set expiration and signature on the auth entry
      credentials.signatureExpirationLedger(maxLedger);
      // For Ed25519 signing, the signature is just the raw ed25519 signature bytes.
      // A real passkey wallet expects a map of { public_key → signature }.
      // We set a simplified structure here — enough to observe fee changes.
      credentials.signature(
        nativeToScVal({ [mockKeypair.publicKey()]: sig }, { type: 'map' })
      );

      return entryFromXdr.toXDR('base64');
    },
    expiration: maxLedger,
  });

  // Inspect auth entries AFTER signing
  const authsAfter = tx.built.operations[0].auth ?? [];
  console.log(`  Auth entries after signing: ${authsAfter.length}`);
  for (const [i, auth] of authsAfter.entries()) {
    const credType = auth.credentials().switch().name;
    if (credType === 'sorobanCredentialsAddress') {
      const addr = auth.credentials().address();
      const sigSwitch = addr.signature().switch().name;
      console.log(`    [${i}] signature switch (after sign): ${sigSwitch}  ← should NOT be scvVoid`);
    }
  }

  // ── Step 3: Capture the signed (pre-re-sim) tx XDR ────────────────────
  const signedTxXdrNoResim = tx.built.toEnvelope().toXDR('base64');
  console.log(`\n  Signed tx XDR (no re-sim): ${signedTxXdrNoResim.length} chars`);

  // ── Step 4: Re-simulate (as official ExactStellarScheme does) ─────────
  console.log('\nStep 3: re-simulating with signed auth entries (as official ExactStellarScheme does)…');
  await tx.simulate();

  if (!tx.simulation || 'error' in tx.simulation) {
    const errMsg = tx.simulation ? tx.simulation.error : 'no simulation result';
    console.error('✗ Re-simulation failed:', errMsg);
    console.log('  This confirms the payer wallet address or signature format is rejected.');
    console.log('  The REAL passkey wallet re-simulation would succeed if properly signed.');
  } else {
    const fee2 = tx.simulation.minResourceFee;
    const txFee2 = tx.built?.fee;
    console.log(`✓ Re-simulation succeeded`);
    console.log(`  minResourceFee (sim 2):  ${fmtFee(fee2)}`);
    console.log(`  tx.built.fee   (sim 2):  ${fmtFee(txFee2)}`);

    if (fee1 !== fee2) {
      console.log(`\n⚠️  FEE CHANGED between first and second simulation!`);
      console.log(`   fee_1 = ${fmtFee(fee1)}`);
      console.log(`   fee_2 = ${fmtFee(fee2)}`);
      console.log(`   delta = ${Number(fee2) - Number(fee1)} stroops`);
      console.log(`\n   DIAGNOSIS: The x402 facilitator re-simulates the signed tx.`);
      console.log(`   If we return the tx with fee_1, the facilitator finds clientFee < minFee`);
      console.log(`   and rejects with invalid_exact_stellar_payload_fee_below_minimum.`);
      console.log(`   FIX: re-simulate after signing, then return tx.built.toXDR().`);
    } else {
      console.log(`\n   Fees are the same (${fmtFee(fee1)}).`);
      console.log(`   Fee is not the issue — check signature format or simulation events.`);
    }

    const signedTxXdrWithResim = tx.built.toEnvelope().toXDR('base64');
    console.log(`\n  Signed tx XDR (with re-sim): ${signedTxXdrWithResim.length} chars`);
  }

  // ── Step 5: Check tx.toXDR() vs tx.built.toXDR() ─────────────────────
  console.log('\nStep 4: verify tx.toXDR() === tx.built.toEnvelope().toXDR("base64")…');
  const fromAssembled = tx.toXDR();
  const fromBuilt = tx.built.toEnvelope().toXDR('base64');
  if (fromAssembled === fromBuilt) {
    console.log('✓ Both return identical base64 (they call the same underlying method)');
  } else {
    console.log('✗ MISMATCH — tx.toXDR() and tx.built.toXDR() differ!');
    console.log('  This could be a source of the 402 error.');
  }

  // ── Step 6: Facilitator verify (with no-resim tx) ─────────────────────
  console.log('\nStep 5: calling x402.org/facilitator/verify with the NON-re-simulated tx…');
  const paymentRequirements = {
    scheme: 'exact',
    network: 'stellar:testnet',
    payTo: PAY_TO,
    asset: USDC_CONTRACT,
    amount: AMOUNT,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
  };
  const paymentPayload = {
    x402Version: 2,
    payload: { transaction: signedTxXdrNoResim },
    accepted: paymentRequirements,
  };

  try {
    const resp = await fetch('https://x402.org/facilitator/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload,
        paymentRequirements,
      }),
    });
    const body = await resp.json();
    console.log(`  HTTP ${resp.status}`);
    console.log(`  Response: ${JSON.stringify(body, null, 2)}`);

    if (!body.isValid) {
      console.log(`\n  ✗ Facilitator rejected: ${body.invalidReason}`);
      console.log(`     This confirms the specific verification check that fails.`);
    } else {
      console.log('\n  ✓ Facilitator accepted the non-re-simulated tx (fee was fine)');
    }
  } catch (e) {
    console.error('  ✗ Facilitator request failed:', e.message);
  }

  console.log('\n=== Summary ===');
  console.log('The official ExactStellarScheme.createPaymentPayload flow:');
  console.log('  1. AssembledTransaction.build()        ← first simulation (unsigned auth)');
  console.log('  2. tx.signAuthEntries(...)             ← signs auth entries');
  console.log('  3. await tx.simulate()                 ← RE-SIMULATION with signed auth');
  console.log('  4. return { transaction: tx.built.toXDR() }  ← post-resim fee/sorobanData');
  console.log('');
  console.log('Our buildPasskeyPaymentScheme flow (BEFORE fix):');
  console.log('  1. AssembledTransaction.build()        ← first simulation (unsigned auth)');
  console.log('  2. tx.toXDR()                          ← serialize (unsigned auth, fee_1)');
  console.log('  3. kit.sign(unsignedTxXdr)             ← signs auth entries inside kit');
  console.log('  4. return signedTxn.toXDR()            ← signed but STILL fee_1 sorobanData');
  console.log('');
  console.log('Fix: after kit.sign(), update tx.built with signed XDR, re-simulate, return tx.built.toXDR()');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
