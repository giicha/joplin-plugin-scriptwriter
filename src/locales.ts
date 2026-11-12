export interface LocaleConfig {
  id: string;
  name: string;
  scenePrefixes: string[];
  timeOfDay: string[];
  transitions: string[];
  characterExtensions: string[];
}

export const SCREENPLAY_LOCALES: Record<string, LocaleConfig> = {
  en: {
    id: 'en',
    name: 'English (Standard Fountain)',
    scenePrefixes: ['INT.', 'EXT.', 'INT./EXT.', 'I/E.', 'EST.'],
    timeOfDay: [
      'DAY',
      'NIGHT',
      'MORNING',
      'EVENING',
      'DUSK',
      'DAWN',
      'CONTINUOUS',
      'LATER',
      'MOMENTS LATER',
    ],
    transitions: [
      'CUT TO:',
      'FADE IN:',
      'FADE OUT.',
      'DISSOLVE TO:',
      'SMASH CUT TO:',
      'MATCH CUT TO:',
    ],
    characterExtensions: ['(V.O.)', '(O.S.)', '(O.C.)', "(CONT'D)"],
  },
  // Пример расширения для будущего добавления русского языка:
  // ru: {
  //   id: 'ru',
  //   name: 'Русский',
  //   scenePrefixes: ['ИНТ.', 'НАТ.', 'ИНТ./НАТ.', 'ПАВ.'],
  //   timeOfDay: ['ДЕНЬ', 'НОЧЬ', 'УТРО', 'ВЕЧЕР', 'СУМЕРКИ', 'РАССВЕТ'],
  //   transitions: ['ЗТМ.', 'ИЗ ЗТМ.', 'СКЛЕЙКА:'],
  //   characterExtensions: ['(ЗК)', '(ГЗК)', '(ПРОД.)'],
  // }
};

export function getActiveLocaleConfig(localeKeys: string[] = ['en']): LocaleConfig {
  const merged: LocaleConfig = {
    id: localeKeys.join('+'),
    name: 'Active',
    scenePrefixes: [],
    timeOfDay: [],
    transitions: [],
    characterExtensions: [],
  };

  for (const key of localeKeys) {
    const cfg = SCREENPLAY_LOCALES[key];
    if (cfg) {
      merged.scenePrefixes.push(...cfg.scenePrefixes);
      merged.timeOfDay.push(...cfg.timeOfDay);
      merged.transitions.push(...cfg.transitions);
      merged.characterExtensions.push(...cfg.characterExtensions);
    }
  }
  return merged;
}
