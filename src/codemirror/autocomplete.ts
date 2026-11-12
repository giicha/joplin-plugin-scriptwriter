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

    // ШАГ 1: Подсказка префиксов сцены в начале новой строки (INT., EXT. и т.д.)
    if (prevLineText === '' && /^[A-Za-zА-Яа-я./]{1,8}$/.test(textBefore) && !textBefore.startsWith('@')) {
      const prefixOptions = localeCfg.scenePrefixes.map((p) => ({
        label: p + ' ',
        type: 'keyword',
        detail: 'Префикс сцены',
      }));

      // Если пользователь уже набрал заглавными 2+ буквы, также можем предложить персонажей
      const allChars = new Set<string>([
        ...docAnalysis.characters.keys(),
        ...extDict.characters,
      ]);
      const charOptions =
        textBefore === textBefore.toUpperCase() && textBefore.length >= 2
          ? Array.from(allChars).map((c) => ({
              label: c,
              type: 'variable',
              detail: 'Персонаж',
            }))
          : [];

      return {
        from: line.from,
        options: [...prefixOptions, ...charOptions],
        filter: true,
      };
    }

    // ШАГ 2: После префикса (INT. ) и до дефиса ( - ) -> подсказка локаций
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
          detail: 'Локация',
        })),
        filter: true,
      };
    }

    // ШАГ 3: После дефиса в заголовке сцены (INT. КВАРТИРА - ) -> подсказка времени суток
    const todMatch = textBefore.match(new RegExp(`^(${prefixList})\\s+.+\\s+-\\s*(.*)$`, 'i'));
    if (todMatch) {
      const dashIndex = textBefore.lastIndexOf('-');
      const fromPos = line.from + dashIndex + 2;
      return {
        from: fromPos,
        options: localeCfg.timeOfDay.map((t) => ({
          label: t,
          type: 'enum',
          detail: 'Время суток',
        })),
        filter: true,
      };
    }

    // ШАГ 4: Ввод персонажа после '@'
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
          detail: 'Персонаж',
        })),
        filter: true,
      };
    }

    return null;
  };
}
