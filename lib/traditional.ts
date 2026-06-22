import * as OpenCC from 'opencc-js/core';
import * as Locale from 'opencc-js/preset';

let cachedConverter: OpenCC.ConverterFunction | null = null;

function getConverter(): OpenCC.ConverterFunction {
  if (!cachedConverter) {
    cachedConverter = OpenCC.ConverterBuilder(Locale)({ from: 'cn', to: 'twp' });
  }

  return cachedConverter;
}

/**
 * Convert Simplified Chinese text to Taiwan-style Traditional Chinese.
 *
 * Uses opencc-js with the `twp` Taiwan phrase config, which applies regional
 * term substitutions in addition to character-level conversion.
 */
export function toTraditionalTaiwan(text: string): string {
  return getConverter()(text);
}
