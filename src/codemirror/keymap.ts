import { EditorView, KeyBinding } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { BlockType } from '../fountainParser';
import { acceptCompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { getActiveLocaleConfig } from '../locales';
import { fountainStateField, forceDialogueLineEffect, setSuggestedCharacterEffect } from './fountainState';

function getCurrentLineType(state: EditorState, lineNumber: number): BlockType {
  const { analysis } = state.field(fountainStateField);
  const found = analysis.lines.find((l) => l.lineNumber === lineNumber);
  return found ? found.type : 'action';
}

function getParentheticalEndLine(state: EditorState, lineNumber: number) {
  const { analysis } = state.field(fountainStateField);
  let endLineNum = lineNumber;
  while (endLineNum < analysis.lines.length && analysis.lines[endLineNum]?.type === 'parenthetical') {
    endLineNum++;
  }
  return state.doc.line(endLineNum);
}

/**
 * Ensures an empty separator line before a top-level block
 * (scene_heading, character, transition, or action after dialogue).
 */
function ensureBlankLineBefore(state: EditorState, lineNumber: number): string {
  if (lineNumber <= 1) return '';
  const prevLine = state.doc.line(lineNumber - 1);
  return prevLine.text.trim() === '' ? '' : '\n';
}

/**
 * Triggers CodeMirror autocomplete popup on the next animation frame
 * after fountainStateField re-analyzes the updated document.
 */
function triggerAutocomplete(view: EditorView): void {
  requestAnimationFrame(() => {
    view.focus();
    startCompletion(view);
  });
}

/**
 * Finds the alternating dialogue partner (the character speaking one turn before
 * the current speaker) to suggest on Enter after a dialogue line.
 */
function findAlternateSpeaker(state: EditorState, currentLineNumber: number): string | null {
  const { analysis } = state.field(fountainStateField);
  let currentSpeaker: string | null = null;

  for (let i = currentLineNumber - 1; i >= 1; i--) {
    const lineInfo = analysis.lines[i - 1];
    if (!lineInfo) continue;

    // Stop searching if we cross a scene boundary
    if (lineInfo.type === 'scene_heading') {
      break;
    }

    if (lineInfo.type === 'character') {
      const cleanName = lineInfo.cleanText
        .replace(/\s*\(.*?\)\s*$/, '')
        .trim()
        .toUpperCase();

      if (!cleanName) continue;

      if (!currentSpeaker) {
        currentSpeaker = cleanName;
      } else if (cleanName !== currentSpeaker) {
        return cleanName;
      }
    }
  }

  return null;
}

export function createFountainKeymap(): KeyBinding[] {
  return [
    // =========================================================================
    // TAB: styles-changing (empty block) and styles-jumping (non-empty block)
    // =========================================================================
    {
      key: 'Tab',
      run: (view) => {
        if (completionStatus(view.state) === 'active') {
          return acceptCompletion(view);
        }

        const state = view.state;
        // STARC rule: do not switch styles when there is an active text selection
        if (!state.selection.main.empty) {
          return false;
        }

        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const currentType = getCurrentLineType(state, line.number);
        const trimmed = line.text.trim();
        const textBeforeCursor = line.text.slice(0, pos - line.from);
        const textAfterCursor = line.text.slice(pos - line.from);

        const { dictionary: extDict } = state.field(fountainStateField);
        const locales = extDict.locales || ['en'];
        const localeCfg = getActiveLocaleConfig(locales);
        const cyclePrefixes = localeCfg.scenePrefixes.slice(0, 3);
        const firstPrefix = cyclePrefixes[0] || 'INT.';

        // Check if the line is an empty scene heading (prefix only, e.g. "INT.")
        const isBareScenePrefix = cyclePrefixes.some(
          (p) => p.toUpperCase() === trimmed.toUpperCase()
        );

        // ---------------------------------------------------------------------
        // A. EMPTY BLOCK (STARC styles-changing rules)
        // ---------------------------------------------------------------------
        const isEmptyBlock =
          trimmed === '' || trimmed === '@' || trimmed === '>' || isBareScenePrefix;

        if (isEmptyBlock) {
          // 1. Empty Character (@) -> Transition (> )
          if (trimmed === '@') {
            const insertText = '> ';
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: insertText },
              selection: EditorSelection.cursor(line.from + insertText.length),
            });
            return true;
          }

          // 2. Empty Transition (> ) -> Action (clear the line)
          if (trimmed === '>') {
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: '' },
              selection: EditorSelection.cursor(line.from),
            });
            return true;
          }

          // 3. Empty Scene Heading (INT.) -> Character (@) + open character autocomplete
          if (isBareScenePrefix) {
            const insertText = '@';
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: insertText },
              selection: EditorSelection.cursor(line.from + insertText.length),
            });
            triggerAutocomplete(view);
            return true;
          }

          // 4. Empty Dialogue (line immediately below Character) -> Parenthetical ()
          if (currentType === 'dialogue') {
            const insertText = '()';
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: insertText },
              selection: EditorSelection.cursor(line.from + 1), // place cursor inside parentheses
            });
            return true;
          }

          // 5. Empty Action -> Character (@) + open character autocomplete
          const leadingBreak = ensureBlankLineBefore(state, line.number);
          const insertText = `${leadingBreak}@`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + insertText.length),
          });
          triggerAutocomplete(view);
          return true;
        }

        // ---------------------------------------------------------------------
        // B. NON-EMPTY BLOCK (STARC styles-jumping rules)
        // ---------------------------------------------------------------------
        // Allow Tab to exit Parenthetical from anywhere inside the parentheses (including before ')')
        if (currentType === 'parenthetical') {
          const endLine = getParentheticalEndLine(state, line.number);
          view.dispatch({
            changes: { from: endLine.to, to: endLine.to, insert: '\n' },
            selection: EditorSelection.cursor(endLine.to + 1),
          });
          return true;
        }

        if (textBeforeCursor.trim() === '' || textAfterCursor.trim() !== '') {
          // STARC rule: Tab at the beginning or middle of a non-empty line does nothing
          return true;
        }

        // 1. Non-empty Scene Heading -> new Action block
        if (currentType === 'scene_heading') {
          const upper = trimmed.toUpperCase();
          const insertText = `${upper}\n\n`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + insertText.length),
          });
          return true;
        }

        // 2. Non-empty Action -> new Character block (@) + open character autocomplete
        if (currentType === 'action') {
          const insertText = `\n\n@`;
          view.dispatch({
            changes: { from: line.to, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.to + insertText.length),
          });
          triggerAutocomplete(view);
          return true;
        }

        // 3. Non-empty Character -> new Parenthetical block ()
        if (currentType === 'character' || trimmed.startsWith('@')) {
          const cleanChar = trimmed.replace(/^@/, '').trim().toUpperCase();
          const insertText = `${cleanChar}\n()`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + cleanChar.length + 2),
          });
          return true;
        }

        // 4. Non-empty Dialogue -> new Parenthetical block ()
        if (currentType === 'dialogue') {
          const insertText = `\n()`;
          view.dispatch({
            changes: { from: line.to, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.to + 2),
          });
          return true;
        }

        // 6. Non-empty Transition -> new Scene Heading block (INT. ) + open location autocomplete
        if (currentType === 'transition') {
          const insertText = `\n\n${firstPrefix} `;
          view.dispatch({
            changes: { from: line.to, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.to + insertText.length),
          });
          triggerAutocomplete(view);
          return true;
        }

        return false;
      },
    },

    // =========================================================================
    // ENTER: styles-changing (empty block) and styles-jumping (non-empty block)
    // =========================================================================
    {
      key: 'Enter',
      run: (view) => {
        if (completionStatus(view.state) === 'active') {
          return acceptCompletion(view);
        }

        const state = view.state;
        // STARC rule: do not trigger block transitions when text is selected
        if (!state.selection.main.empty) {
          return false;
        }

        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const currentType = getCurrentLineType(state, line.number);
        const trimmed = line.text.trim();
        const textBeforeCursor = line.text.slice(0, pos - line.from);
        const textAfterCursor = line.text.slice(pos - line.from);

        const { dictionary: extDict } = state.field(fountainStateField);
        const locales = extDict.locales || ['en'];
        const localeCfg = getActiveLocaleConfig(locales);
        const cyclePrefixes = localeCfg.scenePrefixes.slice(0, 3);
        const firstPrefix = cyclePrefixes[0] || 'INT.';

        const isBareScenePrefix = cyclePrefixes.some(
          (p) => p.toUpperCase() === trimmed.toUpperCase()
        );

        // ---------------------------------------------------------------------
        // A. EMPTY BLOCK (STARC styles-changing rules)
        // ---------------------------------------------------------------------
        const isEmptyBlock =
          trimmed === '' ||
          trimmed === '@' ||
          trimmed === '>' ||
          trimmed === '()' ||
          isBareScenePrefix;

        if (isEmptyBlock) {
          // 1. Empty Dialogue (line immediately below Character) -> Action (\n)
          if (currentType === 'dialogue') {
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: '\n' },
              selection: EditorSelection.cursor(line.from + 1),
            });
            return true;
          }

          // 2. Empty Parenthetical () -> Dialogue (clear parentheses)
          if (trimmed === '()') {
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: '' },
              selection: EditorSelection.cursor(line.from),
            });
            return true;
          }

          // 3. Empty Scene Heading (INT.), Character (@), or Transition (>) -> Action
          if (isBareScenePrefix || trimmed === '@' || trimmed === '>') {
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: '' },
              selection: EditorSelection.cursor(line.from),
            });
            return true;
          }

          // 4. Empty Action -> Scene Heading (INT. ) + open location autocomplete
          const leadingBreak = ensureBlankLineBefore(state, line.number);
          const insertText = `${leadingBreak}${firstPrefix} `;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + insertText.length),
          });
          triggerAutocomplete(view);
          return true;
        }

        // ---------------------------------------------------------------------
        // B. CURSOR AT THE START OF A NON-EMPTY BLOCK
        // ---------------------------------------------------------------------
        if (textBeforeCursor.trim() === '') {
          // Inside Dialogue or Parenthetical: ignore (cannot start with an empty block)
          if (currentType === 'dialogue' || currentType === 'parenthetical') {
            return true;
          }

          // Top-level blocks (Scene Heading, Character, Action, Transition):
          // push the current block down and place the cursor on a new Action block above
          const prevLine = line.number > 1 ? state.doc.line(line.number - 1) : null;
          const prevIsEmpty = !prevLine || prevLine.text.trim() === '';

          if (line.number === 1 || prevIsEmpty) {
            view.dispatch({
              changes: { from: pos, to: pos, insert: '\n\n' },
              selection: EditorSelection.cursor(pos),
            });
          } else {
            view.dispatch({
              changes: { from: pos, to: pos, insert: '\n\n\n' },
              selection: EditorSelection.cursor(pos + 1),
            });
          }
          return true;
        }

        // ---------------------------------------------------------------------
        // C. CURSOR IN THE MIDDLE OF A NON-EMPTY BLOCK (STARC rule: split into 2 blocks)
        // ---------------------------------------------------------------------
        if (textAfterCursor.trim() !== '') {
          const leftPart = textBeforeCursor.trimEnd();
          const rightPart = textAfterCursor.trimStart();

        // Inside Parenthetical (Section C - middle of line): exit parentheses onto a new Dialogue line
        if (currentType === 'parenthetical') {
          const endLine = getParentheticalEndLine(state, line.number);
          view.dispatch({
            changes: { from: endLine.to, to: endLine.to, insert: '\n' },
            selection: EditorSelection.cursor(endLine.to + 1),
          });
          return true;
        }

        // Inside Dialogue: line break without blank line to keep dialogue block intact
        if (currentType === 'dialogue') {
          const insertText = `${leftPart}\n${rightPart}`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + leftPart.length + 1),
          });
          return true;
        }

          // For Character: preserve uppercase and prepend '@' to the second part
          if (currentType === 'character' || trimmed.startsWith('@')) {
            const cleanLeft = leftPart.replace(/^@/, '').toUpperCase();
            const cleanRight = `@${rightPart.replace(/^@/, '').toUpperCase()}`;
            const insertText = `${cleanLeft}\n\n${cleanRight}`;
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: insertText },
              selection: EditorSelection.cursor(line.from + cleanLeft.length + 2),
            });
            return true;
          }

          // For Action, Scene Heading, and Transition: split with a blank separator line
          const formattedLeft =
            currentType === 'scene_heading' ? leftPart.toUpperCase() : leftPart;
          const insertText = `${formattedLeft}\n\n${rightPart}`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + formattedLeft.length + 2),
          });
          return true;
        }

        // ---------------------------------------------------------------------
        // D. CURSOR AT THE END OF A NON-EMPTY BLOCK (STARC styles-jumping rules)
        // ---------------------------------------------------------------------

        // 1. Scene Heading -> Action (\n\n)
        if (currentType === 'scene_heading') {
          const upper = trimmed.toUpperCase();
          const insertText = `${upper}\n\n`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + insertText.length),
          });
          return true;
        }

        // 2. Action -> Action (\n\n)
        if (currentType === 'action') {
          const insertText = `\n\n`;
          view.dispatch({
            changes: { from: line.to, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.to + 2),
          });
          return true;
        }

        // 3. Character -> Dialogue (\n without blank line)
        if (currentType === 'character' || trimmed.startsWith('@')) {
          const cleanChar = trimmed.replace(/^@/, '').trim().toUpperCase();
          const insertText = `${cleanChar}\n`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + insertText.length),
          });
          return true;
        }

        // 4. Parenthetical -> Dialogue (\n after closing ')')
        if (currentType === 'parenthetical') {
          const endLine = getParentheticalEndLine(state, line.number);
          view.dispatch({
            changes: { from: endLine.to, to: endLine.to, insert: '\n' },
            selection: EditorSelection.cursor(endLine.to + 1),
          });
          return true;
        }

        // 5. Dialogue -> Action (\n\n)
        if (currentType === 'dialogue') {
          const alternateSpeaker = findAlternateSpeaker(state, line.number);
          const insertText = `\n\n`;
          view.dispatch({
            changes: { from: line.to, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.to + insertText.length),
            effects: setSuggestedCharacterEffect.of(alternateSpeaker),
          });
          return true;
        }

        // 6. Transition -> Scene Heading (\n\nINT. ) + open location autocomplete
        if (currentType === 'transition') {
          const cleanTrans = trimmed.toUpperCase();
          const insertText = `${cleanTrans}\n\n${firstPrefix} `;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + insertText.length),
          });
          triggerAutocomplete(view);
          return true;
        }

        return false;
      },
    },

    // =========================================================================
    // SHIFT+ENTER: soft line break inside the current block without changing type
    // =========================================================================
    {
      key: 'Shift-Enter',
      run: (view) => {
        const state = view.state;
        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const currentType = getCurrentLineType(state, line.number);

        // Inside dialogue blocks, follow Fountain spec ('  \n' for an empty dialogue line)
        if (currentType === 'dialogue' || currentType === 'parenthetical') {
          if (line.text.trim() === '' && currentType === 'dialogue') {
            view.dispatch({
              changes: { from: pos, to: pos, insert: '  \n' },
              selection: EditorSelection.cursor(pos + 3),
              effects: forceDialogueLineEffect.of(line.number + 1),
            });
            return true;
          }

          view.dispatch({
            changes: { from: pos, to: pos, insert: '\n' },
            selection: EditorSelection.cursor(pos + 1),
            ...(currentType === 'dialogue'
              ? { effects: forceDialogueLineEffect.of(line.number + 1) }
              : {}),
          });
          return true;
        }

        // In all other blocks (Action, Scene Heading, etc.): single \n without breaking paragraph
        view.dispatch({
          changes: { from: pos, to: pos, insert: '\n' },
          selection: EditorSelection.cursor(pos + 1),
        });
        return true;
      },
    },
  ];
}
