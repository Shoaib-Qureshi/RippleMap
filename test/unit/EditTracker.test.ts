import { describe, expect, it } from 'vitest';
import { EditTracker } from '../../src/capture/EditTracker';

const make = () => {
  let t = 1000;
  const tracker = new EditTracker(() => t);
  return { tracker, tick: (ms: number) => (t += ms) };
};

describe('EditTracker', () => {
  it('diffs against the last known text and drops no-op edits', () => {
    const { tracker } = make();
    tracker.seed('a.ts', 'x\n');
    const e = tracker.record({
      source: 'manual',
      file: 'a.ts',
      kind: 'modify',
      status: 'applied',
      after: 'x\ny\n',
    });
    expect(e).toMatchObject({ added: 1, removed: 0, changedRanges: [{ startLine: 2, endLine: 2 }] });
    expect(
      tracker.record({ source: 'manual', file: 'a.ts', kind: 'modify', status: 'applied', after: 'x\ny\n' }),
    ).toBeUndefined();
    expect(tracker.edits).toHaveLength(1);
  });

  it('records unknown-before edits without counts, then diffs the next one', () => {
    const { tracker } = make();
    const e1 = tracker.record({
      source: 'manual',
      file: 'b.ts',
      kind: 'modify',
      status: 'applied',
      after: 'a\n',
    });
    expect(e1?.added).toBeUndefined();
    const e2 = tracker.record({
      source: 'manual',
      file: 'b.ts',
      kind: 'modify',
      status: 'applied',
      after: 'a\nb\n',
    });
    expect(e2?.added).toBe(1);
  });

  it('promotes a proposal to applied and suppresses the duplicate watcher event', () => {
    const { tracker, tick } = make();
    tracker.seed('c.ts', 'old\n');
    tracker.record({
      source: 'claude-code',
      file: 'c.ts',
      kind: 'modify',
      status: 'proposed',
      after: 'new\n',
      toolUseId: 't1',
    });
    expect(tracker.edits[0]?.status).toBe('proposed');
    tick(100);
    tracker.record({
      source: 'claude-code',
      file: 'c.ts',
      kind: 'modify',
      status: 'applied',
      after: 'new\n',
      toolUseId: 't1',
    });
    tick(100);
    tracker.record({ source: 'manual', file: 'c.ts', kind: 'modify', status: 'applied', after: 'new\n' });
    expect(tracker.edits).toHaveLength(1);
    expect(tracker.edits[0]).toMatchObject({
      status: 'applied',
      source: 'claude-code',
      added: 1,
      removed: 1,
    });
  });

  it('relabels a watcher event that arrived before the hook', () => {
    const { tracker, tick } = make();
    tracker.seed('d.ts', '1\n');
    tracker.record({ source: 'manual', file: 'd.ts', kind: 'modify', status: 'applied', after: '1\n2\n' });
    tick(200);
    // Hook's after equals known text, but it must still replace the manual entry.
    tracker.record({
      source: 'claude-code',
      file: 'd.ts',
      kind: 'modify',
      status: 'applied',
      after: '1\n2\n',
    });
    expect(tracker.edits).toHaveLength(1);
    expect(tracker.edits[0]).toMatchObject({ source: 'claude-code', added: 1 });
  });

  it('discards rejected proposals', () => {
    const { tracker } = make();
    tracker.record({
      source: 'claude-code',
      file: 'e.ts',
      kind: 'create',
      status: 'proposed',
      after: 'x',
      toolUseId: 't9',
    });
    expect(tracker.discardProposed('t9')).toBe(true);
    expect(tracker.edits).toHaveLength(0);
  });

  it('a no-op applied edit still announces the proposal it removed (no stuck preview)', () => {
    const { tracker } = make();
    tracker.seed('f.ts', 'x');
    const discarded: string[] = [];
    tracker.on('discarded', (d) => discarded.push(...d.map((e) => e.file)));
    const base = { source: 'claude-code', file: 'f.ts', kind: 'modify', toolUseId: 't1' } as const;
    tracker.record({ ...base, status: 'proposed', before: 'x', after: 'x' });
    expect(tracker.record({ ...base, status: 'applied', after: 'x' })).toBeUndefined();
    expect(discarded).toEqual(['f.ts']);
    expect(tracker.edits).toHaveLength(0);
  });

  it("the user's own earlier save is not absorbed into the next agent edit", () => {
    const { tracker, tick } = make();
    tracker.seed('b.ts', 'v0\n');
    tracker.record({ source: 'manual', file: 'b.ts', kind: 'modify', status: 'applied', after: 'v1\n' });
    tick(2000);
    tracker.record({ source: 'claude-code', file: 'b.ts', kind: 'modify', status: 'applied', after: 'v2\n' });
    expect(tracker.edits.map((e) => `${e.source}:${e.before}->${e.after}`)).toEqual([
      'claude-code:v1\n->v2\n',
      'manual:v0\n->v1\n',
    ]);
  });

  it('when the watcher beat the hook, the agent event keeps the watcher id (snapshot stays attributed)', () => {
    const { tracker, tick } = make();
    tracker.seed('c.ts', 'a\n');
    const w = tracker.record({
      source: 'manual',
      file: 'c.ts',
      kind: 'modify',
      status: 'applied',
      after: 'b\n',
    })!;
    tick(300);
    const h = tracker.record({
      source: 'claude-code',
      file: 'c.ts',
      kind: 'modify',
      status: 'applied',
      after: 'b\n',
    })!;
    expect(h.id).toBe(w.id);
    expect(tracker.edits).toHaveLength(1);
    expect(tracker.get(w.id)?.source).toBe('claude-code');
  });

  it("Stop only drops that session's proposals", () => {
    const { tracker } = make();
    const p = { source: 'claude-code', kind: 'modify', status: 'proposed', after: 'x' } as const;
    tracker.record({ ...p, file: 'a.ts', sessionId: 'A' });
    tracker.record({ ...p, file: 'b.ts', sessionId: 'B' });
    tracker.discardProposed(undefined, 'A');
    expect(tracker.edits.map((e) => e.file)).toEqual(['b.ts']);
  });

  it('deleting a folder forgets the baselines of the files under it', () => {
    const { tracker } = make();
    tracker.seed('old/a.ts', 'a');
    tracker.seed('older.ts', 'b');
    tracker.record({ source: 'manual', file: 'old', kind: 'delete', status: 'applied' });
    expect(tracker.knownText('old/a.ts')).toBeUndefined();
    expect(tracker.knownText('older.ts')).toBe('b');
  });
});
