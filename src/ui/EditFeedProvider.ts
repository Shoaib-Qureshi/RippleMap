import * as vscode from 'vscode';
import type { EditEvent } from '../capture/EditEvent';
import type { EditTracker } from '../capture/EditTracker';
import { basename } from '../util/paths';

type Group = { kind: 'group'; key: string; label: string; edits: EditEvent[] };
type Item = Group | EditEvent;

const time = (ts: number) => new Date(ts).toLocaleTimeString();
const ranges = (e: EditEvent) =>
  e.changedRanges
    .slice(0, 3)
    .map((r) => (r.startLine === r.endLine ? `L${r.startLine}` : `L${r.startLine}–${r.endLine}`))
    .join(', ') + (e.changedRanges.length > 3 ? ', …' : '');

export function describeEdit(e: EditEvent): string {
  const counts = e.added === undefined ? 'before unknown' : `+${e.added} −${e.removed}`;
  return [e.status === 'proposed' ? 'pending' : '', counts, ranges(e), time(e.ts)]
    .filter(Boolean)
    .join(' · ');
}

/** Edit Feed tree: edits grouped by agent session (manual edits in their own group), newest first. */
export class EditFeedProvider implements vscode.TreeDataProvider<Item> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly tracker: EditTracker) {
    tracker.on('change', () => this.changed.fire());
  }

  getChildren(el?: Item): Item[] {
    if (el) return el.kind === 'group' ? el.edits : [];
    const groups = new Map<string, Group>();
    for (const e of this.tracker.edits) {
      const key = e.source === 'manual' ? 'manual' : `${e.source}:${e.sessionId ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        const label =
          e.source === 'manual'
            ? 'Manual edits'
            : `${e.source === 'claude-code' ? 'Claude Code' : 'Agent'} session ${e.sessionId?.slice(0, 8) ?? ''}`.trim();
        groups.set(key, (g = { kind: 'group', key, label, edits: [] }));
      }
      g.edits.push(e);
    }
    return [...groups.values()];
  }

  getTreeItem(el: Item): vscode.TreeItem {
    if (el.kind === 'group') {
      const t = new vscode.TreeItem(el.label, vscode.TreeItemCollapsibleState.Expanded);
      t.id = `g:${el.key}`;
      t.description = `${el.edits.length} edit${el.edits.length === 1 ? '' : 's'}`;
      t.iconPath = new vscode.ThemeIcon(el.key === 'manual' ? 'person' : 'sparkle');
      return t;
    }
    const t = new vscode.TreeItem(basename(el.file));
    t.id = el.id;
    t.description = describeEdit(el);
    t.tooltip = new vscode.MarkdownString(
      [
        `**${el.file}** (${el.kind}, ${el.status})`,
        `Source: ${el.source}${el.tool ? ` · ${el.tool}` : ''}`,
        el.changedRanges.length
          ? `Lines: ${el.changedRanges.map((r) => `${r.startLine}–${r.endLine}`).join(', ')}`
          : '',
        el.symbols?.length ? `Symbols: ${el.symbols.join(', ')}` : '',
        el.uncertain ? '_Proposed text is uncertain (old_string did not match exactly once)._' : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    t.iconPath = new vscode.ThemeIcon(
      el.status === 'proposed'
        ? 'clock'
        : el.kind === 'create'
          ? 'diff-added'
          : el.kind === 'delete'
            ? 'diff-removed'
            : 'diff-modified',
    );
    t.contextValue = 'edit';
    t.command = { command: 'ripplemap.showEditDiff', title: 'Show diff', arguments: [el.id] };
    return t;
  }
}
