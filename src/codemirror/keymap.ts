import { KeyBinding } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { analyzeFountain, BlockType } from '../fountainParser';
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';

function getCurrentLineType(docText: string, lineNumber: number): BlockType {
  const analysis = analyzeFountain(docText);
  const found = analysis.lines.find((l) => l.lineNumber === lineNumber);
  return found ? found.type : 'action';
}

export const fountainKeymap: KeyBinding[] = [
  {
    key: 'Tab',
    run: (view) => {
      if (completionStatus(view.state) === 'active') {
        return acceptCompletion(view);
      }

      const state = view.state;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      const docText = state.doc.toString();
      const currentType = getCurrentLineType(docText, line.number);
      const trimmed = line.text.trim();

      // 1. Cyclic switching on an empty line:
      // Empty line -> Character (@) -> Scene Heading (INT. ) -> (EXT. ) -> Empty line
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
        const insertText = 'INT. ';
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: insertText },
          selection: EditorSelection.cursor(line.from + insertText.length),
        });
        return true;
      }

      if (trimmed === 'INT.') {
        const insertText = 'EXT. ';
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: insertText },
          selection: EditorSelection.cursor(line.from + insertText.length),
        });
        return true;
      }

      if (trimmed === 'EXT.') {
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: '' },
          selection: EditorSelection.cursor(line.from),
        });
        return true;
      }

      // 2. From filled Character -> Parenthetical ()
      if (currentType === 'character' || trimmed.startsWith('@')) {
        const cleanChar = trimmed.replace(/^@/, '').toUpperCase();
        const insertText = `${cleanChar}\n()`;
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: insertText },
          selection: EditorSelection.cursor(line.from + cleanChar.length + 2),
        });
        return true;
      }

      // 3. From filled Action -> Transition (CUT TO:)
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

      // 4. From Dialogue -> Parenthetical (add parenthetical on the next line)
      if (currentType === 'dialogue') {
        const insertText = `${line.text}\n()`;
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: insertText },
          selection: EditorSelection.cursor(line.from + line.text.length + 2),
        });
        return true;
      }

      // 5. From Transition -> back to Action
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
      const docText = state.doc.toString();
      const currentType = getCurrentLineType(docText, line.number);
      const trimmed = line.text.trim();

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
        const cleanChar = trimmed.replace(/^@/, '').toUpperCase();
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

      // 4. "Quick dialogue" mode after Dialogue:
      // - If dialogue line is empty (double Enter) -> exit to Action
      // - If dialogue line has text -> create a new Character (empty line + '@')
      if (currentType === 'dialogue') {
        if (trimmed === '') {
          // Exit to Action
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: '\n' },
            selection: EditorSelection.cursor(line.from + 1),
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

      return false; // Standard line break for Action and other blocks
    },
  },
];
