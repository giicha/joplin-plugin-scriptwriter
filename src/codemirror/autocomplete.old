import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { getActiveLocaleConfig } from '../locales';
import { fountainStateField } from './fountainState';

export function createFountainCompleter(context: CompletionContext): CompletionResult | null {
  const { dictionary: extDict, analysis: docAnalysis } = context.state.field(fountainStateField);
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);
  const localeCfg = getActiveLocaleConfig(extDict.locales || ['en']);

  const prevLineText =
    line.number > 1 ? context.state.doc.line(line.number - 1).text.trim() : '';

  // STEP 1: Suggest scene prefixes at the start of a new line
  if (prevLineText === '' && /^[\p{L}./]{1,8}$/u.test(textBefore) && !textBefore.startsWith('@')) {
    const prefixOptions = localeCfg.scenePrefixes.map((p) => ({
      label: p + ' ',
      type: 'keyword',
      detail: 'Scene prefix',
    }));

    const allChars = new Set<string>([
      ...docAnalysis.characters.keys(),
      ...extDict.characters,
    ]);
    const charOptions =
      textBefore === textBefore.toUpperCase() && textBefore.length >= 2
        ? Array.from(allChars).map((c) => ({
            label: c,
            type: 'variable',
            detail: 'Character',
          }))
        : [];

    return {
      from: line.from,
      options: [...prefixOptions, ...charOptions],
      filter: true,
    };
  }

  // STEP 2: After prefix and before hyphen -> suggest locations
  const prefixList = [...localeCfg.scenePrefixes]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const locMatch = textBefore.match(new RegExp(`^(${prefixList})\\s+([^-]*)$`, 'i'));
  if (locMatch) {
    const allLocs = new Set<string>([
      ...docAnalysis.locations.keys(),
      ...extDict.locations,
    ]);
    const matchedPrefix = locMatch.at(1) || '';
    const fromPos = line.from + matchedPrefix.length + 1;
    return {
      from: fromPos,
      options: Array.from(allLocs).map((loc) => ({
        label: loc,
        type: 'class',
        detail: 'Location',
      })),
      filter: true,
    };
  }

  // STEP 3: After hyphen in scene heading -> suggest time of day
  const todMatch = textBefore.match(
    new RegExp(`^(?:(?:${prefixList})\\s+|\\.)[^-]+-\\s*(.*)$`, 'i')
  );
  if (todMatch) {
    const dashIndex = textBefore.lastIndexOf('-');
    const afterDash = textBefore.slice(dashIndex + 1);
    const spacesAfterDash = (afterDash.match(/^\s*/) || ['']).length;
    const fromPos = line.from + dashIndex + 1 + spacesAfterDash;

    return {
      from: fromPos,
      options: localeCfg.timeOfDay.map((t) => ({
        label: t,
        type: 'enum',
        detail: 'Time of day',
      })),
      filter: true,
    };
  }

  // STEP 4: Character input after '@'
  if (textBefore.startsWith('@')) {
    const allChars = new Set<string>([
      ...docAnalysis.characters.keys(),
      ...extDict.characters,
    ]);
    return {
      from: line.from + 1,
      options: Array.from(allChars).map((c) => ({
        label: c,
        type: 'variable',
        detail: 'Character',
      })),
      filter: true,
    };
  }

  return null;
}
