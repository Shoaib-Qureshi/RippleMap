import * as vscode from 'vscode';
import type { AgentAdapter, EditSink } from './AgentAdapter';
import type { RawEdit } from './EditEvent';
import { readText, trackedRel } from '../util/workspace';
import { SUPPORTED_EXTENSIONS } from '../parse/ParserService';

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
        if (after !== undefined) return emit({ source: 'manual', file: rel, kind, status: 'applied', after });
        // A folder appeared (created or renamed into place): the watcher only reports the folder.
        if (
          kind !== 'create' ||
          (await vscode.workspace.fs.stat(uri).then(
            (s) => s.type,
            () => 0,
          )) !== vscode.FileType.Directory
        )
          return;
        const pattern = new vscode.RelativePattern(uri, `**/*.{${SUPPORTED_EXTENSIONS.join(',')}}`);
        for (const child of await vscode.workspace.findFiles(pattern)) fromDisk(child, 'create');
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
        if (!rel) return;
        const after = doc.getText(); // the saved text, not whatever is typed during the debounce
        later(rel, () => emit({ source: 'manual', file: rel, kind: 'modify', status: 'applied', after }));
      }),
      { dispose: () => timers.forEach(clearTimeout) },
    );
  }
}
