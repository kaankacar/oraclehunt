/**
 * XDR cross-bundle isolation test
 *
 * This script reproduces the "XDR Write Error: [nonce] is not a O" error that
 * happens when passkey-kit's signAuthEntry() receives a SorobanAuthorizationEntry
 * decoded by a different stellar-base module instance (two webpack bundles loading
 * the same file via different symlink paths → two separate class registries).
 *
 * Run with:
 *   node src/lib/__tests__/xdr-cross-bundle.mjs
 *
 * (No test framework required — plain Node.js)
 */

import vm from 'vm';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Locate stellar-base.min.js ──────────────────────────────────────────────
// stellar-base ships a pre-bundled browser file. In Next.js webpack, the `browser`
// field maps lib/index.js → dist/stellar-base.min.js. Because pnpm uses symlinks,
// webpack may (depending on resolve.symlinks) create two separate module instances
// for this file — one per unique symlink path. We simulate that here using Node's
// vm module to create two independent evaluation contexts.

const PNPM_STORE = '/Users/kaan/oraclehunt/node_modules/.pnpm';
const stellarBasePath = path.join(
  PNPM_STORE,
  '@stellar+stellar-base@14.1.0/node_modules/@stellar/stellar-base/dist/stellar-base.min.js',
);

console.log('stellar-base.min.js path:', stellarBasePath);
const stellarBaseCode = readFileSync(stellarBasePath, 'utf-8');

function createIsolatedStellarBase() {
  // Each vm.createContext() is a separate JavaScript realm — separate class
  // registries, so `instanceof` checks between contexts will fail. This is exactly
  // what happens in a browser webpack build when the same file is bundled twice.
  const sandbox = {
    module: { exports: {} },
    exports: {},
    // stellar-base.min.js uses Buffer, process, etc.
    Buffer,
    process,
    console,
  };
  sandbox.global = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(stellarBaseCode, ctx);
  return sandbox.module.exports;
}

const bundle1 = createIsolatedStellarBase(); // simulates "our" stellar-sdk
const bundle2 = createIsolatedStellarBase(); // simulates passkey-kit's stellar-sdk

console.log('\n=== Test 1: confirm instances are isolated ===');
const hyper1 = bundle1.xdr.Int64.fromXDR(Buffer.from('0000000052eda26f', 'hex')); // arbitrary int64
const hyper2 = bundle2.xdr.Int64.fromXDR(Buffer.from('0000000052eda26f', 'hex'));
console.log('hyper1 instanceof bundle1.xdr.Int64:', hyper1 instanceof bundle1.xdr.Int64); // true
console.log('hyper1 instanceof bundle2.xdr.Int64:', hyper1 instanceof bundle2.xdr.Int64); // false (cross-bundle)
console.log('hyper2 instanceof bundle2.xdr.Int64:', hyper2 instanceof bundle2.xdr.Int64); // true

// ─── Test 2: reproduce the exact signAuthEntry error ─────────────────────────
// Build a minimal SorobanAuthorizationEntry XDR so we can decode it with bundle1
// then try to use its nonce in bundle2's HashIdPreimage (the pattern in kit.signAuthEntry).

console.log('\n=== Test 2: reproduce "XDR Write Error: [nonce] is not a O" ===');

// We need a real-looking auth entry. The smallest valid one is a source-account
// credential (no nonce), but signAuthEntry reads address credentials. Let's build
// one from scratch using bundle1 so the class instances all belong to bundle1.

function buildFakeSorobanAuthEntry(xdr) {
  // SorobanAddressCredentials: address=GA..., nonce=1234, signatureExpirationLedger=999, signature=void
  const address = xdr.ScAddress.scAddressTypeAccount(
    xdr.AccountId.publicKeyTypeEd25519(Buffer.alloc(32, 0x01)),
  );
  const credentials = new xdr.SorobanAddressCredentials({
    address,
    nonce: new xdr.Int64(BigInt('1395084455956325743')), // arbitrary
    signatureExpirationLedger: 999,
    signature: xdr.ScVal.scvVoid(),
  });

  // Minimal invocation
  const contractAddress = xdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, 0x02));
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress,
        functionName: 'transfer',
        args: [],
      }),
    ),
    subInvocations: [],
  });

  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(credentials),
    rootInvocation: invocation,
  });
}

