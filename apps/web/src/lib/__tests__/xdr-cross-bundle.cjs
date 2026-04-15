/**
 * XDR cross-bundle isolation test
 *
 * Documents and reproduces the "XDR Write Error: [nonce] is not a O" error
 * that occurs when passkey-kit's signAuthEntry() receives a SorobanAuthorizationEntry
 * decoded by a different stellar-base module instance.
 *
 * Root cause:
 *   kit.signAuthEntry(clone) builds a HashIdPreimage using passkey-kit's own xdr module,
 *   but populates it with values from `clone` (decoded by our stellar-sdk). If the two
 *   module instances have different class registries (e.g. two webpack bundles), the
 *   Int64 type check fails: "XDR Write Error: [nonce] is not a O" where "O" is the
 *   minified class name for Int64/Hyper in stellar-base.min.js.
 *
 *   In Next.js with webpack symlinks:true, all packages should resolve to the SAME
 *   physical stellar-base.min.js — but the error still occurs in practice, suggesting
 *   either the symlink resolution is incomplete for some imports or there is a
 *   different root cause (e.g. stellar-sdk exports field using CJS for ./contract paths).
 *
 * Fix:
 *   Use kit.sign(txXdr) instead of kit.signAuthEntry directly. kit.sign() decodes the
 *   XDR using AssembledTransaction.fromXDR which uses passkey-kit's OWN stellar-sdk,
 *   ensuring all class instances throughout the sign flow are from the same module.
 *
 * Run with:
 *   node src/lib/__tests__/xdr-cross-bundle.cjs
 *
 * NOTE: Node.js cannot reproduce the browser module isolation because require() resolves
 * symlinks to physical paths and caches by physical path. The test below demonstrates
 * the class incompatibility concept using Node.js VM contexts as a proxy.
 */

'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ─── Locate stellar-base ──────────────────────────────────────────────────────
const PNPM_STORE = '/Users/kaan/oraclehunt/node_modules/.pnpm';
const STELLAR_BASE_LIB = path.join(
  PNPM_STORE,
  '@stellar+stellar-base@14.1.0/node_modules/@stellar/stellar-base/lib/index.js',
);

// ─── Test 1: Node.js module deduplication (confirm baseline) ─────────────────
console.log('=== Test 1: Node.js module deduplication ===');
const bundle1 = require(STELLAR_BASE_LIB);
// Delete cache and reload to simulate two bundle instances
const allStellarKeys = Object.keys(require.cache).filter(
  (k) => k.includes('@stellar') || k.includes('js-xdr'),
);
allStellarKeys.forEach((k) => delete require.cache[k]);
const bundle2 = require(STELLAR_BASE_LIB);

const h1 = new bundle1.xdr.Int64(BigInt('5978720575064240305'));
const sameInstance = h1 instanceof bundle2.xdr.Int64;
console.log(`h1 instanceof bundle2.xdr.Int64: ${sameInstance}`);

if (sameInstance) {
  console.log('⚠️  In Node.js, the modules share one class registry (require cache deduplicated).');
  console.log('   The browser error still occurs because webpack may create separate instances.');
  console.log('   This test documents the bug; it cannot reproduce it in Node.js.\n');
} else {
  // Actually isolated — run the full test
  console.log('✓ Modules are isolated\n');
  runIsolationTests(bundle1, bundle2);
}

// ─── Test 2: Document kit.signAuthEntry's problematic pattern ─────────────────
console.log('=== Test 2: kit.signAuthEntry cross-bundle pattern (documented) ===');
console.log(`
The error occurs inside kit.signAuthEntry at this code (passkey-kit/src/kit.ts:263-272):

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(this.networkPassphrase)),
      nonce: credentials.nonce(),        // ← our stellar-sdk's Int64 instance
      signatureExpirationLedger: ...,
      invocation: entry.rootInvocation() // ← our stellar-sdk's class
    })
  )
  const payload = hash(preimage.toXDR()) // ← THROWS: "[nonce] is not a O"

Where:
  - xdr = passkey-kit's stellar-sdk xdr module
  - credentials, nonce, invocation = from clone decoded by OUR stellar-sdk

If the two module instances diverge (two separate class registries), the Int64
instanceof check in passkey-kit's xdr.Int64.write() fails.

Verification: "O" is the minified class name for Int64/Hyper in stellar-base.min.js.
`);

