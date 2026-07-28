import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Produces .next/standalone with only the traced files, which is what the runtime
  // image copies. Keeps the published image small and free of build tooling.
  output: 'standalone',
  // Monorepo root, so tracing follows the workspace packages rather than stopping at apps/web.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  // node-postgres loads native/optional modules at runtime; leave it out of the bundle.
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