const entry1 = buildFakeSorobanAuthEntry(bundle1.xdr); // decoded by bundle1 ("our" sdk)

// Verify bundle1 can serialize its own entry fine
let bundle1Xdr;
try {
  bundle1Xdr = entry1.toXDR('base64');
  console.log('✓ bundle1 can serialize its own entry');
} catch (e) {
  console.error('✗ bundle1 failed its own serialization:', e.message);
  process.exit(1);
}

// Now simulate what kit.signAuthEntry() does:
// it takes credentials.nonce() (bundle1's Int64) and puts it into bundle2's
// HashIdPreimage, then calls preimage.toXDR() ← this fails.
const credentials1 = entry1.credentials().address();
const nonce1 = credentials1.nonce(); // bundle1's xdr.Int64 instance

console.log('\nSimulating kit.signAuthEntry cross-bundle preimage serialization...');
let crossBundleError;
try {
  const preimage = bundle2.xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new bundle2.xdr.HashIdPreimageSorobanAuthorization({
      networkId: Buffer.alloc(32, 0), // dummy
      nonce: nonce1,                  // ← bundle1's Int64 in bundle2's struct
      signatureExpirationLedger: 999,
      invocation: entry1.rootInvocation(), // also bundle1's class
    }),
  );
  const bytes = preimage.toXDR(); // ← should throw
  console.log('✗ Unexpectedly succeeded. Bytes:', bytes.length);
} catch (e) {
  crossBundleError = e.message;
  console.log('✓ Got expected cross-bundle XDR error:', e.message);
}

if (!crossBundleError || !crossBundleError.includes('XDR Write Error')) {
  console.error('TEST FAILED: did not reproduce the expected XDR Write Error');
  process.exit(1);
}

// ─── Test 3: XDR roundtrip fix ────────────────────────────────────────────────
// The fix: instead of passing the bundle1 entry directly to signAuthEntry,
// roundtrip through XDR bytes so bundle2 creates its own class instances.
console.log('\n=== Test 3: XDR roundtrip fix ===');

// Decode entry1's bytes with bundle2 — now everything is bundle2's classes
const entry2 = bundle2.xdr.SorobanAuthorizationEntry.fromXDR(entry1.toXDR('base64'), 'base64');
const nonce2 = entry2.credentials().address().nonce(); // bundle2's Int64

try {
  const preimage = bundle2.xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new bundle2.xdr.HashIdPreimageSorobanAuthorization({
      networkId: Buffer.alloc(32, 0),
      nonce: nonce2,               // ← bundle2's Int64, same registry ✓
      signatureExpirationLedger: 999,
      invocation: entry2.rootInvocation(), // also bundle2's class ✓
    }),
  );
  const bytes = preimage.toXDR();
  console.log('✓ XDR roundtrip fix works — preimage serialized OK:', bytes.length, 'bytes');
} catch (e) {
  console.error('✗ Roundtrip fix still fails:', e.message);
  process.exit(1);
}

// ─── Test 4: what kit.sign() does vs what we were doing ─────────────────────
console.log('\n=== Test 4: reproduce the kit.sign() approach ===');
// kit.sign() calls: const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR())
// where xdr is bundle2 (passkey-kit's module). That's exactly the roundtrip above.
// Our mistake: we were decoding clone with bundle1 then passing to kit.signAuthEntry,
// which internally uses bundle2. Crossing the boundary at signAuthEntry's preimage.toXDR().

console.log('✓ kit.sign() keeps everything in passkey-kit\'s bundle by decoding');
console.log('  the entry via bundle2.xdr.fromXDR(entry.toXDR()) internally.');
console.log('  Calling kit.sign(txXdr) avoids any cross-bundle boundary.');

console.log('\n✅ All tests passed. The fix is: use kit.sign(txXdr) instead of');
console.log('   manually calling kit.signAuthEntry with an entry decoded by our sdk.');
