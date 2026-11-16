import {
  Completion,
  CompletionContext,
  CompletionResult,
  startCompletion,
} from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { getActiveLocaleConfig } from '../locales';
import { fountainStateField } from './fountainState';
import { ScreenplayAnalysis } from '../fountainParser';

function getOrderedCharacters(
  docAnalysis: ScreenplayAnalysis,
  extCharacters: string[],
  currentLineNumber: number
): string[] {
  const recentSpeakers: string[] = [];

  for (let i = currentLineNumber - 2; i >= 0; i--) {
    const parsed = docAnalysis.lines[i];
    if (!parsed || parsed.type !== 'character') continue;

    const cleanName = parsed.cleanText
      .replace(/\s*\(.*?\)\s*$/, '')
      .trim()
      .toUpperCase();

    if (cleanName && !recentSpeakers.includes(cleanName)) {
      recentSpeakers.push(cleanName);
    }
  }

  if (recentSpeakers.length >= 2) {
    const [lastSpeaker, prevSpeaker] = recentSpeakers;
    recentSpeakers[0] = prevSpeaker;
    recentSpeakers[1] = lastSpeaker;
  }

  const ordered = [...recentSpeakers];

  for (const c of docAnalysis.characters.keys()) {
    const upper = c.toUpperCase();
    if (!ordered.includes(upper)) ordered.push(upper);
  }
  for (const c of extCharacters) {
    const upper = c.toUpperCase();
    if (!ordered.includes(upper)) ordered.push(upper);
  }

  return ordered;
}

export function createFountainCompleter(context: CompletionContext): CompletionResult | null {
  const { dictionary: extDict, analysis: docAnalysis } = context.state.field(fountainStateField);
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);
  const trimmedBefore = textBefore.trimStart();
  const localeCfg = getActiveLocaleConfig(extDict.locales || ['en']);

  const prevLineText =
    line.number > 1 ? context.state.doc.line(line.number - 1).text.trim() : '';

  const prefixList = [...localeCfg.scenePrefixes]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const startsWithScenePrefix =
    new RegExp(`^(?:${prefixList})(?:\\s|$)`, 'i').test(trimmedBefore) ||
    trimmedBefore.startsWith('.');

  // STEP 1: Suggest scene prefixes and uppercase characters at the start of a new block
  if (
    prevLineText === '' &&
    trimmedBefore.length >= 1 &&
    !trimmedBefore.startsWith('@') &&
    !startsWithScenePrefix
  ) {
    const isPrefixCandidate = /^[\p{L}./]{1,10}$/u.test(trimmedBefore);
    const prefixOptions: Completion[] = isPrefixCandidate
      ? localeCfg.scenePrefixes.map((p) => ({
          label: p + ' ',
          type: 'keyword',
          detail: 'Scene prefix',
          boost: 1000,
          apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
            const insert = p + ' ';
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + insert.length },
            });
            requestAnimationFrame(() => startCompletion(view));
          },
        }))
      : [];

    const orderedChars = getOrderedCharacters(docAnalysis, extDict.characters, line.number);

    const isUpperCharCandidate =
      trimmedBefore === trimmedBefore.toUpperCase() &&
      /^[\p{L}\d\s.'()-]{1,40}$/u.test(trimmedBefore);

    const charOptions: Completion[] = isUpperCharCandidate
      ? orderedChars.map((c, index) => ({
          label: c,
          type: 'variable',
          detail: index === 0 ? 'Next speaker' : 'Character',
          boost: 900 - index,
        }))
      : [];

    const options = [...prefixOptions, ...charOptions];
    if (options.length > 0) {
      const leadingSpaces = textBefore.length - trimmedBefore.length;
      return {
        from: line.from + leadingSpaces,
        options,
        validFor: /^[\p{L}\d\s.'()-]*$/u,
        filter: true,
      };
    }
  }

  // STEP 2: After scene prefix and before hyphen -> suggest locations
  const locMatch = textBefore.match(new RegExp(`^(${prefixList})\\s+([^-]*)$`, 'i'));
  if (locMatch) {
    const allLocs = new Set<string>([
      ...docAnalysis.locations.keys(),
      ...extDict.locations,
    ]);
    if (allLocs.size === 0) return null;

    const matchedPrefix = locMatch.at(1) || '';
    const fromPos = line.from + matchedPrefix.length + 1;
    return {
      from: fromPos,
      options: Array.from(allLocs).map((loc) => ({
        label: loc,
        type: 'class',
        detail: 'Location',
      })),
      validFor: /^[^-]*$/,
      filter: true,
    };
  }

  // STEP 3: After hyphen in scene heading -> suggest time of day
  const todMatch = textBefore.match(
    new RegExp(`^(?:(?:${prefixList})\\s+|\\.)(.+?)\\s*-\\s*(.*)$`, 'i')
  );
  if (todMatch) {
    const dashIndex = textBefore.lastIndexOf('-');
    const afterDash = textBefore.slice(dashIndex + 1);
    const leadingSpaces = (afterDash.match(/^\s*/)?.at(0) || '').length;
    const afterDashPos = line.from + dashIndex + 1;
    const fromPos = Math.min(context.pos, afterDashPos + leadingSpaces);

    return {
      from: fromPos,
      options: localeCfg.timeOfDay.map((t) => ({
        label: t,
        type: 'enum',
        detail: 'Time of day',
        apply: (view: EditorView, _completion: Completion, _from: number, to: number) => {
          const insert = ` ${t}`;
          view.dispatch({
            changes: { from: afterDashPos, to, insert },
            selection: { anchor: afterDashPos + insert.length },
          });
        },
      })),
      validFor: leadingSpaces === 0 ? /^[^\s].*$/ : /^.*$/,
      filter: true,
    };
  }

  // STEP 4: Character input after '@'
  const atIndex = textBefore.indexOf('@');
  if (atIndex !== -1 && textBefore.slice(0, atIndex).trim() === '') {
    const orderedChars = getOrderedCharacters(docAnalysis, extDict.characters, line.number);

    if (orderedChars.length === 0) return null;

    const replaceFrom = line.from + atIndex;
    const matchFrom = replaceFrom + 1;

    return {
      from: matchFrom,
      options: orderedChars.map((c, index) => ({
        label: c,
        type: 'variable',
        detail: index === 0 ? 'Next speaker' : 'Character',
        boost: 900 - index,
        apply: (view: EditorView, _completion: Completion, _from: number, to: number) => {
          view.dispatch({
            changes: { from: replaceFrom, to, insert: c },
            selection: { anchor: replaceFrom + c.length },
          });
        },
      })),
      validFor: /^[^()]*$/,
      filter: true,
    };
  }

  return null;
}
