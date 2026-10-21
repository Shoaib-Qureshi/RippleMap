/** Result of applying an agent's proposed edit to the current file text, in memory. */
export interface AppliedText {
  text: string;
  /** True if an old_string matched 0 or >1 times (without replace_all): the result is a best guess. */
  uncertain: boolean;
}

export interface StringEdit {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

function count(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

export function applyStringEdit(text: string, e: StringEdit): AppliedText {
  if (e.old_string === '') return { text: text === '' ? e.new_string : text, uncertain: text !== '' };
  let { old_string: from, new_string: to } = e;
  // Windows files: the agent usually sends LF strings for CRLF text.
  if (!text.includes(from) && text.includes('\r\n')) {
    from = from.replace(/\r?\n/g, '\r\n');
    to = to.replace(/\r?\n/g, '\r\n');
  }
  const n = count(text, from);
  if (n === 0) return { text, uncertain: true };
  if (e.replace_all) return { text: text.split(from).join(to), uncertain: false };
  const i = text.indexOf(from);
  return { text: text.slice(0, i) + to + text.slice(i + from.length), uncertain: n !== 1 };
}

export function applyStringEdits(text: string, edits: StringEdit[]): AppliedText {
  let uncertain = false;
  for (const e of edits) {
    const r = applyStringEdit(text, e);
    text = r.text;
    uncertain ||= r.uncertain;
  }
  return { text, uncertain };
}
