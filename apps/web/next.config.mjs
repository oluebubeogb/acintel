/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { outputFileTracingRoot: new URL('../../', import.meta.url).pathname },
};
export default nextConfig;
