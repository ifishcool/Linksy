import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
  outputFileTracingExcludes: {
    '*': [
      'assets/**/*',
      'e2e/**/*',
      'tests/**/*',
      'README.md',
      'README-zh.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'Dockerfile',
      'docker-compose.yml',
    ],
  },
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
