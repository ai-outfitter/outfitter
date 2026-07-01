// Defines the shared Nextra documentation shell for all Outfitter docs pages.
import type { Metadata } from 'next';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import type { ReactNode } from 'react';

import 'nextra-theme-docs/style.css';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Outfitter Documentation',
    template: '%s | Outfitter',
  },
  description: 'Outfitter profiles make agent harness configuration consistent, customizable, and reusable.',
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
