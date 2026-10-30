import * as vscode from 'vscode';
import type { EditTracker } from '../capture/EditTracker';
import { SUPPORTED_EXTENSIONS } from '../parse/ParserService';
import { config, readText, toRel } from '../util/workspace';
import type { GraphService } from './GraphService';

const CHUNK = 25;
const MAX_FILES = 20000;

/**
 * Initial workspace index: parses every supported file in chunks (yielding between them so the
 * host stays responsive) and seeds EditTracker baselines so later disk edits get real diffs.
 * ponytail: excludes are folder names from settings, not .gitignore; add a .gitignore parser if that matters.
 */
export async function indexWorkspace(
  service: GraphService,
  tracker: EditTracker,
  label: string,
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const excluded = [...config().excludeFolders];
  const include = `**/*.{${SUPPORTED_EXTENSIONS.join(',')}}`;
  const exclude = excluded.length ? `**/{${excluded.join(',')}}/**` : null;
  const uris = await vscode.workspace.findFiles(include, exclude, MAX_FILES);

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'RippleMap: indexing' },
    async (progress) => {
      let done = 0;
      for (let i = 0; i < uris.length; i += CHUNK) {
        const chunk = uris.slice(i, i + CHUNK);
        const texts = await Promise.all(chunk.map(readText));
        chunk.forEach((uri, j) => {
          const rel = toRel(uri);
          const text = texts[j];
          if (rel === null || text === undefined) return;
          tracker.seed(rel, text);
          service.builder.setFile(rel, text);
        });
        done += chunk.length;
        progress.report({ message: `${done}/${uris.length}` });
        onProgress(done, uris.length);
        await new Promise((r) => setImmediate(r));
      }
      service.rebuildNow(label);
      return uris.length;
    },
  );
}
