import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
} from '@codemirror/view';
import { Prec, RangeSetBuilder, StateEffect } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';
import { analyzeFountain, BlockType } from '../fountainParser';
import { fountainKeymap } from './keymap';
import { createFountainCompleter, ExternalDictionary } from './autocomplete';

const LINE_CLASSES: Partial<Record<BlockType, string>> = {
  scene_heading: 'cm-fountain-scene',
  character: 'cm-fountain-character',
  parenthetical: 'cm-fountain-parenthetical',
  dialogue: 'cm-fountain-dialogue',
  transition: 'cm-fountain-transition',
  centered: 'cm-fountain-centered',
  section: 'cm-fountain-section',
  synopsis: 'cm-fountain-synopsis',
  metadata: 'cm-fountain-metadata',
};

let isFountainEnabled = false;
let externalDict: ExternalDictionary = {
  characters: [],
  locations: [],
  locales: ['en'],
};

// Special effect to force recalculation of decorations when mode or note changes
const refreshFountainEffect = StateEffect.define<boolean>();

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!isFountainEnabled) return builder.finish();

  const text = view.state.doc.toString();
  const analysis = analyzeFountain(text, externalDict.locales);

  for (const parsed of analysis.lines) {
    const cssClass = LINE_CLASSES[parsed.type];
    if (cssClass && parsed.lineNumber <= view.state.doc.lines) {
      const lineInfo = view.state.doc.line(parsed.lineNumber);
      builder.add(
        lineInfo.from,
        lineInfo.from,
        Decoration.line({ attributes: { class: cssClass } })
      );
    }
  }

  return builder.finish();
}

const fountainViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
      this.syncRootClass(view);
    }
    update(update: ViewUpdate) {
      this.syncRootClass(update.view);
      const hasRefreshEffect = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(refreshFountainEffect))
      );
      if (update.docChanged || update.viewportChanged || hasRefreshEffect) {
        this.decorations = buildDecorations(update.view);
      }
    }
    syncRootClass(view: EditorView) {
      if (isFountainEnabled) {
        view.dom.classList.add('cm-fountain-active');
      } else {
        view.dom.classList.remove('cm-fountain-active');
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

export default function (context: { contentScriptId: string; postMessage: (msg: any) => Promise<any> }) {
  return {
    plugin: (editorControl: any) => {
      const applyState = (payload: any) => {
        if (!payload) return;
        isFountainEnabled = !!payload.enabled;
        if (payload.dictionary) {
          externalDict = payload.dictionary;
        }
        if (editorControl.editor) {
          editorControl.editor.dispatch({
            effects: refreshFountainEffect.of(isFountainEnabled),
          });
        }
      };

      if (editorControl.registerCommand) {
        editorControl.registerCommand('fountain:setState', (payload: any) => {
          applyState(payload);
        });

        editorControl.registerCommand('fountain:scrollToLine', (lineNumber: number) => {
          const view: EditorView = editorControl.editor;
          if (lineNumber >= 1 && lineNumber <= view.state.doc.lines) {
            const line = view.state.doc.line(lineNumber);
            view.dispatch({
              selection: { anchor: line.from },
              effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
            });
            view.focus();
          }
        });
      }

      editorControl.addExtension([
        fountainViewPlugin,
        Prec.highest(
          keymap.of(
            fountainKeymap.map((binding) => ({
              ...binding,
              run: (view) => (isFountainEnabled ? binding.run!(view) : false),
            }))
          )
        ),
        autocompletion({
          override: [
            (ctx) =>
              isFountainEnabled ? createFountainCompleter(() => externalDict)(ctx) : null,
          ],
        }),
      ]);

      context.postMessage({ type: 'requestState' }).then((state) => {
        applyState(state);
      }).catch(() => {});
    },
    assets: () => [{ name: 'fountain.css' }],
  };
}
