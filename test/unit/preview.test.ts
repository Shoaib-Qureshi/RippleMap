import { describe, expect, it } from 'vitest';
import { extractors } from '../../src/graph/extractors';
import { GraphBuilder } from '../../src/graph/GraphBuilder';
import { GraphService } from '../../src/graph/GraphService';
import { previewGraph } from '../../src/preview/PendingEditPreview';
import { builderFor, fixture, getParser } from './helpers';

describe('pending-edit preview', () => {
  it('builds the would-be graph without touching the real facts', async () => {
    const b = await builderFor(fixture('py-app'));
    const factsBefore = b.facts.get('app/utils.py');
    const { graph: g } = previewGraph(
      b,
      'app/utils.py',
      'def greet():\n    return shout()\n\n\ndef shout():\n    return "HI"\n',
    );
    expect(g.nodes.has('app/utils.py::function::shout')).toBe(true);
    expect(g.edges.has('app/utils.py::function::greet->app/utils.py::function::shout::calls')).toBe(true);
    expect(b.facts.get('app/utils.py')).toBe(factsBefore);
    expect(b.build().nodes.has('app/utils.py::function::shout')).toBe(false);
  });

  it('GraphService: pending diff is current -> proposed, and clears by tool call id', async () => {
    const svc = new GraphService(new GraphBuilder(await getParser(), extractors));
    svc.setFile('a.py', 'def a():\n    pass\n');
    svc.rebuildNow('Initial index');
    svc.setPending(
      { editId: 'e1', toolUseId: 't1', file: 'a.py', uncertain: false },
      'def a():\n    b()\n\n\ndef b():\n    pass\n',
    );
    const v = svc.view();
    expect(v.pending?.editId).toBe('e1');
    expect(v.diff.addedNodes).toEqual(['a.py::function::b']);
    expect(svc.clearPending({ toolUseId: 'other' })).toBe(false);
    expect(svc.clearPending({ toolUseId: 't1' })).toBe(true);
    expect(svc.view().pending).toBeNull();
    svc.dispose();
  });
});
