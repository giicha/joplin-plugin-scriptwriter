import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
} from '@codemirror/view';
import { Prec, RangeSetBuilder } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';
import { BlockType } from '../fountainParser';
import { createFountainKeymap } from './keymap';
import { createFountainCompleter } from './autocomplete';
import { fountainStateField, setFountainStateEffect } from './fountainState';

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

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { enabled, analysis, forcedDialogueLine } = view.state.field(fountainStateField);
  if (!enabled) return builder.finish();

  for (const parsed of analysis.lines) {
    const effectiveType =
      parsed.lineNumber === forcedDialogueLine ? 'dialogue' : parsed.type;
    const cssClass = LINE_CLASSES[effectiveType];
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
      const prevFountain = update.startState.field(fountainStateField);
      const currFountain = update.state.field(fountainStateField);

      if (
        update.viewportChanged ||
        prevFountain.analysis !== currFountain.analysis ||
        prevFountain.enabled !== currFountain.enabled ||
        prevFountain.forcedDialogueLine !== currFountain.forcedDialogueLine
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }

    syncRootClass(view: EditorView) {
      const { enabled } = view.state.field(fountainStateField);
      if (enabled) {
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
        if (!payload || !editorControl.editor) return;
        editorControl.editor.dispatch({
          effects: setFountainStateEffect.of({
            enabled: !!payload.enabled,
            dictionary: payload.dictionary,
          }),
        });
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
        fountainStateField,
        fountainViewPlugin,
        Prec.highest(
          keymap.of(
            createFountainKeymap().map((binding) => ({
              ...binding,
              run: (view) =>
                view.state.field(fountainStateField).enabled ? binding.run!(view) : false,
            }))
          )
        ),
        autocompletion({
          override: [
            (ctx) =>
              ctx.state.field(fountainStateField).enabled ? createFountainCompleter(ctx) : null,
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
