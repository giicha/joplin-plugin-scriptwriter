import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { analyzeFountain, ScreenplayAnalysis } from '../fountainParser';

export interface ExternalDictionary {
  characters: string[];
  locations: string[];
  locales: string[];
}

export interface FountainEditorState {
  enabled: boolean;
  dictionary: ExternalDictionary;
  analysis: ScreenplayAnalysis;
  forcedDialogueLine: number | null;
  suggestedCharacter: string | null;
}

const EMPTY_ANALYSIS: ScreenplayAnalysis = {
  lines: [],
  metadata: {},
  characters: new Map(),
  characterExtensions: new Set(),
  locations: new Map(),
  outline: [],
  estimatedPages: 1,
  estimatedMinutes: 1,
};

export const setFountainStateEffect = StateEffect.define<{
  enabled: boolean;
  dictionary?: ExternalDictionary;
}>();

export const forceDialogueLineEffect = StateEffect.define<number | null>();
export const setSuggestedCharacterEffect = StateEffect.define<string | null>();

export const fountainStateField = StateField.define<FountainEditorState>({
  create(_state: EditorState): FountainEditorState {
    return {
      enabled: false,
      dictionary: { characters: [], locations: [], locales: ['en'] },
      analysis: EMPTY_ANALYSIS,
      forcedDialogueLine: null,
      suggestedCharacter: null,
    };
  },

  update(value: FountainEditorState, tr): FountainEditorState {
    let { enabled, dictionary, analysis, forcedDialogueLine, suggestedCharacter } = value;
    let shouldReanalyze = false;

    if (tr.docChanged || tr.selection) {
      forcedDialogueLine = null;
      suggestedCharacter = null;
    }

    for (const effect of tr.effects) {
      if (effect.is(setFountainStateEffect)) {
        enabled = effect.value.enabled;
        if (effect.value.dictionary) {
          dictionary = effect.value.dictionary;
        }
        shouldReanalyze = true;
      }
      if (effect.is(forceDialogueLineEffect)) {
        forcedDialogueLine = effect.value;
      }
      if (effect.is(setSuggestedCharacterEffect)) {
        suggestedCharacter = effect.value;
      }
    }

    if (tr.docChanged && enabled) {
      shouldReanalyze = true;
    }

    if (shouldReanalyze) {
      analysis = enabled
        ? analyzeFountain(tr.newDoc.toString(), dictionary.locales)
        : EMPTY_ANALYSIS;
    }

    return { enabled, dictionary, analysis, forcedDialogueLine, suggestedCharacter };
  },
});
