import { describe, expect, it } from 'vitest';
import { resolveImport } from '../../src/graph/resolve';
import { builderFor, edgeList, fixture } from './helpers';

describe('imports extractor (golden graphs)', () => {
  it('JS/TS: ESM, require, re-export, dynamic import, .js->.ts, @/ alias; ignores packages', async () => {
    const g = (await builderFor(fixture('js-app'))).build();
    expect(edgeList(g, ['imports'])).toEqual([
      'src/app/api/items/route.ts -> src/lib/util.ts (imports)',
      'src/components/App.tsx -> src/components/Button.tsx (imports)',
      'src/index.ts -> src/lib/util.ts (imports)',
      'src/index.ts -> src/server.ts (imports)',
      'src/lazy.js -> src/lib/index.ts (imports)',
      'src/lib/index.ts -> src/lib/util.ts (imports)',
      'src/server.ts -> src/lib/util.ts (imports)',
    ]);
  });

  it('Python: relative, absolute, package and submodule imports', async () => {
    const g = (await builderFor(fixture('py-app'))).build();
    expect(edgeList(g, ['imports'])).toEqual([
      'app/main.py -> app/__init__.py (imports)',
      'app/main.py -> app/models.py (imports)',
      'app/main.py -> app/routes.py (imports)',
      'app/main.py -> app/utils.py (imports)',
      'app/routes.py -> app/models.py (imports)',
    ]);
  });
});

describe('imports extractor (PHP)', () => {
  it('resolves require/include with __DIR__, plugin_dir_path(__FILE__) and plain paths', async () => {
    const g = (await builderFor(fixture('wp-plugin'))).build();
    expect(edgeList(g, ['imports'])).toEqual([
      'acme-plugin.php -> includes/class-acme-admin.php (imports)',
      'acme-plugin.php -> includes/helpers.php (imports)',
      'acme-plugin.php -> includes/rest.php (imports)',
    ]);
  });

  it('@/ alias: workspace root first, then an app in a subfolder', () => {
    const files = new Set([
      'web/components/Nav.tsx',
      'web/app/(main)/page.tsx',
      'lib/db.ts',
      'web/lib/db.ts',
      'src/x.ts',
    ]);
    const r = (from: string, spec: string) => resolveImport(from, { kind: 'js', spec }, files);
    expect(r('web/app/(main)/page.tsx', '@/components/Nav')).toEqual(['web/components/Nav.tsx']);
    expect(r('web/app/(main)/page.tsx', '@/lib/db')).toEqual(['lib/db.ts']); // root wins, as before
    expect(r('a.ts', '~/x')).toEqual(['src/x.ts']);
    expect(r('web/app/(main)/page.tsx', '@/missing')).toEqual([]);
  });
});
