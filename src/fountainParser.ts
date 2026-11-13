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
  characters: Map<string, number>;
  locations: Map<string, number>;
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
  const locations = new Map<string, number>();
  const outline: OutlineNode[] = [];

  let inMetadata = true;
  let sceneCounter = 0;

  const prefixPattern = localeCfg.scenePrefixes
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const sceneRegex = new RegExp(`^(${prefixPattern})(\\s+|$)`, 'i');

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();
    const prevType: BlockType = i > 0 ? parsedLines[i - 1].type : 'empty';
    const nextLine = i + 1 < rawLines.length ? rawLines[i + 1].trim() : '';

    // 1. Metadata at the top of the document (Title:, Author:, etc.)
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

    // 2. Empty line (keep dialogue indentation only right below Character or Parenthetical)
    if (trimmed === '') {
      if (prevType === 'character' || prevType === 'parenthetical') {
        parsedLines.push({ lineNumber: i + 1, text: line, type: 'dialogue' });
      } else {
        parsedLines.push({ lineNumber: i + 1, text: line, type: 'empty' });
      }
      continue;
    }

    // 3. Page break
    if (trimmed === '===') {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'page_break' });
      continue;
    }

    // 4. Sections (# Act 1, ## Sequence)
    const sectionMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (sectionMatch) {
      const level = (sectionMatch.at(1) || '#').length;
      const title = (sectionMatch.at(2) || '').trim();
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'section', sectionLevel: level });
      outline.push({ type: 'section', title, lineNumber: i + 1, level });
      continue;
    }

    // 5. Synopses (= Short scene summary)
    if (trimmed.startsWith('=') && !trimmed.startsWith('==')) {
      const title = trimmed.replace(/^=\s*/, '');
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'synopsis' });
      outline.push({ type: 'synopsis', title, lineNumber: i + 1, level: 99 });
      continue;
    }

    // 6. Centered text (> TEXT <)
    if (trimmed.startsWith('>') && trimmed.endsWith('<') && trimmed.length > 2) {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'centered' });
      continue;
    }

    // 7. Scene heading (INT. / EXT. or forced via leading dot .SCENE)
    if (
      sceneRegex.test(trimmed) ||
      ((prevType === 'empty' || prevType === 'section' || prevType === 'synopsis') &&
        trimmed.startsWith('.') &&
        !trimmed.startsWith('..'))
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

      // Extract location name (without prefix and time of day after " - ")
      const withoutPrefix = cleanHeading.replace(sceneRegex, '');
      const locName = (withoutPrefix.split(/\s+-\s+/).at(0) || '').trim().toUpperCase();
      if (locName) {
        locations.set(locName, (locations.get(locName) || 0) + 1);
      }
      continue;
    }

    // 8. Transition (CUT TO: or forced > FADE OUT)
    if (
      prevType === 'empty' &&
      nextLine === '' &&
      ((trimmed.startsWith('>') && !trimmed.endsWith('<')) ||
        (trimmed === trimmed.toUpperCase() && trimmed.endsWith('TO:')))
    ) {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'transition' });
      continue;
    }

    // 9. Parenthetical (inside a dialogue block)
    if (
      (prevType === 'character' || prevType === 'dialogue' || prevType === 'parenthetical') &&
      trimmed.startsWith('(') &&
      trimmed.endsWith(')')
    ) {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'parenthetical' });
      continue;
    }

    // 10. Dialogue (immediately follows Character or Parenthetical)
    if (prevType === 'character' || prevType === 'parenthetical' || prevType === 'dialogue') {
      parsedLines.push({ lineNumber: i + 1, text: line, type: 'dialogue' });
      continue;
    }

    // 11. Character (all caps or @NAME, after an empty line)
    const isAllCaps =
      trimmed === trimmed.toUpperCase() &&
      /\p{Lu}.*\p{Lu}/u.test(trimmed) &&
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

    // 12. Everything else — Action
    parsedLines.push({ lineNumber: i + 1, text: line, type: 'action' });
  }

  // Runtime & page estimation calibrated to US Letter PDFKit layout (~45 lines per page)
  let virtualLines = 0;
  for (const p of parsedLines) {
    switch (p.type) {
      case 'scene_heading':
        virtualLines += 2.6;
        break;
      case 'character':
        virtualLines += 1.8;
        break;
      case 'dialogue':
        virtualLines += Math.max(1, Math.ceil(p.text.length / 33)) + 0.25;
        break;
      case 'parenthetical':
        virtualLines += Math.max(1, Math.ceil(p.text.length / 24));
        break;
      case 'action':
        virtualLines += Math.max(1, Math.ceil(p.text.length / 58)) + 0.4;
        break;
      case 'transition':
        virtualLines += 2.2;
        break;
      case 'empty':
        virtualLines += 0.35;
        break;
      case 'page_break':
        virtualLines += 47.5 - (virtualLines % 47.5);
        break;
    }
  }

  const estimatedPages = Math.max(1, Math.round((virtualLines / 47.5) * 10) / 10);
  const estimatedMinutes = Math.max(1, Math.round(virtualLines / 47.5));

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
