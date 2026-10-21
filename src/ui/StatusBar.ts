import * as vscode from 'vscode';
import type { EditTracker } from '../capture/EditTracker';

/** "FlowLens: 3 edits · +2 nodes · −1 edge". Click opens the panel. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private graphText = '';

  constructor(private readonly tracker: EditTracker) {
    this.item.command = 'flowlens.openPanel';
    this.item.tooltip = 'Open FlowLens';
    tracker.on('change', () => this.render());
    this.render();
    this.item.show();
  }

  /** Short graph-change text from the latest diff, e.g. "+2 nodes · −1 edge". */
  setGraphText(text: string): void {
    this.graphText = text;
    this.render();
  }

  private render(): void {
    const n = this.tracker.edits.filter((e) => e.status === 'applied').length;
    const pending = this.tracker.edits.some((e) => e.status === 'proposed');
    this.item.text = [
      '$(git-compare) FlowLens',
      `${n} edit${n === 1 ? '' : 's'}`,
      this.graphText,
      pending ? '$(clock) pending' : '',
    ]
      .filter(Boolean)
      .join(' · ')
      .replace(' · ', ': ');
  }

  dispose(): void {
    this.item.dispose();
  }
}
