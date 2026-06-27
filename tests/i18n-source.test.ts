import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages } from '../lib/i18n';

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

  it('keeps the en and zh-CN message tables at full key parity', () => {
    const en = Object.keys(messages.en).sort();
    const zh = Object.keys(messages['zh-CN']).sort();
    // TypeScript catches en keys missing from zh-CN, but not the reverse, and
    // gives no runtime guarantee — assert both directions here.
    expect(zh).toEqual(en);
  });
});
