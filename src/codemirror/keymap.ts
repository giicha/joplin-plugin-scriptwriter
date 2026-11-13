import { KeyBinding } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { analyzeFountain, BlockType } from '../fountainParser';
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { getActiveLocaleConfig } from '../locales';
import { ExternalDictionary } from './autocomplete';

function getCurrentLineType(docText: string, lineNumber: number, locales: string[]): BlockType {
  const analysis = analyzeFountain(docText, locales);
  const found = analysis.lines.find((l) => l.lineNumber === lineNumber);
  return found ? found.type : 'action';
}

export function createFountainKeymap(getExternalDict: () => ExternalDictionary): KeyBinding[] {
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
        const docText = state.doc.toString();
        const extDict = getExternalDict();
        const locales = extDict.locales || ['en'];
        const localeCfg = getActiveLocaleConfig(locales);

        const currentType = getCurrentLineType(docText, line.number, locales);
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
        const docText = state.doc.toString();
        const locales = getExternalDict().locales || ['en'];
        const currentType = getCurrentLineType(docText, line.number, locales);
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

        return false;
      },
    },
  ];
}
