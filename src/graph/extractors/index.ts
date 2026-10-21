import type { Extractor } from './Extractor';
import { importsExtractor } from './imports';

/** Order matters: later extractors may read nodes added by earlier ones. */
export const extractors: readonly Extractor[] = [importsExtractor];
