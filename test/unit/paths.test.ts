import { describe, expect, it } from 'vitest';
import { isExcluded, relPath } from '../../src/util/paths';

describe('relPath', () => {
  it('handles Windows drive letters, backslashes and case', () => {
    expect(relPath('C:\\Users\\me\\proj', 'c:\\Users\\me\\proj\\src\\a.ts')).toBe('src/a.ts');
    expect(relPath('C:\\proj', 'C:/proj/src/b.php')).toBe('src/b.php');
  });
  it('handles POSIX paths', () => {
    expect(relPath('/home/me/proj', '/home/me/proj/x/y.py')).toBe('x/y.py');
  });
  it('returns null outside the root', () => {
    expect(relPath('C:\\proj', 'D:\\other\\a.ts')).toBeNull();
    expect(relPath('/a/b', '/a/c.ts')).toBeNull();
    expect(relPath('/a/b', '/a/b')).toBeNull();
  });
});

describe('isExcluded', () => {
  const ex = new Set(['node_modules', 'vendor']);
  it('matches folder segments only', () => {
    expect(isExcluded('node_modules/x/index.js', ex)).toBe(true);
    expect(isExcluded('src/vendor/a.php', ex)).toBe(true);
    expect(isExcluded('src/vendor.ts', ex)).toBe(false);
  });
});
