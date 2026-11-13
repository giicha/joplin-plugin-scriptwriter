import joplin from 'api';
import { ContentScriptType, FileSystemItem, SettingItemType, ToolbarButtonLocation } from 'api/types';
import { analyzeFountain } from './fountainParser';
import { generateScreenplayPdf, PdfExportOptions } from './pdfExporter';

const FOUNTAIN_TAG = 'fountain';
const BIBLE_TAG = 'fountain-bible';

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function getOrCreateTagId(tagTitle: string): Promise<string> {
  let page = 1;
  while (true) {
    const res = await joplin.data.get(['tags'], { page });
    const found = res.items.find((t: any) => t.title.toLowerCase() === tagTitle.toLowerCase());
    if (found) return found.id;
    if (!res.has_more) break;
    page++;
  }
  const created = await joplin.data.post(['tags'], null, { title: tagTitle });
  return created.id;
}

async function noteHasTag(noteId: string, tagTitle: string): Promise<boolean> {
  const tags = await joplin.data.get(['notes', noteId, 'tags']);
  return tags.items.some((t: any) => t.title.toLowerCase() === tagTitle.toLowerCase());
}

async function getNotesByTag(tagTitle: string): Promise<any[]> {
  let page = 1;
  let tagId: string | null = null;

  while (true) {
    const res = await joplin.data.get(['tags'], { page });
    const found = res.items.find((t: any) => t.title.toLowerCase() === tagTitle.toLowerCase());
    if (found) {
      tagId = found.id;
      break;
    }
    if (!res.has_more) break;
    page++;
  }

  if (!tagId) return [];

  const result: any[] = [];
  page = 1;
  while (true) {
    const notesRes = await joplin.data.get(['tags', tagId, 'notes'], {
      fields: ['id', 'parent_id', 'title', 'body'],
      page,
    });
    result.push(...notesRes.items);
    if (!notesRes.has_more) break;
    page++;
  }
  return result;
}

async function collectNotebookDictionary(folderId: string, excludeNoteId: string, locales: string[]) {
  const characters = new Set<string>();
  const locations = new Set<string>();

  const scriptNotes = await getNotesByTag(FOUNTAIN_TAG);
  for (const stub of scriptNotes) {
    if (stub.id === excludeNoteId) continue;
    const note = await joplin.data.get(['notes', stub.id], {
      fields: ['id', 'parent_id', 'body'],
    });
    if (note.parent_id !== folderId) continue;

    const analysis = analyzeFountain(note.body || '', locales);
    analysis.characters.forEach((_, char) => characters.add(char));
    analysis.locations.forEach((loc) => locations.add(loc));
  }

  const bibleNotes = await getNotesByTag(BIBLE_TAG);
  for (const stub of bibleNotes) {
    if (stub.id === excludeNoteId) continue;
    const note = await joplin.data.get(['notes', stub.id], {
      fields: ['id', 'parent_id', 'body'],
    });
    if (note.parent_id !== folderId) continue;

    parseBibleNote(note.body || '', characters, locations);
  }

  return {
    characters: Array.from(characters),
    locations: Array.from(locations),
    locales,
  };
}

function parseBibleNote(body: string, characters: Set<string>, locations: Set<string>) {
  const lines = body.split(/\r?\n/);
  let currentSection: 'chars' | 'locs' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Определяем заголовок секции (# Characters, ## Characters, ### Персонажи и т.д.)
    if (/^#{1,6}\s*(Characters|Персонажи)\b/i.test(trimmed)) {
      currentSection = 'chars';
      continue;
    }
    if (/^#{1,6}\s*(Locations|Локации)\b/i.test(trimmed)) {
      currentSection = 'locs';
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      currentSection = null;
      continue;
    }

    // Если мы внутри секции — принимаем пункты списка (-, *, +, 1.) или обычные строки
    if (currentSection) {
      const cleaned = trimmed
        .replace(/^([-*+]|\d+\.)\s+/, '') // убираем маркер списка, если он есть
        .replace(/\s*\(.*?\)\s*$/, '')    // убираем пояснение в скобках в конце
        .trim()
        .toUpperCase();

      if (cleaned) {
        if (currentSection === 'chars') characters.add(cleaned);
        if (currentSection === 'locs') locations.add(cleaned);
      }
    }
  }
}

