// Inspects materialization inputs without copying them or crossing their declared root.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isInside, realpathOrResolve } from '../dump/Containment.js';

export type ReferenceTreeIssueKind = 'escaped' | 'missing' | 'unreadable' | 'special' | 'directory-unreadable';

export interface ReferenceTreeIssue {
  readonly kind: ReferenceTreeIssueKind;
  readonly path: string;
}

type InspectedEntry =
  | { readonly kind: 'file' }
  | { readonly kind: 'directory'; readonly identity: string }
  | { readonly kind: 'issue'; readonly issue: ReferenceTreeIssue };

const inspectEntry = (path: string, root: string): InspectedEntry => {
  // A missing target has no real path. Let statSync classify it instead of comparing a lexical
  // macOS `/var` path with the canonical `/private/var` root and misreporting an escape.
  if (existsSync(path) && !isInside(path, root)) return { kind: 'issue', issue: { kind: 'escaped', path } };

  try {
    const stats = statSync(path);
    if (stats.isDirectory()) return { kind: 'directory', identity: realpathOrResolve(path) };
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
    const inspected = inspectEntry(current, root);
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
