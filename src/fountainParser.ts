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
  | 'page_break'
  | 'boneyard';

export interface ParsedLine {
  lineNumber: number; // 1-based
  text: string;
  cleanText: string; // text stripped of notes [[...]], leading !, trailing ^
  type: BlockType;
  sectionLevel?: number;
  isDualDialogue?: boolean;
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

// Helper to strip inline notes [[ ... ]] for clean analysis & PDF output
export function stripInlineNotes(text: string): string {
  return text.replace(/\[\[[\s\S]*?\]\]/g, '').trim();
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
  let inBoneyard = false;
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

    // 0. Multi-line boneyard comments /* ... */
    if (inBoneyard) {
      if (trimmed.includes('*/')) {
        inBoneyard = false;
      }
      parsedLines.push({ lineNumber: i + 1, text: line, cleanText: '', type: 'boneyard' });
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) {
        inBoneyard = true;
      }
      parsedLines.push({ lineNumber: i + 1, text: line, cleanText: '', type: 'boneyard' });
      continue;
    }

    // 1. Metadata at the top of the document (Title:, Author:, etc.)
    if (inMetadata) {
      if (trimmed === '') {
        inMetadata = false;
        parsedLines.push({ lineNumber: i + 1, text: line, cleanText: '', type: 'empty' });
        continue;
      }
      const metaMatch = line.match(/^([A-Za-zА-Яа-я\s]+):\s*(.*)$/);
      if (metaMatch && i < 20) {
        const metaKey = (metaMatch.at(1) || '').trim().toLowerCase();
        const metaVal = stripInlineNotes(metaMatch.at(2) || '');
        metadata[metaKey] = metaVal;
        parsedLines.push({ lineNumber: i + 1, text: line, cleanText: metaVal, type: 'metadata' });
        continue;
      } else {
        inMetadata = false;
      }
    }

    // 2. Empty line (keep dialogue indentation right below Character/Parenthetical,
    //    or between two non-empty lines of the same multi-line dialogue block)
    if (trimmed === '') {
      const nextIsAllCapsChar =
        nextLine !== '' &&
        nextLine === nextLine.toUpperCase() &&
        /\p{Lu}.*\p{Lu}/u.test(nextLine) &&
        !nextLine.endsWith(':') &&
        !nextLine.startsWith('>') &&
        !nextLine.startsWith('#');

      const nextStartsNewBlock =
        nextLine === '' ||
        nextLine.startsWith('@') ||
        nextLine.startsWith('#') ||
        nextLine.startsWith('=') ||
        nextLine.startsWith('!') ||
        nextLine.startsWith('>') ||
        nextLine.startsWith('.') ||
        sceneRegex.test(nextLine) ||
        nextIsAllCapsChar;

      if (
        prevType === 'character' ||
        prevType === 'parenthetical' ||
        (prevType === 'dialogue' && !nextStartsNewBlock)
      ) {
        parsedLines.push({ lineNumber: i + 1, text: line, cleanText: '', type: 'dialogue' });
      } else {
        parsedLines.push({ lineNumber: i + 1, text: line, cleanText: '', type: 'empty' });
      }
      continue;
    }

    // Standalone inline note line [[ ... ]]
    const withoutNotes = stripInlineNotes(trimmed);
    if (withoutNotes === '') {
      parsedLines.push({ lineNumber: i + 1, text: line, cleanText: '', type: 'boneyard' });
      continue;
    }

    // 3. Page break
    if (withoutNotes === '===') {
      parsedLines.push({ lineNumber: i + 1, text: line, cleanText: '', type: 'page_break' });
      continue;
    }

