import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')
const DEFAULT_PHRASE = process.env.HIDDEN_ORACLE_PASSPHRASE ?? 'LIQUIDITY'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const zkRoot = path.resolve(__dirname, '..')
const circuitRoot = path.join(zkRoot, 'circuits')
const buildRoot = path.join(zkRoot, 'build')
const artifactsRoot = path.join(zkRoot, 'artifacts')
const publicRoot = path.resolve(zkRoot, '../../apps/web/public/zk')
const workerGeneratedRoot = path.resolve(zkRoot, '../../apps/workers/src/generated')
const verifierRoot = path.resolve(zkRoot, '../../packages/hidden-oracle-verifier/src')
const ptauEntropy = process.env.HIDDEN_ORACLE_PTAU_ENTROPY ?? randomBytes(32).toString('hex')
const zkeyEntropy = process.env.HIDDEN_ORACLE_ZKEY_ENTROPY ?? randomBytes(32).toString('hex')

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`)
  }
}

function sha256Field(input) {
  const digest = createHash('sha256').update(input).digest('hex')
  return (BigInt(`0x${digest}`) % FIELD_MODULUS).toString()
}

function encodeFq(value) {
  const hex = BigInt(value).toString(16).padStart(64, '0')
  return Array.from(Buffer.from(hex, 'hex'))
}

function encodeG1(point) {
  return [...encodeFq(point[0]), ...encodeFq(point[1])]
}

function encodeG2(point) {
  return [
    ...encodeFq(point[0][1]),
    ...encodeFq(point[0][0]),
    ...encodeFq(point[1][1]),
    ...encodeFq(point[1][0]),
  ]
}

function rustByteArray(bytes) {
  return bytes.join(', ')
}

function writeGeneratedVerifier(vk) {
  const icArrays = vk.IC.map((point) => `    [${rustByteArray(encodeG1(point))}]`).join(',\n')

  const rustSource = `pub const ALPHA_G1: [u8; 64] = [${rustByteArray(encodeG1(vk.vk_alpha_1))}];
pub const BETA_G2: [u8; 128] = [${rustByteArray(encodeG2(vk.vk_beta_2))}];
pub const GAMMA_G2: [u8; 128] = [${rustByteArray(encodeG2(vk.vk_gamma_2))}];
pub const DELTA_G2: [u8; 128] = [${rustByteArray(encodeG2(vk.vk_delta_2))}];
pub const IC_LEN: usize = ${vk.IC.length};
pub const IC: [[u8; 64]; IC_LEN] = [
${icArrays}
];
`

  writeFileSync(path.join(verifierRoot, 'generated.rs'), rustSource)
}

rmSync(buildRoot, { recursive: true, force: true })
mkdirSync(buildRoot, { recursive: true })
mkdirSync(artifactsRoot, { recursive: true })
mkdirSync(publicRoot, { recursive: true })
mkdirSync(workerGeneratedRoot, { recursive: true })

const circuitPath = path.join(circuitRoot, 'hidden_oracle.circom')
run('circom', ['--r1cs', '--wasm', '--sym', '-p', 'bn128', '-o', buildRoot, circuitPath], zkRoot)

run('snarkjs', ['powersoftau', 'new', 'bn128', '12', path.join(buildRoot, 'pot12_0000.ptau'), '-v'], zkRoot)
run('snarkjs', [
  'powersoftau',
  'contribute',
  path.join(buildRoot, 'pot12_0000.ptau'),
  path.join(buildRoot, 'pot12_0001.ptau'),
  '--name=oraclehunt ptau',
  `-e=${ptauEntropy}`,
], zkRoot)
run('snarkjs', ['powersoftau', 'prepare', 'phase2', path.join(buildRoot, 'pot12_0001.ptau'), path.join(buildRoot, 'pot12_final.ptau')], zkRoot)
run('snarkjs', ['groth16', 'setup', path.join(buildRoot, 'hidden_oracle.r1cs'), path.join(buildRoot, 'pot12_final.ptau'), path.join(buildRoot, 'hidden_oracle_0000.zkey')], zkRoot)
run('snarkjs', [
  'zkey',
  'contribute',
  path.join(buildRoot, 'hidden_oracle_0000.zkey'),
  path.join(buildRoot, 'hidden_oracle_final.zkey'),
  '--name=oraclehunt phase2',
  `-e=${zkeyEntropy}`,
], zkRoot)
run('snarkjs', ['zkey', 'export', 'verificationkey', path.join(buildRoot, 'hidden_oracle_final.zkey'), path.join(buildRoot, 'verification_key.json')], zkRoot)

cpSync(path.join(buildRoot, 'hidden_oracle_js/hidden_oracle.wasm'), path.join(publicRoot, 'hidden_oracle.wasm'))
cpSync(path.join(buildRoot, 'hidden_oracle_final.zkey'), path.join(publicRoot, 'hidden_oracle_final.zkey'))
cpSync(path.join(buildRoot, 'verification_key.json'), path.join(artifactsRoot, 'verification_key.json'))

const expectedPhraseField = sha256Field(DEFAULT_PHRASE.trim().toUpperCase())
const verificationKey = JSON.parse(readFileSync(path.join(buildRoot, 'verification_key.json'), 'utf8'))
writeGeneratedVerifier(verificationKey)

const metadataJson = JSON.stringify(
  {
    circuit: 'hidden_oracle',
    phraseNormalization: 'trim + uppercase + sha256 -> field',
    expectedPhraseField,
    publicSignalsOrder: ['nullifier', 'nonce', 'expectedFingerprint', 'expectedPhraseField'],
    wasmPath: '/zk/hidden_oracle.wasm',
    zkeyPath: '/zk/hidden_oracle_final.zkey',
  },
  null,
  2,
)

writeFileSync(path.join(artifactsRoot, 'metadata.json'), metadataJson)
writeFileSync(path.join(workerGeneratedRoot, 'hidden-oracle-zk-metadata.json'), metadataJson)
