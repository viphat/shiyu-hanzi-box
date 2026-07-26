# CVDICT Vietnamese Dictionary

## Source

- **Project repository:** https://github.com/ph0ngp/CVDICT
- **Canonical raw source:** https://raw.githubusercontent.com/ph0ngp/CVDICT/main/CVDICT.u8
- **Format:** CVDICT is a Chinese-Vietnamese derivative of CC-CEDICT and uses
  the compatible traditional simplified `[pinyin] /definitions/` line format.

The extension intentionally uses the fixed raw source URL above. It does not
offer arbitrary dictionary URLs and never downloads CVDICT automatically.

## License and Attribution

CVDICT is derived from CC-CEDICT. Attribute the dictionary data to CVDICT and
CC-CEDICT and preserve their Creative Commons Attribution-ShareAlike 4.0
(CC BY-SA 4.0) licensing when redistributing an adaptation of the data.

- CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/
- CC-CEDICT information: https://cc-cedict.org/wiki/

This repository's source code is separately licensed. This document is not
legal advice; verify upstream license notices before redistributing dictionary
data or a derived index.

## Local Install and Update

1. Open **Settings** in the extension.
2. In the **CVDICT Vietnamese dictionary** section, select **Install and enable
   CVDICT**. Chrome asks for the optional `raw.githubusercontent.com` host
   permission at that explicit click.
3. The settings worker streams and validates the source, builds a lookup index,
   and stores the index in this browser profile's IndexedDB cache. A failed,
   cancelled, oversized, or empty download leaves any working installation
   unchanged.
4. Use **Update CVDICT** to repeat the same explicit flow. The metadata changes
   only after a complete replacement index is available.
5. Disabling CVDICT keeps the local cache. **Remove CVDICT data** disables it
   and removes the cache from this profile.

CVDICT is not bundled with the extension. The downloaded source text is not
kept as an exportable file; only the parsed runtime index is cached locally.

## Hanzii Lookup Shortcut

When CVDICT is enabled, expanded Word Insight includes a localized shortcut to
look up the captured Simplified word on Hanzii.net. The destination is built as
`https://hanzii.net/search/word/${encodeURIComponent(word.text)}?hl=vi`.
It is a normal click-only outbound link: the extension does not fetch Hanzii,
preview its content, or request a Hanzii host permission. Disabling CVDICT hides
the shortcut.

## Sync and Backup Boundary

CVDICT settings metadata can appear in a full settings backup, but its IndexedDB
index is never placed in `chrome.storage.local`, folder-sync replicas, Markdown
exports, or zip exports. A restored or newly joined browser profile must install
CVDICT again before Vietnamese definitions are available.

## Accuracy Caveat

CVDICT is a community-maintained dictionary derived from CC-CEDICT. Treat its
definitions as a study aid, not an authority: terminology, senses, variants,
and translations can be incomplete or inaccurate. Confirm consequential or
specialized meanings against authoritative Vietnamese and Chinese references.
