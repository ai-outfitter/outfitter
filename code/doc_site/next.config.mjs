import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextra from 'nextra';

const docSiteRoot = dirname(fileURLToPath(import.meta.url));
const withNextra = nextra({});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: docSiteRoot,
    resolveAlias: {
      'next-mdx-import-source-file': './mdx-components.tsx',
    },
  },
};

export default withNextra(nextConfig);
