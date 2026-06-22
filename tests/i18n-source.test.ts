import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('i18n source usage', () => {
  it('keeps locale-specific UI strings in the i18n table', () => {
    const root = join(import.meta.dirname, '..');
    const offenders = sourceFiles(join(root, 'entrypoints')).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return source.match(/locale\s*===\s*['"]en['"]\s*\?/g)
        ? [relative(root, path)]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
