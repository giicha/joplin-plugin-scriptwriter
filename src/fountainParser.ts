import { getActiveLocaleConfig } from './locales';

export type BlockType =
  | 'empty'
  | 'metadata'
  | 'section'
  | 'synopsis'
  | 'scene_heading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'centered'
  | 'page_break';

export interface ParsedLine {
  lineNumber: number; // 1-based
  text: string;
  type: BlockType;
  sectionLevel?: number;
}

export interface OutlineNode {
  type: 'section' | 'scene' | 'synopsis';
  title: string;
  lineNumber: number;
  level: number;
  sceneNumber?: number;
}

export interface ScreenplayAnalysis {
  lines: ParsedLine[];
  metadata: Record<string, string>;
  characters: Map<string, number>; // Имя -> кол-во реплик
  locations: Set<string>;
  outline: OutlineNode[];
  estimatedPages: number;
  estimatedMinutes: number;
}

export function analyzeFountain(text: string, locales: string[] = ['en']): ScreenplayAnalysis {
  const localeCfg = getActiveLocaleConfig(locales);
  const rawLines = text.split(/\r?\n/);
  const parsedLines: ParsedLine[] = [];
  const metadata: Record<string, string> = {};
  const characters = new Map<string, number>();
  const locations = new Set<string>();
  const outline: OutlineNode[] = [];

  let inMetadata = true;
  let sceneCounter = 0;

  const prefixPattern = localeCfg.scenePrefixes
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const sceneRegex = new RegExp(`^(${prefixPattern})\\s+`, 'i');

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();
    const prevType: BlockType = i > 0 ? parsedLines[i - 1].type : 'empty';
    const nextLine = i + 1 < rawLines.length ? rawLines[i + 1].trim() : '';

    // 1. Метаданные в начале документа (Title:, Author: и т.д.)
    if (inMetadata) {
      if (trimmed === '') {
        inMetadata = false;
        parsedLines.push({ lineNumber: i + 1, text: line, type: 'empty' });
        continue;
      }
      const metaMatch = line.match(/^([A-Za-zА-Яа-я\s]+):\s*(.*)$/);
      if (metaMatch && i < 20) {
        const metaKey = (metaMatch.at(1) || '').trim().toLowerCase();
        const metaVal = (metaMatch.at(2) || '').trim();
        metadata[metaKey] = metaVal;
        parsedLines.push({ lineNumber: i + 1, text: line, type: 'metadata' });
        continue;
      } else {
        inMetadata = false;
      }
    }

    // 2. Пустая строка (если она сразу под Персонажем или Ремаркой — даем ей отступ Реплики, чтобы курсор мигал в нужном месте)
    if (trimmed === '') {
      if (prevType === 'character' || prevType === 'parenthetical') {
        parsedLines.push({ lineNumber: i + 1, text: line, type: 'dialogue' });
      } else {
        parsedLines.push({ lineNumber: i + 1, text: line, type: 'empty' });
      }
      continue;
    }

    // 3. Разрыв страницы
    if (trimmed === '===') {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'page_break' });
      continue;
    }

    // 4. Секции (# Акт 1, ## Эпизод)
    const sectionMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (sectionMatch) {
      const level = (sectionMatch.at(1) || '#').length;
      const title = (sectionMatch.at(2) || '').trim();
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'section', sectionLevel: level });
      outline.push({ type: 'section', title, lineNumber: i + 1, level });
      continue;
    }

    // 5. Синопсисы (= Краткое описание)
    if (trimmed.startsWith('=') && !trimmed.startsWith('==')) {
      const title = trimmed.replace(/^=\s*/, '');
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'synopsis' });
      outline.push({ type: 'synopsis', title, lineNumber: i + 1, level: 99 });
      continue;
    }

    // 6. Центрированный текст (> ТЕКСТ <)
    if (trimmed.startsWith('>') && trimmed.endsWith('<') && trimmed.length > 2) {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'centered' });
      continue;
    }

    // 7. Заголовок сцены (INT. / EXT. или принудительный через точку .SCENE)
    if (
      (prevType === 'empty' || prevType === 'section' || prevType === 'synopsis') &&
      (sceneRegex.test(trimmed) || (trimmed.startsWith('.') && !trimmed.startsWith('..')))
    ) {
      sceneCounter++;
      const cleanHeading = trimmed.startsWith('.') ? trimmed.slice(1).trim() : trimmed;
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'scene_heading' });
      outline.push({
        type: 'scene',
        title: cleanHeading.toUpperCase(),
        lineNumber: i + 1,
        level: 10,
        sceneNumber: sceneCounter,
      });

      // Извлекаем локацию (без префикса и без времени суток после " - ")
      const withoutPrefix = cleanHeading.replace(sceneRegex, '');
      const locName = (withoutPrefix.split(/\s+-\s+/).at(0) || '').trim().toUpperCase();
      if (locName) locations.add(locName);
      continue;
    }

    // 8. Переход (CUT TO: или принудительный > FADE OUT)
    if (
      prevType === 'empty' &&
      nextLine === '' &&
      ((trimmed.startsWith('>') && !trimmed.endsWith('<')) ||
        (trimmed === trimmed.toUpperCase() && trimmed.endsWith('TO:')))
    ) {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'transition' });
      continue;
    }

    // 9. Ремарка (внутри диалогового блока)
    if (
      (prevType === 'character' || prevType === 'dialogue' || prevType === 'parenthetical') &&
      trimmed.startsWith('(') &&
      trimmed.endsWith(')')
    ) {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'parenthetical' });
      continue;
    }

    // 10. Реплика (идет сразу после персонажа или ремарки)
    if (prevType === 'character' || prevType === 'parenthetical' || prevType === 'dialogue') {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'dialogue' });
      continue;
    }

    // 11. Персонаж (верхний регистр или @ИМЯ, после пустой строки)
    const isAllCaps =
      trimmed === trimmed.toUpperCase() &&
      /[A-ZА-ЯЁ]/.test(trimmed) &&
      !trimmed.endsWith(':') &&
      !trimmed.startsWith('>') &&
      !trimmed.startsWith('#');

    const hasNextLine = i + 1 < rawLines.length;
    if (
      prevType === 'empty' &&
      (trimmed.startsWith('@') || (isAllCaps && (nextLine !== '' || hasNextLine)))
    ) {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'character' });
      const cleanChar = trimmed
        .replace(/^@/, '')
        .replace(/\s*\(.*?\)\s*$/, '')
        .trim()
        .toUpperCase();
      if (cleanChar && !trimmed.startsWith('@')) {
        characters.set(cleanChar, (characters.get(cleanChar) || 0) + 1);
      }
      continue;
    }

    // 12. Всё остальное — Описание действия (Action)
    parsedLines.push({ lineNumber: i + 1, text: line, type: 'action' });
  }

  // Расчет хронометража: 1 страница сценария (~55 строк с учетом отступов и переносов) = 1 минута
  let virtualLines = 0;
  for (const p of parsedLines) {
    switch (p.type) {
      case 'scene_heading':
        virtualLines += 2.5;
        break;
      case 'character':
        virtualLines += 2;
        break;
      case 'dialogue':
        virtualLines += Math.max(1, Math.ceil(p.text.length / 35));
        break;
      case 'parenthetical':
        virtualLines += Math.max(1, Math.ceil(p.text.length / 25));
        break;
      case 'action':
        virtualLines += Math.max(1, Math.ceil(p.text.length / 60));
        break;
      case 'transition':
        virtualLines += 2;
        break;
      case 'empty':
        virtualLines += 0.5;
        break;
      case 'page_break':
        virtualLines += 55 - (virtualLines % 55);
        break;
    }
  }

  const estimatedPages = Math.max(1, Math.round((virtualLines / 55) * 10) / 10);
  const estimatedMinutes = Math.max(1, Math.round(virtualLines / 55));

  return {
    lines: parsedLines,
    metadata,
    characters,
    locations,
    outline,
    estimatedPages,
    estimatedMinutes,
  };
}
