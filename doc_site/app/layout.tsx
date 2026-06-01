// Defines the shared Nextra documentation shell for all Bridl docs pages.
import type { Metadata } from 'next';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import type { ReactNode } from 'react';

import 'nextra-theme-docs/style.css';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Bridl Documentation',
    template: '%s | Bridl',
  },
  description: 'Bridl profiles make agent harness configuration consistent, customizable, and reusable.',
};

const navbar = <Navbar logo={<strong>Bridl</strong>} projectLink="https://github.com/Unsupervisedcom/bridl" />;
const footer = <Footer>MIT {new Date().getFullYear()} © Bridl.</Footer>;

export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <Head>{null}</Head>
      </head>
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap('/')}
          docsRepositoryBase="https://github.com/Unsupervisedcom/bridl/tree/main/doc_site/app"
          footer={footer}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          toc={{ backToTop: true }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
