import { describe, expect, it } from 'vitest';
import { diffGraphs, shortStats } from '../../src/graph/GraphDiffer';
import { SnapshotStore } from '../../src/graph/SnapshotStore';
import { builderFor, fixture } from './helpers';

describe('GraphDiffer', () => {
  it('detects added/removed import edges and modified files from a real edit', async () => {
    const b = await builderFor(fixture('js-app'));
    const before = b.build();
    b.setFile(
      'src/index.ts',
      "import { start } from './server';\nimport { App } from './components/App';\nstart();\n",
    );
    const after = b.build();
    const d = diffGraphs(before, after);
    expect(d.addedEdges).toEqual([
      'src/index.ts::file::src/index.ts->src/components/App.tsx::file::src/components/App.tsx::imports',
    ]);
    expect(d.removedEdges.filter((e) => e.endsWith('::imports'))).toEqual([
      'src/index.ts::file::src/index.ts->src/lib/util.ts::file::src/lib/util.ts::imports',
    ]);
    expect(d.modifiedNodes).toContain('src/index.ts::file::src/index.ts');
    expect(d.summary).toMatch(/^Adds .*1 import.*; removes .*1 import/);
    expect(shortStats(d)).toMatch(/\+1 edge/);
  });

  it('reports no change for identical graphs', async () => {
    const g = (await builderFor(fixture('py-app'))).build();
    const d = diffGraphs(g, g);
    expect(d.summary).toBe('No change to the graph.');
    expect(shortStats(d)).toBe('');
  });
});

describe('SnapshotStore', () => {
  it('is a ring buffer and shares unchanged edge objects', async () => {
    const b = await builderFor(fixture('js-app'));
    const s = new SnapshotStore(2);
    const g1 = b.build();
    s.add(g1, 'one');
    const g2 = b.build();
    s.add(g2, 'two');
    s.add(b.build(), 'three');
    expect(s.list.map((x) => x.label)).toEqual(['two', 'three']);
    const [id, e] = [...g1.edges][0]!;
    expect(g2.edges.get(id)).toBe(e);
  });
});
