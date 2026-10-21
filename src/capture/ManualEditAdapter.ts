import * as vscode from 'vscode';
import type { AgentAdapter, EditSink } from './AgentAdapter';
import type { RawEdit } from './EditEvent';
import { readText, trackedRel } from '../util/workspace';

const DEBOUNCE_MS = 150;

/**
 * Fallback capture: one edit per save, plus a file watcher for changes made outside the editor
 * (agents writing to disk). EditTracker merges these with hook events for the same change.
 */
export class ManualEditAdapter implements AgentAdapter {
  readonly id = 'manual';

  start(sink: EditSink): vscode.Disposable {
    const emit = (e: RawEdit) => sink.emit(e);
    const timers = new Map<string, NodeJS.Timeout>();
    const later = (rel: string, fn: () => void) => {
      clearTimeout(timers.get(rel));
      timers.set(
        rel,
        setTimeout(() => (timers.delete(rel), fn()), DEBOUNCE_MS),
      );
    };
    const fromDisk = (uri: vscode.Uri, kind: RawEdit['kind']) => {
      const rel = trackedRel(uri);
      if (!rel) return;
      later(rel, async () => {
        if (kind === 'delete') return emit({ source: 'manual', file: rel, kind, status: 'applied' });
        const after = await readText(uri);
        if (after !== undefined) emit({ source: 'manual', file: rel, kind, status: 'applied', after });
      });
    };

    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    return vscode.Disposable.from(
      watcher,
      watcher.onDidChange((u) => fromDisk(u, 'modify')),
      watcher.onDidCreate((u) => fromDisk(u, 'create')),
      watcher.onDidDelete((u) => fromDisk(u, 'delete')),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const rel = trackedRel(doc.uri);
        if (rel)
          later(rel, () =>
            emit({ source: 'manual', file: rel, kind: 'modify', status: 'applied', after: doc.getText() }),
          );
      }),
      { dispose: () => timers.forEach(clearTimeout) },
    );
  }
}