    // 4. Sections (# Act 1, ## Sequence)
    const sectionMatch = withoutNotes.match(/^(#{1,6})\s+(.*)$/);
    if (sectionMatch) {
      const level = (sectionMatch.at(1) || '#').length;
      const title = (sectionMatch.at(2) || '').trim();
      parsedLines.push({
        lineNumber: i + 1,
        text: line,
        cleanText: title,
        type: 'section',
        sectionLevel: level,
      });
      outline.push({ type: 'section', title, lineNumber: i + 1, level });
      continue;
    }

    // 5. Synopses (= Short scene summary)
    if (withoutNotes.startsWith('=') && !withoutNotes.startsWith('==')) {
      const title = withoutNotes.replace(/^=\s*/, '');
      parsedLines.push({ lineNumber: i + 1, text: line, cleanText: title, type: 'synopsis' });
      outline.push({ type: 'synopsis', title, lineNumber: i + 1, level: 99 });
      continue;
    }

    // 6. Forced Action (!ALL CAPS ACTION)
    if (withoutNotes.startsWith('!')) {
      const cleanAction = withoutNotes.slice(1).trim();
      parsedLines.push({ lineNumber: i + 1, text: line, cleanText: cleanAction, type: 'action' });
      continue;
    }

    // 7. Centered text (> TEXT <)
    if (withoutNotes.startsWith('>') && withoutNotes.endsWith('<') && withoutNotes.length > 2) {
      const cleanCentered = withoutNotes.slice(1, -1).trim();
      parsedLines.push({
        lineNumber: i + 1,
        text: line,
        cleanText: cleanCentered,
        type: 'centered',
      });
      continue;
    }

    // 8. Scene heading (INT. / EXT. or forced via leading dot .SCENE)
    if (
      sceneRegex.test(withoutNotes) ||
      ((prevType === 'empty' || prevType === 'section' || prevType === 'synopsis') &&
        withoutNotes.startsWith('.') &&
        !withoutNotes.startsWith('..'))
    ) {
      sceneCounter++;
      const cleanHeading = withoutNotes.startsWith('.')
        ? withoutNotes.slice(1).trim()
        : withoutNotes;
      parsedLines.push({
        lineNumber: i + 1,
        text: line,
        cleanText: cleanHeading,
        type: 'scene_heading',
      });
      outline.push({
        type: 'scene',
        title: cleanHeading.toUpperCase(),
        lineNumber: i + 1,
        level: 10,
        sceneNumber: sceneCounter,
      });

      const withoutPrefix = cleanHeading.replace(sceneRegex, '');
      const locName = (withoutPrefix.split(/\s+-\s+/).at(0) || '').trim().toUpperCase();
      if (locName) {
        locations.set(locName, (locations.get(locName) || 0) + 1);
      }
      continue;
    }

    // 9. Transition (CUT TO: or forced > FADE OUT)
    if (
      prevType === 'empty' &&
      nextLine === '' &&
      ((withoutNotes.startsWith('>') && !withoutNotes.endsWith('<')) ||
        (withoutNotes === withoutNotes.toUpperCase() && withoutNotes.endsWith('TO:')))
    ) {
      const cleanTrans = withoutNotes.replace(/^>\s*/, '');
      parsedLines.push({
        lineNumber: i + 1,
        text: line,
        cleanText: cleanTrans,
        type: 'transition',
      });
      continue;
    }

    // 10. Parenthetical (inside a dialogue block)
    if (
      (prevType === 'character' || prevType === 'dialogue' || prevType === 'parenthetical') &&
      withoutNotes.startsWith('(') &&
      withoutNotes.endsWith(')')
    ) {
      parsedLines.push({
        lineNumber: i + 1,
        text: line,
        cleanText: withoutNotes,
        type: 'parenthetical',
      });
      continue;
    }

    // 11. Dialogue (immediately follows Character, Parenthetical, or Dialogue)
    if (prevType === 'character' || prevType === 'parenthetical' || prevType === 'dialogue') {
      parsedLines.push({
        lineNumber: i + 1,
        text: line,
        cleanText: withoutNotes,
        type: 'dialogue',
      });
      continue;
    }

    // 12. Character (all caps with >= 2 letters or @NAME, optional dual dialogue '^')
    const hasDualCaret = /\s*\^\s*$/.test(withoutNotes);
    const nameWithoutCaret = withoutNotes.replace(/\s*\^\s*$/, '').trim();

    const isAllCaps =
      nameWithoutCaret === nameWithoutCaret.toUpperCase() &&
      /\p{Lu}.*\p{Lu}/u.test(nameWithoutCaret) &&
      !nameWithoutCaret.endsWith(':') &&
      !nameWithoutCaret.startsWith('>') &&
      !nameWithoutCaret.startsWith('#');

    const hasNextLine = i + 1 < rawLines.length;
    if (
      prevType === 'empty' &&
      (nameWithoutCaret.startsWith('@') || (isAllCaps && (nextLine !== '' || hasNextLine)))
    ) {
      const displayChar = nameWithoutCaret.replace(/^@/, '').trim();
      parsedLines.push({
        lineNumber: i + 1,
        text: line,
        cleanText: displayChar,
        type: 'character',
        isDualDialogue: hasDualCaret,
      });

      const cleanChar = displayChar
        .replace(/\s*\(.*?\)\s*$/, '')
        .trim()
        .toUpperCase();
      if (cleanChar && !nameWithoutCaret.startsWith('@')) {
        characters.set(cleanChar, (characters.get(cleanChar) || 0) + 1);
      }
      continue;
    }

    // 13. Everything else — Action
    parsedLines.push({ lineNumber: i + 1, text: line, cleanText: withoutNotes, type: 'action' });
  }

  // Runtime & page estimation calibrated to US Letter PDFKit layout
  let virtualLines = 0;
  for (const p of parsedLines) {
    switch (p.type) {
      case 'scene_heading':
        virtualLines += 2.6;
        break;
      case 'character':
        virtualLines += p.isDualDialogue ? 0 : 1.8;
        break;
      case 'dialogue':
        virtualLines += Math.max(1, Math.ceil(p.cleanText.length / 33)) + 0.25;
        break;
      case 'parenthetical':
        virtualLines += Math.max(1, Math.ceil(p.cleanText.length / 24));
        break;
      case 'action':
        virtualLines += Math.max(1, Math.ceil(p.cleanText.length / 58)) + 0.4;
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
      case 'boneyard':
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
