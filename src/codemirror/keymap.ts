import { KeyBinding } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { BlockType } from '../fountainParser';
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { getActiveLocaleConfig } from '../locales';
import { fountainStateField, forceDialogueLineEffect } from './fountainState';

function getCurrentLineType(state: EditorState, lineNumber: number): BlockType {
  const { analysis } = state.field(fountainStateField);
  const found = analysis.lines.find((l) => l.lineNumber === lineNumber);
  return found ? found.type : 'action';
}

export function createFountainKeymap(): KeyBinding[] {
  return [
    {
      key: 'Tab',
      run: (view) => {
        if (completionStatus(view.state) === 'active') {
          return acceptCompletion(view);
        }

        const state = view.state;
        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const { dictionary: extDict } = state.field(fountainStateField);
        const locales = extDict.locales || ['en'];
        const localeCfg = getActiveLocaleConfig(locales);

        const currentType = getCurrentLineType(state, line.number);
        const trimmed = line.text.trim();

        // Prefixes for cyclic switching (first 3 from active locale, e.g., INT., EXT., INT./EXT.)
        const cyclePrefixes = localeCfg.scenePrefixes.slice(0, 3);
        const firstPrefix = cyclePrefixes[0] || 'INT.';

        // 1. Cyclic switching on an empty line or bare prefix:
        // Empty line -> Character (@) -> Prefix 1 -> Prefix 2 -> Prefix 3 -> Empty line
        if (trimmed === '') {
          const prevLine = line.number > 1 ? state.doc.line(line.number - 1) : null;
          const prefix = prevLine && prevLine.text.trim() !== '' ? '\n@' : '@';
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: prefix },
            selection: EditorSelection.cursor(line.from + prefix.length),
          });
          return true;
        }

        if (trimmed === '@') {
          const insertText = `${firstPrefix} `;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + insertText.length),
          });
          return true;
        }

        // Check if the line is currently just one of the bare prefixes (e.g. "INT." or "ИНТ.")
        const barePrefixIdx = cyclePrefixes.findIndex(
          (p) => p.toUpperCase() === trimmed.toUpperCase()
        );
        if (barePrefixIdx !== -1) {
          const nextIdx = barePrefixIdx + 1;
          if (nextIdx < cyclePrefixes.length) {
            const insertText = `${cyclePrefixes[nextIdx]} `;
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: insertText },
              selection: EditorSelection.cursor(line.from + insertText.length),
            });
          } else {
            // Reset back to empty line after cycling through prefixes
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: '' },
              selection: EditorSelection.cursor(line.from),
            });
          }
          return true;
        }

        // 2. Switch prefix inside an existing scene heading on Tab (e.g. INT. SHOP -> EXT. SHOP)
        if (currentType === 'scene_heading') {
          let updatedHeading = trimmed;
          for (let i = 0; i < cyclePrefixes.length; i++) {
            const curr = cyclePrefixes[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`^${curr}\\s+`, 'i');
            if (regex.test(trimmed)) {
              const nextPrefix = cyclePrefixes[(i + 1) % cyclePrefixes.length];
              updatedHeading = trimmed.replace(regex, `${nextPrefix} `);
              break;
            }
          }
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: updatedHeading },
            selection: EditorSelection.cursor(line.from + updatedHeading.length),
          });
          return true;
        }

        // 3. From filled Character -> Parenthetical ()
        if (currentType === 'character' || trimmed.startsWith('@')) {
          const cleanChar = trimmed.replace(/^@/, '').toUpperCase();
          const insertText = `${cleanChar}\n()`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + cleanChar.length + 2),
          });
          return true;
        }

        // 4. From filled Action -> Transition (> CUT TO:)
        if (currentType === 'action') {
          const transitionText = trimmed.startsWith('>')
            ? trimmed.replace(/^>\s*/, '')
            : `> ${trimmed.toUpperCase()}`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: transitionText },
            selection: EditorSelection.cursor(line.from + transitionText.length),
          });
          return true;
        }

        // 5. From Dialogue -> Parenthetical (add parenthetical on the next line)
        if (currentType === 'dialogue') {
          const insertText = `${line.text}\n()`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + line.text.length + 2),
          });
          return true;
        }

        // 6. From Transition -> back to Action
        if (currentType === 'transition') {
          const cleanAction = trimmed.replace(/^>\s*/, '');
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: cleanAction },
            selection: EditorSelection.cursor(line.from + cleanAction.length),
          });
          return true;
        }

        return false;
      },
    },
    {
      key: 'Enter',
      run: (view) => {
        if (completionStatus(view.state) === 'active') {
          return acceptCompletion(view);
        }

        const state = view.state;
        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const currentType = getCurrentLineType(state, line.number);
        const trimmed = line.text.trim();
        const textBeforeCursor = line.text.slice(0, pos - line.from);

        // 0. Cursor at the very beginning of a non-empty line
        if (trimmed !== '' && textBeforeCursor.trim() === '') {
          if (currentType === 'character' || currentType === 'scene_heading') {
            const prevLine = line.number > 1 ? state.doc.line(line.number - 1) : null;
            const prevIsEmpty = !prevLine || prevLine.text.trim() === '';

            if (line.number === 1) {
              view.dispatch({
                changes: { from: pos, to: pos, insert: '\n\n' },
                selection: EditorSelection.cursor(pos),
              });
            } else if (prevIsEmpty) {
              view.dispatch({
                changes: { from: pos, to: pos, insert: '\n\n' },
                selection: EditorSelection.cursor(pos + 1),
              });
            } else {
              view.dispatch({
                changes: { from: pos, to: pos, insert: '\n\n\n' },
                selection: EditorSelection.cursor(pos + 1),
              });
            }
            return true;
          }
          return false;
        }

        // 1. Scene Heading -> Convert to uppercase + empty line + Action
        if (currentType === 'scene_heading') {
          const upper = trimmed.toUpperCase();
          const insertText = `${upper}\n\n`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + insertText.length),
          });
          return true;
        }

        // 2. Character (including input with '@' prefix) -> Remove '@', uppercase, and move to Dialogue
        if (currentType === 'character' || trimmed.startsWith('@')) {
          const cleanChar = trimmed.replace(/^@/, '').trim().toUpperCase();
          if (cleanChar === '') {
            return false;
          }
          const insertText = `${cleanChar}\n`;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.from + insertText.length),
          });
          return true;
        }

        // 3. Parenthetical -> Exit parentheses onto a new line in Dialogue
        if (currentType === 'parenthetical') {
          const insertText = `\n`;
          view.dispatch({
            changes: { from: line.to, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.to + 1),
          });
          return true;
        }

        // 4. "Quick dialogue" mode after Dialogue
        if (currentType === 'dialogue') {
          if (trimmed === '') {
            view.dispatch({
              changes: { from: line.from, to: line.to, insert: '\n' },
              selection: EditorSelection.cursor(line.from + 1),
            });
            return true;
          } else if (pos < line.to) {
            view.dispatch({
              changes: { from: pos, to: pos, insert: '\n' },
              selection: EditorSelection.cursor(pos + 1),
            });
            return true;
          } else {
            const insertText = `\n\n@`;
            view.dispatch({
              changes: { from: line.to, to: line.to, insert: insertText },
              selection: EditorSelection.cursor(line.to + insertText.length),
            });
            return true;
          }
        }

        // 5. Transition -> Empty line + new block
        if (currentType === 'transition') {
          const insertText = `\n\n`;
          view.dispatch({
            changes: { from: line.to, to: line.to, insert: insertText },
            selection: EditorSelection.cursor(line.to + 2),
          });
          return true;
        }

        return false;
      },
    },
        {
      key: 'Shift-Enter',
      run: (view) => {
        const state = view.state;
        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const currentType = getCurrentLineType(state, line.number);

        if (currentType === 'dialogue' || currentType === 'parenthetical') {
          if (line.text === '' && currentType === 'dialogue') {
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
            effects: forceDialogueLineEffect.of(line.number + 1),
          });
          return true;
        }

        return false;
      },
    },
  ];
}
