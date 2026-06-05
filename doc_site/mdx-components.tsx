// Merges ApplePi documentation MDX components with Nextra's default docs components.
import type { MDXComponents } from 'mdx/types';
import { useMDXComponents as getNextraComponents } from 'nextra-theme-docs';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...getNextraComponents(),
    ...components,
  };
}
