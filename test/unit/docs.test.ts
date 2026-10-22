import { describe as suite, expect, it } from 'vitest';
import { cleanDoc } from '../../src/graph/docs';
import { extractors } from '../../src/graph/extractors';
import { GraphBuilder } from '../../src/graph/GraphBuilder';
import type { GraphPayload } from '../../src/shared/messages';
import { describe } from '../../webview/src/view';
import { getParser } from './helpers';

const extract = async (file: string, text: string) => {
  const facts = new GraphBuilder(await getParser(), extractors).extract(file, text)!;
  return Object.fromEntries(facts.nodes.map((n) => [n.label, n.meta?.doc]));
};

suite('doc comments', () => {
  it('cleans comment markers and keeps the first sentence', () => {
    expect(cleanDoc('/**\n * Loads users. Second sentence.\n * @param x y\n */')).toBe('Loads users.');
    expect(cleanDoc('// Sync helpers\n// for Vista')).toBe('Sync helpers for Vista');
    expect(cleanDoc('"""Fetch items from the API."""')).toBe('Fetch items from the API.');
    expect(cleanDoc('// ---------')).toBeUndefined();
  });

  it('reads file headers and symbol docs in TS, PHP and Python', async () => {
    expect(
      await extract(
        'app/admin/users/page.tsx',
        `'use client';\n// Admin list of users.\nimport x from 'y';\n\n/** Renders the table. */\nexport default function UsersPage() {}\n\n// unrelated\n\nfunction plain() {}\nconst arrow = () => 1; // trailing\n/** Arrow doc. */\nexport const docd = () => 2;\n`,
      ),
    ).toEqual({
      'page.tsx': 'Admin list of users.',
      UsersPage: 'Renders the table.',
      plain: undefined,
      arrow: undefined,
      docd: 'Arrow doc.',
    });
    expect(
      await extract(
        'a.php',
        `<?php\n/**\n * Plugin bootstrap.\n */\n\n/** Registers types. */\nfunction acme_reg() {}\n`,
      ),
    ).toEqual({ 'a.php': 'Plugin bootstrap.', acme_reg: 'Registers types.' });
    expect(
      await extract('a.py', `"""Item API."""\n\ndef get():\n    """Return items."""\n    return 1\n`),
    ).toEqual({
      'a.py': 'Item API.',
      get: 'Return items.',
    });
  });

  it('describes a Next.js page from its path, directive and definitions', async () => {
    const facts = new GraphBuilder(await getParser(), extractors).extract(
      'app/(admin)/users/page.tsx',
      `'use client';\nconst when = () => 1;\nexport default function UsersPage() {\n  const href = () => 2;\n  return <a />;\n}\n`,
    )!;
    const nodes = facts.nodes.map((n) => ({ ...n, status: 'unchanged' as const }));
    const g = { nodes, edges: [] } as unknown as GraphPayload;
    expect(describe(nodes[0]!, g)).toEqual({
      doc: undefined,
      facts: 'Page at /users. Runs in the browser (client component). Defines UsersPage, when.',
    });
  });
});
