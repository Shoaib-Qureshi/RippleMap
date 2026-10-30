import * as vscode from 'vscode';
import type { EditTracker } from '../capture/EditTracker';
import { basename } from '../util/paths';
import { toUri } from '../util/workspace';

const SCHEME = 'ripplemap-edit';

/** Read-only virtual documents holding an edit's before/after text, opened in VS Code's diff editor. */
export function registerEditDiffView(tracker: EditTracker): vscode.Disposable {
  const provider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri) {
      const q = new URLSearchParams(uri.query);
      const e = tracker.get(q.get('id') ?? '');
      return (q.get('side') === 'before' ? e?.before : e?.after) ?? '';
    },
  };
  return vscode.Disposable.from(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.commands.registerCommand('ripplemap.showEditDiff', async (id: string) => {
      const e = tracker.get(id);
      if (!e) return;
      if (e.before === undefined) {
        const uri = toUri(e.file);
        if (uri && e.kind !== 'delete') await vscode.window.showTextDocument(uri);
        void vscode.window.showInformationMessage(
          `RippleMap: no earlier copy of ${e.file} was known, so there is no diff for this edit.`,
        );
        return;
      }
      // Path segment keeps the file extension so the diff gets syntax highlighting.
      const side = (s: string) =>
        vscode.Uri.from({ scheme: SCHEME, path: `/${e.file}`, query: `id=${e.id}&side=${s}` });
      const label = e.status === 'proposed' ? 'proposed' : 'edit';
      await vscode.commands.executeCommand(
        'vscode.diff',
        side('before'),
        side('after'),
        `${basename(e.file)} (${label} ${e.id})`,
      );
    }),
  );
}
