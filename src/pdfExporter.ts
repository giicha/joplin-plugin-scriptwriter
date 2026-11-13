import PDFDocument = require('pdfkit');
import * as fs from 'fs';
import { analyzeFountain } from './fountainParser';

export interface PdfExportOptions {
  paperSize: 'LETTER' | 'A4'; 
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

// Helper to render text with **bold**, *italic*, and _underline_ in PDFKit
function renderFormattedText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions,
  fonts: FontSet
) {
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  const parts = text.split(tokenRegex).filter(Boolean);

  if (parts.length <= 1 && !tokenRegex.test(text)) {
    doc.font(fonts.normal).text(text, x, y, options);
    return;
  }

  doc.x = x;
  doc.y = y;

  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx];
    const isLast = idx === parts.length - 1;
    let fontToUse = fonts.normal;
    let cleanPart = part;
    let underline = false;

    if (part.startsWith('**') && part.endsWith('**')) {
      fontToUse = fonts.bold;
      cleanPart = part.slice(2, -2);
    } else if (part.startsWith('*') && part.endsWith('*')) {
      fontToUse = fonts.italics;
      cleanPart = part.slice(1, -1);
    } else if (part.startsWith('_') && part.endsWith('_')) {
      underline = true;
      cleanPart = part.slice(1, -1);
    }

    doc.font(fontToUse).text(cleanPart, {
      ...options,
      continued: !isLast,
      underline,
    });
  }
}

