// Defines the shared Nextra documentation shell for all ApplePi docs pages.
import type { Metadata } from 'next';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import type { ReactNode } from 'react';

import 'nextra-theme-docs/style.css';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ApplePi Documentation',
    template: '%s | ApplePi',
  },
  description: 'ApplePi profiles make agent harness configuration consistent, customizable, and reusable.',
};

const navbar = <Navbar logo={<strong>ApplePi</strong>} projectLink="https://github.com/Unsupervisedcom/applepi" />;
const footer = <Footer>BUSL-1.1 {new Date().getFullYear()} © ApplePi.</Footer>;

export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head faviconGlyph="◇" />
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap('/')}
          docsRepositoryBase="https://github.com/Unsupervisedcom/applepi/tree/main/doc_site/app"
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
