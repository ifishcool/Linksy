import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: ['shiki', 'echarts', '@napi-rs/canvas', 'sharp'],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
