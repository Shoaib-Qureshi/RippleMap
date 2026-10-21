import * as vscode from 'vscode';
import { EditTracker } from './capture/EditTracker';
import { ManualEditAdapter } from './capture/ManualEditAdapter';
import { Decorations } from './ui/Decorations';
import { EditFeedProvider } from './ui/EditFeedProvider';
import { registerEditDiffView } from './ui/EditDiffView';
import { PanelProvider } from './ui/PanelProvider';
import { StatusBar } from './ui/StatusBar';
import { trackedRel } from './util/workspace';

export interface FlowLensApi {
  tracker: EditTracker;
}

export function activate(ctx: vscode.ExtensionContext): FlowLensApi {
  const tracker = new EditTracker();
  const panel = new PanelProvider(ctx);

  // Open documents give us a free baseline, so their first save shows a real diff.
  const seed = (doc: vscode.TextDocument) => {
    const rel = trackedRel(doc.uri);
    if (rel) tracker.seed(rel, doc.getText());
  };
  vscode.workspace.textDocuments.forEach(seed);

  ctx.subscriptions.push(
    panel,
    new StatusBar(tracker),
    new Decorations(tracker),
    vscode.window.registerTreeDataProvider('flowlens.editFeed', new EditFeedProvider(tracker)),
    registerEditDiffView(tracker),
    new ManualEditAdapter().start((e) => tracker.record(e)),
    vscode.workspace.onDidOpenTextDocument(seed),
    vscode.commands.registerCommand('flowlens.openPanel', () => panel.open()),
    vscode.commands.registerCommand('flowlens.clearHistory', () => tracker.clear()),
  );
  return { tracker };
}

export function deactivate(): void {}