// ─── Test 3: Verify the fix — kit.sign() pattern ──────────────────────────────
console.log('=== Test 3: kit.sign() approach (the fix) ===');
console.log(`
kit.sign(txXdr) works because it calls:

  AssembledTransaction.fromXDR(this.wallet!.options, txXdr, this.wallet!.spec)

Which decodes the XDR using passkey-kit's own stellar-sdk:

  txn.built = TransactionBuilder.fromXDR(envelope, networkPassphrase)
                    ↑ passkey-kit's TransactionBuilder

Then internally calls signAuthEntries with:

  authorizeEntry: (entry) => {
    const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR())
                          ↑ passkey-kit's xdr module
    return this.signAuthEntry(clone, options) // clone is all-passkey-kit classes
  }

All class instances throughout sign flow → same module → no instanceof mismatch.

AssembledTransaction.fromXDR does NOT validate the spec during signing —
it only extracts the method name and sets txn.built. Safe for USDC transfer txs.
`);

// ─── Test 4: Smoke test — confirm our stellar-sdk XDR types work ──────────────
console.log('=== Test 4: stellar-sdk XDR type smoke test ===');
const stellarSdk = require(path.join(
  PNPM_STORE,
  '@stellar+stellar-sdk@14.6.1/node_modules/@stellar/stellar-sdk/lib/index.js',
));

// Confirm Int64 is accessible
const testNonce = new stellarSdk.xdr.Int64(BigInt('5978720575064240305'));
console.log('stellarSdk.xdr.Int64 instance:', testNonce.constructor.name || 'anonymous');

// Confirm isValid check from js-xdr
const isValid = typeof testNonce === 'bigint' || testNonce instanceof stellarSdk.xdr.Int64;
console.log('isValid(testNonce):', isValid); // should be true

if (!isValid) {
  console.error('✗ FAIL: Int64 isValid check failed even for same-module instance!');
  console.error('  This would mean the error is NOT about cross-bundle isolation.');
  process.exit(1);
}
console.log('✓ Same-module Int64 isValid: true\n');

console.log('=== Summary ===');
console.log('Fix implemented: buildPasskeyPaymentScheme now uses kit.sign(txXdr) instead');
console.log('of kit.signAuthEntry, keeping all XDR operations within passkey-kit\'s module.');
console.log('\nRun the oracle payment in the browser to confirm the fix.');

function runIsolationTests(b1, b2) {
  // Only runs if Node.js actually isolates the modules (which it currently doesn't)
  console.log('=== Cross-bundle isolation tests ===');

  function buildFakeAuthEntry(xdr) {
    const address = xdr.ScAddress.scAddressTypeAccount(
      xdr.AccountId.publicKeyTypeEd25519(Buffer.alloc(32, 0x01)),
    );
    const creds = new xdr.SorobanAddressCredentials({
      address,
      nonce: new xdr.Int64(BigInt('5978720575064240305')),
      signatureExpirationLedger: 999,
      signature: xdr.ScVal.scvVoid(),
    });
    const inv = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: xdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, 0x02)),
          functionName: 'transfer',
          args: [],
        }),
      ),
      subInvocations: [],
    });
    return new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(creds),
      rootInvocation: inv,
    });
  }

  const entry1 = buildFakeAuthEntry(b1.xdr);

  // Simulate what kit.signAuthEntry does (using b2's xdr with b1's values):
  try {
    const preimage = b2.xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new b2.xdr.HashIdPreimageSorobanAuthorization({
        networkId: Buffer.alloc(32),
        nonce: entry1.credentials().address().nonce(), // b1's Int64
        signatureExpirationLedger: 999,
        invocation: entry1.rootInvocation(), // b1's class
      }),
    );
    preimage.toXDR();
    console.log('✗ Did not reproduce the error');
  } catch (e) {
    console.log('✓ Reproduced error:', e.message);
  }

  // Fix: roundtrip through XDR bytes first
  const entry2 = b2.xdr.SorobanAuthorizationEntry.fromXDR(entry1.toXDR('base64'), 'base64');
  try {
    const preimage = b2.xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new b2.xdr.HashIdPreimageSorobanAuthorization({
        networkId: Buffer.alloc(32),
        nonce: entry2.credentials().address().nonce(), // b2's Int64 ✓
        signatureExpirationLedger: 999,
        invocation: entry2.rootInvocation(), // b2's class ✓
      }),
    );
    preimage.toXDR();
    console.log('✓ XDR roundtrip fix works');
  } catch (e) {
    console.error('✗ Fix still fails:', e.message);
  }
}
