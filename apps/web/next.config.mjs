/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['passkey-kit', 'passkey-kit-sdk', 'sac-sdk'],
  experimental: { typedRoutes: true },
}

export default config
