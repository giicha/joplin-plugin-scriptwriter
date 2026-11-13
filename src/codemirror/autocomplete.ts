import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { getActiveLocaleConfig } from '../locales';
import { analyzeFountain } from '../fountainParser';

export interface ExternalDictionary {
  characters: string[];
  locations: string[];
  locales: string[];
}

export function createFountainCompleter(getExternalDict: () => ExternalDictionary) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const extDict = getExternalDict();
    const localeCfg = getActiveLocaleConfig(extDict.locales || ['en']);
    const docAnalysis = analyzeFountain(context.state.doc.toString(), extDict.locales);

    const prevLineText =
      line.number > 1 ? context.state.doc.line(line.number - 1).text.trim() : '';

    // STEP 1: Suggest scene prefixes at the start of a new line (INT., EXT., etc.)
    if (prevLineText === '' && /^[A-Za-zА-Яа-я./]{1,8}$/.test(textBefore) && !textBefore.startsWith('@')) {
      const prefixOptions = localeCfg.scenePrefixes.map((p) => ({
        label: p + ' ',
        type: 'keyword',
        detail: 'Scene prefix',
      }));

      // If the user has already typed 2+ uppercase letters, also suggest characters
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

    // STEP 2: After prefix (INT. ) and before hyphen ( - ) -> suggest locations
    const prefixList = localeCfg.scenePrefixes
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const locMatch = textBefore.match(new RegExp(`^(${prefixList})\\s+([^-]*)$`, 'i'));
    if (locMatch) {
      const allLocs = new Set<string>([
        ...docAnalysis.locations,
        ...extDict.locations,
      ]);
      const fromPos = line.from + locMatch[1].length + 1;
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

    // STEP 3: After hyphen in scene heading (INT. APARTMENT - ) -> suggest time of day
    const todMatch = textBefore.match(new RegExp(`^(${prefixList})\\s+.+\\s+-\\s*(.*)$`, 'i'));
    if (todMatch) {
      const dashIndex = textBefore.lastIndexOf('-');
      const fromPos = line.from + dashIndex + 2;
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
  };
}
