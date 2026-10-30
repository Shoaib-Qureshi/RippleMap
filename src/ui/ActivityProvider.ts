import * as vscode from 'vscode';
import type { Activity, ActivityLog } from '../capture/ActivityLog';

const ICON: Record<Activity['kind'], string> = { mcp: 'plug', web: 'globe', net: 'terminal' };
const STATUS: Record<Activity['status'], string> = {
  running: 'running…',
  ok: '✓',
  error: '✗ failed',
  denied: '⊘ denied',
  interrupted: '■ stopped',
};
const AGENT: Record<Activity['source'], string> = { 'claude-code': 'Claude Code', cursor: 'Cursor' };

const seconds = (ms?: number) =>
  ms === undefined ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

export function activityLabel(a: Activity): string {
  if (a.kind === 'mcp') return `${a.target} › ${a.action}`;
  if (a.kind === 'web') return a.action === 'search' ? `search “${a.input}”` : a.target;
  return `${a.target} (${a.action.split(/\s+/)[0]})`;
}

/** "Agent Activity" view: the agent's MCP calls, web fetches/searches and network commands, newest first. */
export class ActivityProvider implements vscode.TreeDataProvider<Activity> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly log: ActivityLog) {
    log.on('change', () => this.changed.fire());
  }

  getChildren(el?: Activity): Activity[] {
    return el ? [] : this.log.items;
  }

  getTreeItem(a: Activity): vscode.TreeItem {
    const t = new vscode.TreeItem(activityLabel(a));
    t.id = a.id;
    t.description = [STATUS[a.status], seconds(a.durationMs), new Date(a.ts).toLocaleTimeString()]
      .filter(Boolean)
      .join(' · ');
    t.iconPath =
      a.status === 'running'
        ? new vscode.ThemeIcon('loading~spin')
        : new vscode.ThemeIcon(
            ICON[a.kind],
            a.status === 'ok' ? undefined : new vscode.ThemeColor('problemsWarningIcon.foreground'),
          );
    // Payloads are untrusted: plain code blocks in a MarkdownString without trusted commands.
    const block = (s: string) => `\n\`\`\`\n${s.replace(/`/g, 'ʼ')}\n\`\`\``;
    t.tooltip = new vscode.MarkdownString(
      [
        `**${AGENT[a.source]}** · ${a.kind === 'mcp' ? `MCP server \`${a.target}\`, tool \`${a.action}\`` : a.kind === 'web' ? `web ${a.action}` : 'network command'}`,
        `${STATUS[a.status]}${a.durationMs !== undefined ? ` in ${seconds(a.durationMs)}` : ''}`,
        a.input ? `Input:${block(a.input)}` : '',
        a.output ? `${a.status === 'error' ? 'Error' : 'Result'}:${block(a.output)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    return t;
  }
}
