// Defines the shared Nextra documentation shell for all Outfitter docs pages.
import type { Metadata } from 'next';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import type { ReactNode } from 'react';

import 'nextra-theme-docs/style.css';
import './globals.css';

const tagline = 'Make, share, and switch the profiles your coding agents use — manually or programmatically.';

export const metadata: Metadata = {
  title: {
    default: 'Outfitter — Coding Agent Profiles',
    template: '%s | Outfitter',
  },
  description: tagline,
  openGraph: {
    siteName: 'Outfitter',
    title: 'Outfitter — Coding Agent Profiles',
    description: tagline,
    type: 'website',
  },
};

const navbar = <Navbar logo={<strong>Outfitter</strong>} projectLink="https://github.com/ai-outfitter/outfitter" />;
const footer = <Footer>BUSL-1.1 {new Date().getFullYear()} © Outfitter.</Footer>;

export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head faviconGlyph="◇" />
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap('/')}
          docsRepositoryBase="https://github.com/ai-outfitter/outfitter/tree/main/code/doc_site/app"
          editLink={null}
          footer={footer}
          nextThemes={{ forcedTheme: 'dark' }}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          toc={{ backToTop: true }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
