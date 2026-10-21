import * as vscode from 'vscode';
import type { EditTracker } from '../capture/EditTracker';
import { config, toRel } from '../util/workspace';

const LEVELS = [0.28, 0.16, 0.07]; // alpha by age bucket: fresh -> old
const TICK_MS = 5000;

/** Highlights recently edited lines (left border = gutter marker) and fades them out over time. */
export class Decorations implements vscode.Disposable {
  private readonly types = LEVELS.map((a) =>
    vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: `rgba(46, 160, 67, ${a})`,
      borderColor: `rgba(46, 160, 67, ${Math.min(1, a * 3)})`,
      borderStyle: 'solid',
      borderWidth: '0 0 0 3px',
      overviewRulerColor: `rgba(46, 160, 67, ${Math.min(1, a * 3)})`,
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    }),
  );
  private timer: NodeJS.Timeout | undefined;
  private readonly subs: vscode.Disposable[];

  constructor(private readonly tracker: EditTracker) {
    tracker.on('change', () => this.refresh());
    this.subs = [vscode.window.onDidChangeVisibleTextEditors(() => this.refresh())];
  }

  refresh(): void {
    const fadeMs = config().decorationFadeSeconds * 1000;
    const now = Date.now();
    const recent = this.tracker.edits.filter((e) => e.status === 'applied' && now - e.ts < fadeMs);
    for (const editor of vscode.window.visibleTextEditors) {
      const rel = toRel(editor.document.uri);
      const buckets: vscode.Range[][] = LEVELS.map(() => []);
      for (const e of recent) {
        if (e.file !== rel) continue;
        const level = Math.min(LEVELS.length - 1, Math.floor(((now - e.ts) / fadeMs) * LEVELS.length));
        for (const r of e.changedRanges) {
          const end = Math.min(r.endLine, editor.document.lineCount) - 1;
          if (end >= 0) buckets[level]!.push(new vscode.Range(Math.min(r.startLine - 1, end), 0, end, 0));
        }
      }
      this.types.forEach((t, i) => editor.setDecorations(t, buckets[i]!));
    }
    clearTimeout(this.timer);
    if (recent.length) this.timer = setTimeout(() => this.refresh(), TICK_MS);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.types.forEach((t) => t.dispose());
    this.subs.forEach((s) => s.dispose());
  }
}
