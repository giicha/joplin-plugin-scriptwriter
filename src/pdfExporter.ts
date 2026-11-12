import PDFDocument = require('pdfkit');
import * as fs from 'fs';
import { analyzeFountain } from './fountainParser';

export interface PdfExportOptions {
  printTitlePage: boolean;
  numberScenes: boolean;
  includeSynopses: boolean;
  title: string;
  credit: string;
  author: string;
  source: string;
  draftDate: string;
  contact: string;
}

interface FontSet {
  normal: string;
  bold: string;
  italics: string;
  bolditalics: string;
}

function resolveCyrillicCourierFonts(): FontSet {
  const candidates: FontSet[] = [
    // Windows
    {
      normal: 'C:\\Windows\\Fonts\\cour.ttf',
      bold: 'C:\\Windows\\Fonts\\courbd.ttf',
      italics: 'C:\\Windows\\Fonts\\couri.ttf',
      bolditalics: 'C:\\Windows\\Fonts\\courbi.ttf',
    },
    // macOS
    {
      normal: '/System/Library/Fonts/Supplemental/Courier New.ttf',
      bold: '/System/Library/Fonts/Supplemental/Courier New Bold.ttf',
      italics: '/System/Library/Fonts/Supplemental/Courier New Italic.ttf',
      bolditalics: '/System/Library/Fonts/Supplemental/Courier New Bold Italic.ttf',
    },
    // Linux (Liberation Mono)
    {
      normal: '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
      bold: '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf',
      italics: '/usr/share/fonts/truetype/liberation/LiberationMono-Italic.ttf',
      bolditalics: '/usr/share/fonts/truetype/liberation/LiberationMono-BoldItalic.ttf',
    },
  ];

  for (const set of candidates) {
    if (fs.existsSync(set.normal)) {
      return {
        normal: set.normal,
        bold: fs.existsSync(set.bold) ? set.bold : set.normal,
        italics: fs.existsSync(set.italics) ? set.italics : set.normal,
        bolditalics: fs.existsSync(set.bolditalics) ? set.bolditalics : set.normal,
      };
    }
  }

  throw new Error(
    'Не найден моноширинный шрифт с поддержкой кириллицы (Courier New / Liberation Mono).'
  );
}

