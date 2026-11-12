import joplin from 'api';
import { ContentScriptType, FileSystemItem, SettingItemType, ToolbarButtonLocation } from 'api/types';
import { analyzeFountain } from './fountainParser';
import { generateScreenplayPdf, PdfExportOptions } from './pdfExporter';

const FOUNTAIN_TAG = 'fountain';
const BIBLE_TAG = 'fountain-bible';

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

async function collectNotebookDictionary(folderId: string, excludeNoteId: string, locales: string[]) {
  const characters = new Set<string>();
  const locations = new Set<string>();

  let page = 1;
  while (true) {
    const notesRes = await joplin.data.get(['folders', folderId, 'notes'], {
      fields: ['id', 'title', 'body'],
      page,
    });

    for (const note of notesRes.items) {
      if (note.id === excludeNoteId) continue;

      const isScript = await noteHasTag(note.id, FOUNTAIN_TAG);
      const isBible = await noteHasTag(note.id, BIBLE_TAG);

      if (isScript) {
        const analysis = analyzeFountain(note.body || '', locales);
        analysis.characters.forEach((_, char) => characters.add(char));
        analysis.locations.forEach((loc) => locations.add(loc));
      }

      if (isBible) {
        parseBibleNote(note.body || '', characters, locations);
      }
    }

    if (!notesRes.has_more) break;
    page++;
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
    if (/^##\s+(Characters|Персонажи)/i.test(trimmed)) {
      currentSection = 'chars';
      continue;
    }
    if (/^##\s+(Locations|Локации)/i.test(trimmed)) {
      currentSection = 'locs';
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      currentSection = null;
      continue;
    }

    const itemMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (itemMatch && currentSection) {
      const value = itemMatch[1].replace(/\s*\(.*?\)\s*$/, '').trim().toUpperCase();
      if (value) {
        if (currentSection === 'chars') characters.add(value);
        if (currentSection === 'locs') locations.add(value);
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
        label: 'Автор по умолчанию (для титульного листа PDF)',
      },
      defaultContact: {
        value: '',
        type: SettingItemType.String,
        section: 'fountainArchitect',
        public: true,
        label: 'Контакты по умолчанию (для титульного листа PDF)',
      },
      activeLocales: {
        value: 'en',
        type: SettingItemType.String,
        section: 'fountainArchitect',
        public: true,
        label: 'Языки маркеров сцен (через запятую, например: en)',
      },
    });

    await joplin.contentScripts.register(
      ContentScriptType.CodeMirrorPlugin,
      'fountainCodeMirror',
      './codemirror/fountainPlugin.js'
    );

    const panel = await joplin.views.panels.create('fountainOutlinePanel');
    const fs = require('fs');
    const path = require('path');
    const installDir = await joplin.plugins.installationDir();
    const panelHtml = fs.readFileSync(path.join(installDir, 'panel', 'panel.html'), 'utf8');
    await joplin.views.panels.setHtml(panel, panelHtml);
    await joplin.views.panels.addScript(panel, './panel/panel.js');

    const exportDialog = await joplin.views.dialogs.create('fountainPdfExportDialog');

    const syncCurrentNote = async () => {
      const note = await joplin.workspace.selectedNote();
      if (!note) return;

      const enabled = await noteHasTag(note.id, FOUNTAIN_TAG);
      const localesRaw = (await joplin.settings.value('activeLocales')) as string;
      const locales = localesRaw.split(',').map((s) => s.trim()).filter(Boolean);

      const dictionary = enabled
        ? await collectNotebookDictionary(note.parent_id, note.id, locales)
        : { characters: [], locations: [], locales };

      await joplin.commands.execute('editor.execCommand', {
        name: 'fountain:setState',
        args: [{ enabled, dictionary }],
      });

      if (enabled) {
        await joplin.views.panels.show(panel);
        const analysis = analyzeFountain(note.body || '', locales);
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
      } else {
        await joplin.views.panels.hide(panel);
      }
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
      await syncCurrentNote();
    };

    await joplin.commands.register({
      name: 'fountain.toggleMode',
      label: 'Переключить режим сценария (Fountain)',
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
        await syncCurrentNote();
      } else if (message.type === 'toggleMode') {
        await toggleScreenplayMode();
      } else if (message.type === 'scrollToLine') {
        await joplin.commands.execute('editor.execCommand', {
          name: 'fountain:scrollToLine',
          args: [message.lineNumber],
        });
      }
    });

    // 6. Регистрация модуля экспорта в меню «Файл -> Экспорт -> Fountain PDF»
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
        const today = new Date().toLocaleDateString('ru-RU');

        const title = analysis.metadata['title'] || item.title || 'UNTITLED';
        const credit = analysis.metadata['credit'] || 'Автор сценария';
        const author = analysis.metadata['author'] || defaultAuthor || '';
        const source = analysis.metadata['source'] || '';
        const draftDate = analysis.metadata['draft date'] || today;
        const contact = analysis.metadata['contact'] || defaultContact || '';

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
            <h3>Экспорт сценария в PDF</h3>
            <form name="exportForm">
              <div class="f-dlg-checks">
                <label>
                  <input type="checkbox" name="printTitlePage" checked />
                  <span>Печатать титульный лист</span>
                </label>
                <label>
                  <input type="checkbox" name="numberScenes" checked />
                  <span>Нумеровать сцены по краям</span>
                </label>
                <label>
                  <input type="checkbox" name="includeSynopses" />
                  <span>Показывать синопсисы (=)</span>
                </label>
                <label>
                  <input type="checkbox" name="saveMetadataToNote" checked />
                  <span>Сохранить титул в заметку</span>
                </label>
              </div>

              <div class="f-dlg-section-title">Титульный лист</div>
              <div class="f-dlg-fields">
                <label class="f-dlg-field">
                  <span>Название (Title)</span>
                  <input type="text" name="title" value="${title}" />
                </label>
                <label class="f-dlg-field">
                  <span>Кредит (Credit)</span>
                  <input type="text" name="credit" value="${credit}" />
                </label>
                <label class="f-dlg-field">
                  <span>Автор (Author)</span>
                  <input type="text" name="author" value="${author}" />
                </label>
                <label class="f-dlg-field">
                  <span>Источник (Source)</span>
                  <input type="text" name="source" value="${source}" />
                </label>
                <label class="f-dlg-field">
                  <span>Дата драфта (Draft date)</span>
                  <input type="text" name="draftDate" value="${draftDate}" />
                </label>
                <label class="f-dlg-field">
                  <span>Контакты (Contact)</span>
                  <input type="text" name="contact" value="${contact}" />
                </label>
              </div>
            </form>
          </div>
          `
        );

        await joplin.views.dialogs.setButtons(exportDialog, [
          { id: 'ok', title: 'Экспортировать PDF' },
          { id: 'cancel', title: 'Отмена' },
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

    // 7. Регистрация модуля экспорта в чистый .fountain файл
    await joplin.interop.registerExportModule({
      format: 'fountain',
      description: 'Fountain Screenplay (.fountain)',
      target: FileSystemItem.File,
      isNoteArchive: false,
      fileExtensions: ['fountain'],
      onInit: async () => {},
      onProcessItem: async (_context: any, itemType: number, item: any) => {
        if (itemType !== 1) return; // Только заметки

        const outputPath = _context.destPath;
        if (!outputPath) return;

        // Сохраняем текст заметки в UTF-8 с расширением .fountain
        fs.writeFileSync(outputPath, item.body || '', 'utf8');
      },
      onProcessResource: async () => {},
      onClose: async () => {},
    });

    await joplin.workspace.onNoteSelectionChange(syncCurrentNote);
    await joplin.workspace.onNoteChange(syncCurrentNote);
    await syncCurrentNote();
  },
});
