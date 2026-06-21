# CC-CEDICT Dictionary Asset

## Source

- **Project:** CC-CEDICT
- **Download:** https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- **Wiki:** https://cc-cedict.org/wiki/
- **Release used:** see `public/dictionaries/cc-cedict-manifest.json` -> `release`
- **Hash:** see the same manifest -> `hash`

## License

CC-CEDICT is distributed under a Creative Commons Attribution-ShareAlike
license. The MDBG download page currently describes it as CC-BY-SA 4.0; the
CC-CEDICT wiki historically describes it under CC-BY-SA 3.0. Before any
release of this extension, re-check the current license statement on the
download page and update this file and the manifest `license` field if it has
changed.

- CC-BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/
- CC FAQ (ShareAlike scope): https://creativecommons.org/faq/

This is not legal advice. Treat the dictionary data as a separately licensed
collection asset: the data remains under its CC license, and the project's
source code is licensed separately. ShareAlike applies to adaptations of the
dictionary data; including the dictionary as a collection does not change the
license applicable to this project's own code.

## Attribution

The dashboard displays a "Dictionary: CC-CEDICT" line in the Word Insight
Panel and links to the MDBG download page.

## Update Instructions

1. Download the latest `cedict_ts.u8` from the MDBG download page into the
   repository root as `cc-cedict.txt`. Do **not** automate this download at
   runtime or in CI.
2. Run `CEDICT_SOURCE=cc-cedict.txt npm run build:dictionary`.
3. Inspect the printed `entries`, `compact.json bytes`, and new `hash`.
4. Commit the regenerated `public/dictionaries/*.json` files.
5. Update the `release` field in this doc if you record it here.

The dashboard loader caches the parsed index in IndexedDB keyed by the asset
hash; a new hash invalidates the cache automatically on next dashboard open.
