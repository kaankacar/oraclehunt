import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

async function fixPackageLayout() {
  const sdkRoot = path.join(
    repoRoot,
    'node_modules/.pnpm/@stellar+stellar-sdk@14.6.1/node_modules/@stellar/stellar-sdk',
  )
  const rootPackagePath = path.join(sdkRoot, 'package.json')
  const libDir = path.join(sdkRoot, 'lib')
  const libPackagePath = path.join(libDir, 'package.json')

  const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8'))
  const shimPackage = {
    name: rootPackage.name,
    version: rootPackage.version,
    private: true,
  }

  await mkdir(libDir, { recursive: true })
  await writeFile(libPackagePath, `${JSON.stringify(shimPackage, null, 2)}\n`, 'utf8')
  console.log(`wrote ${path.relative(repoRoot, libPackagePath)}`)
}

fixPackageLayout().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
