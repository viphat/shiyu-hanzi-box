import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildCompactAsset, parseCedictText } from '../lib/dictionary';
import type { CompactDictionaryAsset, DictionaryAssetMeta } from '../lib/types';

const SOURCE = process.env.CEDICT_SOURCE ?? 'cc-cedict.txt';
const OUT_DIR = 'public/dictionaries';

function main() {
  const text = readFileSync(SOURCE, 'utf8');
  const { skipped } = parseCedictText(text, { withStats: true });
  const asset: CompactDictionaryAsset = buildCompactAsset(text, {
    sourceUrl: 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
    license: 'CC-BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const meta: DictionaryAssetMeta = asset.meta;
  writeFileSync(join(OUT_DIR, 'cc-cedict-manifest.json'), JSON.stringify(meta, null, 2));
  writeFileSync(join(OUT_DIR, 'cc-cedict.compact.json'), JSON.stringify(asset));

  const compactBytes = JSON.stringify(asset).length;
  console.log(`[build-dictionary] release=${meta.release} hash=${meta.hash}`);
  console.log(`[build-dictionary] entries=${asset.columns.simplified.length}`);
  console.log(`[build-dictionary] skipped=${skipped}`);
  console.log(`[build-dictionary] compact.json bytes=${compactBytes}`);
  console.log(`[build-dictionary] wrote ${OUT_DIR}/cc-cedict-manifest.json and cc-cedict.compact.json`);
}

main();
