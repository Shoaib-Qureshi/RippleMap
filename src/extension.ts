import * as vscode from 'vscode';
import { PanelProvider } from './ui/PanelProvider';

export function activate(ctx: vscode.ExtensionContext): void {
  const panel = new PanelProvider(ctx);
  ctx.subscriptions.push(
    panel,
    vscode.commands.registerCommand('flowlens.openPanel', () => panel.open()),
  );
}

export function deactivate(): void {}
