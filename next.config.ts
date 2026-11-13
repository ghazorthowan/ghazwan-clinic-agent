import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  // Produces a self-contained .next/standalone directory for Docker
  output: 'standalone',
};
export default nextConfig;
