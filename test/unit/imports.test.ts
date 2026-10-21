import { describe, expect, it } from 'vitest';
import { builderFor, edgeList, fixture } from './helpers';

describe('imports extractor (golden graphs)', () => {
  it('JS/TS: ESM, require, re-export, dynamic import, .js->.ts, @/ alias; ignores packages', async () => {
    const g = (await builderFor(fixture('js-app'))).build();
    expect(edgeList(g, ['imports'])).toEqual([
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
});
