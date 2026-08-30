// Inspects materialization inputs without copying them or crossing their declared root.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isLexicallyInside, realpathOrResolve } from '../dump/Containment.js';

export type ReferenceTreeIssueKind = 'escaped' | 'missing' | 'unreadable' | 'special' | 'directory-unreadable';

export interface ReferenceTreeIssue {
  readonly kind: ReferenceTreeIssueKind;
  readonly path: string;
}

type InspectedEntry =
  | { readonly kind: 'file' }
  | { readonly kind: 'directory'; readonly identity: string }
  | { readonly kind: 'issue'; readonly issue: ReferenceTreeIssue };

// `rootIdentity` is the caller's already-resolved root, so a walk realpaths it once instead of once
// per entry.
const inspectEntry = (path: string, rootIdentity: string): InspectedEntry => {
  // A missing target has no real path. Let statSync classify it instead of comparing a lexical
  // macOS `/var` path with the canonical `/private/var` root and misreporting an escape.
  const identity = existsSync(path) ? realpathOrResolve(path) : undefined;
  if (identity !== undefined && !isLexicallyInside(identity, rootIdentity)) {
    return { kind: 'issue', issue: { kind: 'escaped', path } };
  }

  try {
    const stats = statSync(path);
    // An existing entry already resolved above; only a race could leave `identity` undefined here.
    if (stats.isDirectory()) return { kind: 'directory', identity: identity ?? realpathOrResolve(path) };
    if (stats.isFile()) return { kind: 'file' };
    return { kind: 'issue', issue: { kind: 'special', path } };
  } catch (error) {
    const kind = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable';
    return { kind: 'issue', issue: { kind, path } };
  }
};

export const inspectReferenceTree = (
  target: string,
  root: string,
  visitedDirectories: Set<string>,
): readonly ReferenceTreeIssue[] => {
  const pending = [target];
  const issues: ReferenceTreeIssue[] = [];
  const rootIdentity = realpathOrResolve(root);

  while (pending.length > 0) {
    const current = pending.pop()!;
    const inspected = inspectEntry(current, rootIdentity);
    if (inspected.kind === 'issue') {
      issues.push(inspected.issue);
      continue;
    }
    if (inspected.kind === 'file') continue;

    const visitKey = `${rootIdentity}\0${inspected.identity}`;
    if (visitedDirectories.has(visitKey)) continue;
    visitedDirectories.add(visitKey);

    try {
      const children = readdirSync(current)
        .sort()
        .map((name) => join(current, name));
      pending.push(...children.reverse());
    } catch {
      issues.push({ kind: 'directory-unreadable', path: current });
    }
  }

  return issues;
};