export async function generateScreenplayPdf(
  fountainText: string,
  outputPath: string,
  options: PdfExportOptions,
  locales: string[] = ['en']
): Promise<void> {
  const fonts = resolveCyrillicCourierFonts();
  const analysis = analyzeFountain(fountainText, locales);

  // Американский стандарт: Letter (612 x 792 pt), поля: левое 1.5" (108pt), остальные 1" (72pt)
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 72, bottom: 72, left: 108, right: 72 },
    font: fonts.normal,
    bufferPages: true,
    autoFirstPage: true,
  });

  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  doc.registerFont('CourierNormal', fonts.normal);
  doc.registerFont('CourierBold', fonts.bold);
  doc.registerFont('CourierItalic', fonts.italics);

  doc.font('CourierNormal').fontSize(12);

  // 1. Титульный лист
  if (options.printTitlePage) {
    doc.moveDown(10);
    doc
      .font('CourierBold')
      .fontSize(14)
      .text((options.title || 'UNTITLED SCREENPLAY').toUpperCase(), { align: 'center' });

    doc.font('CourierNormal').fontSize(12);
    if (options.credit) {
      doc.moveDown(1.2);
      doc.text(options.credit, { align: 'center' });
    }
    if (options.author) {
      doc.moveDown(0.8);
      doc.text(options.author, { align: 'center' });
    }
    if (options.source) {
      doc.moveDown(1.2);
      doc.text(options.source, { align: 'center' });
    }

    // Нижний блок контактов и даты драфта
    const bottomY = 660;
    if (options.contact) {
      doc.text(options.contact, 108, bottomY, { width: 220, align: 'left' });
    }
    if (options.draftDate) {
      doc.text(options.draftDate, 320, bottomY, { width: 220, align: 'right' });
    }

    doc.addPage();
  }

  // 2. Тело сценария
  // Рабочая ширина текста: 612 - 108 - 72 = 432 pt (ровно 6 дюймов)
  const LEFT_MARGIN = 108;
  const CONTENT_WIDTH = 432;
  const BOTTOM_LIMIT = 720; // 792 - 72

  const ensureSpace = (neededHeight: number) => {
    if (doc.y + neededHeight > BOTTOM_LIMIT) {
      doc.addPage();
    }
  };

  let sceneNum = 0;

  for (const line of analysis.lines) {
    const clean = line.text.trim();

    switch (line.type) {
      case 'metadata':
      case 'section':
      case 'empty':
        break;

      case 'synopsis':
        if (options.includeSynopses) {
          ensureSpace(24);
          doc
            .font('CourierItalic')
            .fillColor('#555555')
            .text(`[[ ${clean.replace(/^=\s*/, '')} ]]`, LEFT_MARGIN, doc.y + 4, {
              width: CONTENT_WIDTH,
            });
          doc.fillColor('#000000').font('CourierNormal');
        }
        break;

      case 'page_break':
        doc.addPage();
        break;

      case 'scene_heading': {
        sceneNum++;
        ensureSpace(42);
        const headingText = clean.replace(/^\./, '').toUpperCase();
        const startY = doc.y + 14;

        doc.font('CourierBold');
        if (options.numberScenes) {
          doc.text(`${sceneNum}.`, 72, startY, { width: 30, align: 'left' });
          doc.text(headingText, LEFT_MARGIN, startY, { width: CONTENT_WIDTH, align: 'left' });
          //doc.text(`${sceneNum}.`, 546, startY, { width: 36, align: 'right' }); 
        } else {
          doc.text(headingText, LEFT_MARGIN, startY, { width: CONTENT_WIDTH, align: 'left' });
        }
        doc.font('CourierNormal');
        doc.y += 6;
        break;
      }

      case 'action': {
        ensureSpace(24);
        doc.font('CourierNormal').text(clean, LEFT_MARGIN, doc.y + 2, {
          width: CONTENT_WIDTH,
          align: 'left',
        });
        doc.y += 6;
        break;
      }

      case 'character': {
        ensureSpace(36); // Не отрываем имя персонажа от реплики внизу страницы
        const charName = clean.replace(/^@/, '').toUpperCase();
        // Отступ персонажа ~3.5" от края страницы = 252 pt
        doc.font('CourierNormal').text(charName, 252, doc.y + 10, {
          width: 240,
          align: 'left',
        });
        break;
      }

      case 'parenthetical': {
        ensureSpace(24);
        // Отступ ремарки ~3.0" от края страницы = 216 pt, ширина ~2.5" (180 pt)
        doc.font('CourierNormal').text(clean, 216, doc.y, {
          width: 180,
          align: 'left',
        });
        break;
      }

      case 'dialogue': {
        ensureSpace(20);
        // Отступ реплики ~2.5" от края страницы = 180 pt, ширина ~3.5" (252 pt)
        doc.font('CourierNormal').text(clean, 180, doc.y, {
          width: 252,
          align: 'left',
        });
        doc.y += 4;
        break;
      }

      case 'transition': {
        ensureSpace(28);
        const transText = clean.replace(/^>\s*/, '').toUpperCase();
        doc.font('CourierNormal').text(transText, LEFT_MARGIN, doc.y + 8, {
          width: CONTENT_WIDTH,
          align: 'right',
        });
        doc.y += 6;
        break;
      }

      case 'centered': {
        ensureSpace(24);
        const centerText = clean.replace(/^>\s*|\s*<$/g, '');
        doc.font('CourierNormal').text(centerText, LEFT_MARGIN, doc.y + 6, {
          width: CONTENT_WIDTH,
          align: 'center',
        });
        doc.y += 6;
        break;
      }
    }
  }

  // 3. Нумерация страниц в правом верхнем углу (со 2-й страницы текста сценария)
  const pageRange = doc.bufferedPageRange();
  const skipPages = options.printTitlePage ? 2 : 1;

  for (let i = skipPages; i < pageRange.count; i++) {
    doc.switchToPage(i);
    const displayNum = options.printTitlePage ? i : i + 1;
    doc
      .font('CourierNormal')
      .fontSize(12)
      .text(`${displayNum}.`, 468, 36, { width: 72, align: 'right' });
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}