export async function generateScreenplayPdf(
  fountainText: string,
  outputPath: string,
  options: PdfExportOptions,
  locales: string[] = ['en']
): Promise<void> {
  const fonts = resolveCyrillicCourierFonts();
  const analysis = analyzeFountain(fountainText, locales);

  const isA4 = options.paperSize === 'A4';
  const PAGE_WIDTH = isA4 ? 595.28 : 612;
  const PAGE_HEIGHT = isA4 ? 841.89 : 792;
  const LEFT_MARGIN = 108; // 1.5"
  const RIGHT_MARGIN = 72; // 1"
  const TOP_MARGIN = 72; // 1"
  const BOTTOM_MARGIN = 72; // 1"
  const CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN; // 415.28 pt for A4, 432 pt for Letter
  const BOTTOM_LIMIT = PAGE_HEIGHT - BOTTOM_MARGIN; // 769.89 pt for A4, 720 pt for Letter

  const doc = new PDFDocument({
    size: isA4 ? 'A4' : 'LETTER',
    margins: { top: TOP_MARGIN, bottom: BOTTOM_MARGIN, left: LEFT_MARGIN, right: RIGHT_MARGIN },
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

  // 1. Title Page
  if (options.printTitlePage) {
    doc.moveDown(isA4 ? 11 : 10);
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

    // Bottom contact & draft date block
    const bottomY = PAGE_HEIGHT - 132;
    if (options.contact) {
      doc.text(options.contact, LEFT_MARGIN, bottomY, { width: CONTENT_WIDTH / 2, align: 'left' });
    }
    if (options.draftDate) {
      doc.text(options.draftDate, LEFT_MARGIN + CONTENT_WIDTH / 2, bottomY, {
        width: CONTENT_WIDTH / 2,
        align: 'right',
      });
    }

    doc.addPage();
  }

  // 2. Screenplay Body
  const ensureSpace = (neededHeight: number) => {
    if (doc.y + neededHeight > BOTTOM_LIMIT) {
      doc.addPage();
    }
  };

  let sceneNum = 0;

  // Helper function to print a single dialogue block (character + parentheticals + text) in a given column
  const renderDialogueBlock = (
    startIdx: number,
    colX: number,
    charOffsetX: number,
    parenOffsetX: number,
    colWidth: number
  ): { nextIdx: number; endY: number } => {
    const charLine = analysis.lines[startIdx];
    doc
      .font(fonts.bold)
      .fontSize(12)
      .text(charLine.cleanText.toUpperCase(), colX + charOffsetX, doc.y, {
        width: colWidth - charOffsetX,
      });

    let j = startIdx + 1;
    while (j < analysis.lines.length) {
      const item = analysis.lines[j];
      if (item.type === 'boneyard') {
        j++;
        continue;
      }
      if (item.type === 'parenthetical') {
        renderFormattedText(
          doc,
          item.cleanText,
          colX + parenOffsetX,
          doc.y,
          { width: colWidth - parenOffsetX },
          fonts
        );
        j++;
      } else if (item.type === 'dialogue') {
        if (item.cleanText !== '') {
          renderFormattedText(
            doc,
            item.cleanText,
            colX,
            doc.y,
            { width: colWidth },
            fonts
          );
        }
        j++;
      } else {
        break;
      }
    }
    return { nextIdx: j, endY: doc.y };
  };

  // Main loop over screenplay lines
  let i = 0;
  while (i < analysis.lines.length) {
    const p = analysis.lines[i];

    // 1. Skip comments /* ... */ and [[ ... ]]
    if (p.type === 'boneyard' || p.type === 'metadata' || p.type === 'section') {
      i++;
      continue;
    }

    if (p.type === 'empty') {
      i++;
      continue;
    }

    if (p.type === 'page_break') {
      doc.addPage();
      i++;
      continue;
    }

    // 2. Synopsis (if enabled in export settings)
    if (p.type === 'synopsis') {
      if (options.includeSynopses && p.cleanText) {
        ensureSpace(24);
        doc
          .font(fonts.italics)
          .fontSize(11)
          .fillColor('#555555')
          .text(`[[ ${p.cleanText} ]]`, 108, doc.y + 4, { width: 432 })
          .fillColor('#000000');
        doc.y += 4;
      }
      i++;
      continue;
    }

    // 3. Scene heading
    if (p.type === 'scene_heading') {
      ensureSpace(40);
      sceneNum++;
      const startY = doc.y + 14;
      if (options.numberScenes) {
        doc.font(fonts.bold).fontSize(12).text(`${sceneNum}`, 72, startY, { width: 30 });
      }
      doc
        .font(fonts.bold)
        .fontSize(12)
        .text(p.cleanText.toUpperCase(), 108, startY, { width: 432 });
      doc.y += 6;
      i++;
      continue;
    }

    // 4. Dialogue block (single or dual dialogue with '^')
    if (p.type === 'character') {
      ensureSpace(42);
      doc.y += 10;

      // Check if a second character with isDualDialogue ('^') follows
      let probeIdx = i + 1;
      while (
        probeIdx < analysis.lines.length &&
        (analysis.lines[probeIdx].type === 'dialogue' ||
          analysis.lines[probeIdx].type === 'parenthetical' ||
          analysis.lines[probeIdx].type === 'empty' ||
          analysis.lines[probeIdx].type === 'boneyard')
      ) {
        probeIdx++;
      }
      const nextBlock = analysis.lines[probeIdx];
      const hasDualRight = nextBlock && nextBlock.type === 'character' && nextBlock.isDualDialogue;

      if (hasDualRight) {
        const dualStartY = doc.y;
        const colGap = 20;
        const dualColWidth = (CONTENT_WIDTH - colGap) / 2;

        // Left column
        const leftRes = renderDialogueBlock(i, LEFT_MARGIN, 40, 20, dualColWidth);
        const leftEndY = leftRes.endY;

        // Right column at the same dualStartY height
        doc.y = dualStartY;
        const rightRes = renderDialogueBlock(
          probeIdx,
          LEFT_MARGIN + dualColWidth + colGap,
          40,
          20,
          dualColWidth
        );
        const rightEndY = rightRes.endY;

        doc.y = Math.max(leftEndY, rightEndY) + 6;
        i = rightRes.nextIdx;
      } else {
        // Standard single centered dialogue
        const singleRes = renderDialogueBlock(i, 180, 72, 36, CONTENT_WIDTH - 72);
        doc.y = singleRes.endY + 4;
        i = singleRes.nextIdx;
      }
      continue;
    }

    // 5. Transition (CUT TO:)
    if (p.type === 'transition') {
      ensureSpace(28);
      doc
        .font(fonts.bold)
        .fontSize(12)
        .text(p.cleanText.toUpperCase(), 108, doc.y + 8, { width: 432, align: 'right' });
      doc.y += 4;
      i++;
      continue;
    }

    // 6. Centered text (> TEXT <)
    if (p.type === 'centered') {
      ensureSpace(24);
      renderFormattedText(
        doc,
        p.cleanText,
        108,
        doc.y + 4,
        { width: 432, align: 'center' },
        fonts
      );
      doc.y += 4;
      i++;
      continue;
    }

    // 7. Action description (including forced action with '!')
    if (p.type === 'action' && p.cleanText !== '') {
      ensureSpace(24);
      renderFormattedText(
        doc,
        p.cleanText,
        108,
        doc.y + 6,
        { width: 432 },
        fonts
      );
      doc.y += 4;
    }

    i++;
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}