function upsertFountainMetadata(body: string, meta: PdfExportOptions): string {
  const lines = body.split(/\r?\n/);
  let metaEndIndex = 0;

  while (metaEndIndex < lines.length) {
    const trimmed = lines[metaEndIndex].trim();
    if (trimmed === '') {
      metaEndIndex++;
      break;
    }
    if (/^[A-Za-zА-Яа-я\s]+:\s*/.test(lines[metaEndIndex]) && metaEndIndex < 20) {
      metaEndIndex++;
    } else {
      metaEndIndex = 0;
      break;
    }
  }

  const newHeader: string[] = [];
  if (meta.title) newHeader.push(`Title: ${meta.title}`);
  if (meta.credit) newHeader.push(`Credit: ${meta.credit}`);
  if (meta.author) newHeader.push(`Author: ${meta.author}`);
  if (meta.source) newHeader.push(`Source: ${meta.source}`);
  if (meta.draftDate) newHeader.push(`Draft date: ${meta.draftDate}`);
  if (meta.contact) newHeader.push(`Contact: ${meta.contact}`);

  const restBody = lines.slice(metaEndIndex).join('\n');
  return newHeader.length > 0 ? `${newHeader.join('\n')}\n\n${restBody}` : restBody;
}

joplin.plugins.register({
  onStart: async function () {
    await joplin.settings.registerSection('fountainArchitect', {
      label: 'Fountain Screenplay',
      iconName: 'fas fa-film',
    });

    await joplin.settings.registerSettings({
      defaultAuthor: {
        value: '',
        type: SettingItemType.String,
        section: 'fountainArchitect',
        public: true,
        label: 'Default Author (for PDF title page)',
      },
      defaultContact: {
        value: '',
        type: SettingItemType.String,
        section: 'fountainArchitect',
        public: true,
        label: 'Default Contact Info (for PDF title page)',
      },
      activeLocales: {
        value: 'en',
        type: SettingItemType.String,
        section: 'fountainArchitect',
        public: true,
        label: 'Scene marker languages (comma-separated: en, fr, es, it, de, ru, uk)',
      },
    });

    await joplin.contentScripts.register(
      ContentScriptType.CodeMirrorPlugin,
      'fountainCodeMirror',
      './codemirror/fountainPlugin.js'
    );

    await joplin.contentScripts.onMessage('fountainCodeMirror', async (message: any) => {
      if (message && message.type === 'requestState') {
        const note = await joplin.workspace.selectedNote();
        if (!note) return { enabled: false };
        const enabled = await noteHasTag(note.id, FOUNTAIN_TAG);
        const localesRaw = (await joplin.settings.value('activeLocales')) as string;
        const locales = localesRaw.split(',').map((s) => s.trim()).filter(Boolean);
        const dictionary = enabled
          ? await collectNotebookDictionary(note.parent_id, note.id, locales)
          : { characters: [], locations: [], locales };
        return { enabled, dictionary };
      }
    });

    const panel = await joplin.views.panels.create('fountainOutlinePanel');
    const fs = require('fs');
    const path = require('path');
    const installDir = await joplin.plugins.installationDir();
    const panelHtml = fs.readFileSync(path.join(installDir, 'panel', 'panel.html'), 'utf8');
    await joplin.views.panels.setHtml(panel, panelHtml);
    await joplin.views.panels.addScript(panel, './panel/panel.js');

    const exportDialog = await joplin.views.dialogs.create('fountainPdfExportDialog');

    // Cache active note state to avoid redundant API calls on every auto-save
    let activeNoteId: string | null = null;
    let isActiveNoteFountain = false;

    const updateSidePanel = async (noteBody: string, locales: string[]) => {
      const analysis = analyzeFountain(noteBody, locales);
      await joplin.views.panels.postMessage(panel, {
        type: 'update',
        payload: {
          enabled: true,
          estimatedPages: analysis.estimatedPages,
          estimatedMinutes: analysis.estimatedMinutes,
          outline: analysis.outline,
          characters: Array.from(analysis.characters.entries()),
          locations: Array.from(analysis.locations),
        },
      });
    };

    // Full sync (called on note switch or mode toggle)
    const syncFullNoteState = async () => {
      const note = await joplin.workspace.selectedNote();
      if (!note) return;

      activeNoteId = note.id;
      const enabled = await noteHasTag(note.id, FOUNTAIN_TAG);
      isActiveNoteFountain = enabled;

      const localesRaw = (await joplin.settings.value('activeLocales')) as string;
      const locales = localesRaw.split(',').map((s) => s.trim()).filter(Boolean);

      const dictionary = enabled
        ? await collectNotebookDictionary(note.parent_id, note.id, locales)
        : { characters: [], locations: [], locales };

      // Send state to CodeMirror so the editor instance updates on note switch
      try {
        await joplin.commands.execute('editor.execCommand', {
          name: 'fountain:setState',
          args: [{ enabled, dictionary }],
        });
      } catch (_e) {
        // Ignore if editor is currently re-mounting
      }

      if (enabled) {
        await joplin.views.panels.show(panel);
        await updateSidePanel(note.body || '', locales);
      } else {
        await joplin.views.panels.hide(panel);
      }
    };

    // Fast sync on text edit (skips querying notebook notes and tags)
    const syncPanelOnEdit = async () => {
      const note = await joplin.workspace.selectedNote();
      if (!note) return;

      if (note.id !== activeNoteId) {
        await syncFullNoteState();
        return;
      }

      const enabled = await noteHasTag(note.id, FOUNTAIN_TAG);
      if (enabled !== isActiveNoteFountain) {
        await syncFullNoteState();
        return;
      }

      if (!enabled) return;

      const localesRaw = (await joplin.settings.value('activeLocales')) as string;
      const locales = localesRaw.split(',').map((s) => s.trim()).filter(Boolean);
      await updateSidePanel(note.body || '', locales);
    };

    const toggleScreenplayMode = async () => {
      const note = await joplin.workspace.selectedNote();
      if (!note) return;

      const tagId = await getOrCreateTagId(FOUNTAIN_TAG);
      const hasTag = await noteHasTag(note.id, FOUNTAIN_TAG);

      if (hasTag) {
        await joplin.data.delete(['tags', tagId, 'notes', note.id]);
      } else {
        await joplin.data.post(['tags', tagId, 'notes'], null, { id: note.id });
      }
      await syncFullNoteState();
    };

    await joplin.commands.register({
      name: 'fountain.toggleMode',
      label: 'Toggle Screenplay Mode (Fountain)',
      iconName: 'fas fa-film',
      execute: toggleScreenplayMode,
    });

    await joplin.views.toolbarButtons.create(
      'fountainToggleBtn',
      'fountain.toggleMode',
      ToolbarButtonLocation.EditorToolbar
    );

    await joplin.views.panels.onMessage(panel, async (message: any) => {
      if (message.type === 'ready') {
        await syncFullNoteState();
      } else if (message.type === 'toggleMode') {
        await toggleScreenplayMode();
      } else if (message.type === 'scrollToLine') {
        await joplin.commands.execute('editor.execCommand', {
          name: 'fountain:scrollToLine',
          args: [message.lineNumber],
        });
      }
    });

    // 6. Register export module in menu "Note -> Export -> Fountain Screenplay (PDF)"
    await joplin.interop.registerExportModule({
      format: 'fountain_pdf',
      description: 'Fountain Screenplay (PDF)',
      target: FileSystemItem.File,
      isNoteArchive: false,
      fileExtensions: ['pdf'],
      onInit: async () => {},
      onProcessItem: async (_context: any, itemType: number, item: any) => {
        if (itemType !== 1) return;

        const localesRaw = (await joplin.settings.value('activeLocales')) as string;
        const locales = localesRaw.split(',').map((s) => s.trim()).filter(Boolean);
        const analysis = analyzeFountain(item.body || '', locales);

        const defaultAuthor = (await joplin.settings.value('defaultAuthor')) as string;
        const defaultContact = (await joplin.settings.value('defaultContact')) as string;
        const today = new Date().toLocaleDateString('en-US');

        const title = escapeHtml(analysis.metadata['title'] || item.title || 'UNTITLED');
        const credit = escapeHtml(analysis.metadata['credit'] || 'Written by');
        const author = escapeHtml(analysis.metadata['author'] || defaultAuthor || '');
        const source = escapeHtml(analysis.metadata['source'] || '');
        const draftDate = escapeHtml(analysis.metadata['draft date'] || today);
        const contact = escapeHtml(analysis.metadata['contact'] || defaultContact || '');

        await joplin.views.dialogs.setHtml(
          exportDialog,
          `
          <style>
            * {
              box-sizing: border-box;
            }
            .f-dlg {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              width: 100%;
              padding: 4px 2px;
              color: var(--joplin-color, #222);
            }
            .f-dlg h3 {
              margin: 0 0 12px 0;
              font-size: 16px;
              font-weight: 600;
              border-bottom: 1px solid var(--joplin-divider-color, #e2e8f0);
              padding-bottom: 8px;
            }
            .f-dlg-checks {
              display: flex;
              flex-direction: column;
              gap: 8px;
              margin-bottom: 14px;
              font-size: 13px;
            }
            .f-dlg-checks label {
              display: flex;
              align-items: center;
              gap: 8px;
              cursor: pointer;
              margin: 0;
            }
            .f-dlg-checks input[type="checkbox"] {
              margin: 0;
              width: 15px;
              height: 15px;
              flex-shrink: 0;
            }
            .f-dlg-section-title {
              font-size: 11px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              opacity: 0.65;
              margin: 12px 0 8px 0;
              border-top: 1px solid var(--joplin-divider-color, #e2e8f0);
              padding-top: 10px;
            }
            .f-dlg-fields {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .f-dlg-field {
              display: flex;
              flex-direction: column;
              gap: 3px;
              font-size: 12px;
            }
            .f-dlg-field span {
              opacity: 0.85;
            }
            .f-dlg-field input {
              width: 100%;
              min-width: 0;
              padding: 6px 8px;
              border: 1px solid var(--joplin-divider-color, #cbd5e0);
              border-radius: 4px;
              background: var(--joplin-background-color, #fff);
              color: var(--joplin-color, #222);
              font-size: 13px;
            }
            .f-dlg-field input:focus {
              outline: none;
              border-color: #3182ce;
            }
          </style>
          <div class="f-dlg">
            <h3>Export Screenplay to PDF</h3>
            <form name="exportForm">
              <div class="f-dlg-checks">
                <label>
                  <input type="checkbox" name="printTitlePage" checked />
                  <span>Print title page</span>
                </label>
                <label>
                  <input type="checkbox" name="numberScenes" checked />
                  <span>Number scenes</span>
                </label>
                <label>
                  <input type="checkbox" name="includeSynopses" />
                  <span>Include synopses (=)</span>
                </label>
                <label>
                  <input type="checkbox" name="saveMetadataToNote" checked />
                  <span>Save title metadata to note</span>
                </label>
              </div>

              <div class="f-dlg-section-title">Title Page</div>
              <div class="f-dlg-fields">
                <label class="f-dlg-field">
                  <span>Title</span>
                  <input type="text" name="title" value="${title}" />
                </label>
                <label class="f-dlg-field">
                  <span>Credit</span>
                  <input type="text" name="credit" value="${credit}" />
                </label>
                <label class="f-dlg-field">
                  <span>Author</span>
                  <input type="text" name="author" value="${author}" />
                </label>
                <label class="f-dlg-field">
                  <span>Source</span>
                  <input type="text" name="source" value="${source}" />
                </label>
                <label class="f-dlg-field">
                  <span>Draft date</span>
                  <input type="text" name="draftDate" value="${draftDate}" />
                </label>
                <label class="f-dlg-field">
                  <span>Contact</span>
                  <input type="text" name="contact" value="${contact}" />
                </label>
              </div>
            </form>
          </div>
          `
        );

        await joplin.views.dialogs.setButtons(exportDialog, [
          { id: 'ok', title: 'Export PDF' },
          { id: 'cancel', title: 'Cancel' },
        ]);

        const result = await joplin.views.dialogs.open(exportDialog);
        if (result.id !== 'ok') return;

        const form = result.formData?.exportForm || {};
        const exportOpts: PdfExportOptions = {
          printTitlePage: form.printTitlePage === 'on',
          numberScenes: form.numberScenes === 'on',
          includeSynopses: form.includeSynopses === 'on',
          title: form.title || title,
          credit: form.credit || '',
          author: form.author || '',
          source: form.source || '',
          draftDate: form.draftDate || '',
          contact: form.contact || '',
        };

        let bodyToExport = item.body || '';
        if (form.saveMetadataToNote === 'on') {
          bodyToExport = upsertFountainMetadata(bodyToExport, exportOpts);
          await joplin.data.put(['notes', item.id], null, { body: bodyToExport });
        }

        const outputPath = _context.destPath;
        await generateScreenplayPdf(bodyToExport, outputPath, exportOpts, locales);
      },
      onProcessResource: async () => {},
      onClose: async () => {},
    });

    // 7. Register export module for plain .fountain files
    await joplin.interop.registerExportModule({
      format: 'fountain',
      description: 'Fountain Screenplay (.fountain)',
      target: FileSystemItem.File,
      isNoteArchive: false,
      fileExtensions: ['fountain'],
      onInit: async () => {},
      onProcessItem: async (_context: any, itemType: number, item: any) => {
        if (itemType !== 1) return; // Notes only

        const outputPath = _context.destPath;
        if (!outputPath) return;

        // Save note text in UTF-8 with .fountain extension
        fs.writeFileSync(outputPath, item.body || '', 'utf8');
      },
      onProcessResource: async () => {},
      onClose: async () => {},
    });

    await joplin.workspace.onNoteSelectionChange(syncFullNoteState);
    await joplin.workspace.onNoteChange(syncPanelOnEdit);
    await syncFullNoteState();
  },
});
