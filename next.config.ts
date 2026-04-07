import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.VERCEL || process.env.NETLIFY ? 'standalone' : undefined,
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
