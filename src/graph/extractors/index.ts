import { callsExtractor } from './calls';
import type { Extractor } from './Extractor';
import { importsExtractor } from './imports';
import { jsRoutesExtractor } from './jsRoutes';
import { pythonRoutesExtractor } from './pythonRoutes';
import { wordpressExtractor } from './wordpress';

/** Order matters: framework extractors add closure nodes (meta.anchor) that `calls` uses as scopes. */
export const extractors: readonly Extractor[] = [
  importsExtractor,
  wordpressExtractor,
  jsRoutesExtractor,
  pythonRoutesExtractor,
  callsExtractor,
];
