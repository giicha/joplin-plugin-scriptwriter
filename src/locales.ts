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

  fr: {
    id: 'fr',
    name: 'Français',
    scenePrefixes: ['INT.', 'EXT.', 'INT./EXT.', 'EXT./INT.'],
    timeOfDay: [
      'JOUR',
      'NUIT',
      'MATIN',
      'SOIR',
      'CRÉPUSCULE',
      'AUBE',
      'CONTINU',
      'PLUS TARD',
    ],
    transitions: [
      'COUPE SUR :',
      'FONDU ENCHAÎNÉ :',
      'FONDU AU NOIR.',
      'OUVERTURE AU NOIR :',
    ],
    characterExtensions: ['(V.O.)', '(H.C.)', '(OFF)', '(CONT.)'],
  },

  es: {
    id: 'es',
    name: 'Español',
    scenePrefixes: ['INT.', 'EXT.', 'INT./EXT.', 'EXT./INT.'],
    timeOfDay: [
      'DÍA',
      'NOCHE',
      'MAÑANA',
      'TARDE',
      'ATARDECER',
      'AMANECER',
      'CONTINUO',
      'MÁS TARDE',
    ],
    transitions: [
      'CORTE A:',
      'FUNDE A:',
      'FUNDE A NEGRO.',
      'ENCADENA A:',
    ],
    characterExtensions: ['(V.O.)', '(F.C.)', '(OFF)', '(CONT.)'],
  },

  it: {
    id: 'it',
    name: 'Italiano',
    scenePrefixes: ['INT.', 'EST.', 'INT./EST.', 'EST./INT.'],
    timeOfDay: [
      'GIORNO',
      'NOTTE',
      'MATTINA',
      'SERA',
      'TRAMONTO',
      'ALBA',
      'CONTINUO',
      'PIÙ TARDI',
    ],
    transitions: [
      'STACCO SU:',
      'DISSOLVENZA IN APERTURA:',
      'DISSOLVENZA IN CHIUSURA.',
      'DISSOLVENZA INCROCIATA:',
    ],
    characterExtensions: ['(V.O.)', '(F.C.)', '(OFF)', '(CONT.)'],
  },

  de: {
    id: 'de',
    name: 'Deutsch',
    scenePrefixes: ['INNEN', 'AUSSEN', 'I/A', 'A/I', 'INT.', 'EXT.'],
    timeOfDay: [
      'TAG',
      'NACHT',
      'MORGEN',
      'ABEND',
      'DÄMMERUNG',
      'MORGENGRÄUEN',
      'ANSCHLIESSEND',
      'SPÄTER',
    ],
    transitions: [
      'SCHNITT ZU:',
      'AUFBLENDE:',
      'ABBLENDE.',
      'ÜBERBLENDE ZU:',
    ],
    characterExtensions: ['(V.O.)', '(O.S.)', '(OFF)', '(FORTS.)'],
  },

  ru: {
    id: 'ru',
    name: 'Русский',
    scenePrefixes: ['ИНТ.', 'НАТ.', 'ИНТ./НАТ.', 'НАТ./ИНТ.', 'ПАВ.'],
    timeOfDay: [
      'ДЕНЬ',
      'НОЧЬ',
      'УТРО',
      'ВЕЧЕР',
      'СУМЕРКИ',
      'РАССВЕТ',
      'ПРОДОЛЖЕНИЕ',
      'ПОЗЖЕ',
    ],
    transitions: [
      'ЗТМ.',
      'ИЗ ЗТМ.',
      'СКЛЕЙКА:',
      'НАПЛЫВ:',
      'ПЕРЕХОД К:',
    ],
    characterExtensions: ['(ЗК)', '(ГЗК)', '(ПРОД.)'],
  },

  uk: {
    id: 'uk',
    name: 'Українська',
    scenePrefixes: ['ІНТ.', 'НАТ.', 'ІНТ./НАТ.', 'НАТ./ІНТ.', 'ПАВ.'],
    timeOfDay: [
      'ДЕНЬ',
      'НІЧ',
      'РАНОК',
      'ВЕЧІР',
      'СУТІНКИ',
      'СВІТАНОК',
      'ПРОДОВЖЕННЯ',
      'ПІЗНІШЕ',
    ],
    transitions: [
      'ЗТМ.',
      'ІЗ ЗТМ.',
      'СКЛЕЙКА:',
      'НАПЛИВ:',
      'ПЕРЕХІД ДО:',
    ],
    characterExtensions: ['(ЗК)', '(ГЗК)', '(ПРОД.)'],
  },
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
    const cfg = SCREENPLAY_LOCALES[key.toLowerCase()];
    if (cfg) {
      merged.scenePrefixes.push(...cfg.scenePrefixes);
      merged.timeOfDay.push(...cfg.timeOfDay);
      merged.transitions.push(...cfg.transitions);
      merged.characterExtensions.push(...cfg.characterExtensions);
    }
  }

  // Fallback to English if an invalid code was entered
  if (merged.scenePrefixes.length === 0) {
    return SCREENPLAY_LOCALES.en;
  }

  // Remove duplicates when multiple languages are active (e.g. INT. / EXT.)
  merged.scenePrefixes = Array.from(new Set(merged.scenePrefixes));
  merged.timeOfDay = Array.from(new Set(merged.timeOfDay));
  merged.transitions = Array.from(new Set(merged.transitions));
  merged.characterExtensions = Array.from(new Set(merged.characterExtensions));

  return merged;
}
