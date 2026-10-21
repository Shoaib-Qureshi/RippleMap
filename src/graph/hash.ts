import { createHash } from 'node:crypto';

/** Short content hash, EOL-insensitive. */
export const hashText = (s: string) =>
  createHash('sha1').update(s.replace(/\r\n?/g, '\n')).digest('hex').slice(0, 12);
