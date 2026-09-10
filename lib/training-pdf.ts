import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { TrainingSessionRow } from './training';

// Embedded, OFL-licensed font: no system fonts or network calls at runtime.
export async function createAttendancePdf(
  session: TrainingSessionRow,
  issuedAt = new Date(),
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'),
    ),
    { subset: true },
  );
  pdf.setTitle('Záznam o odborné přípravě - prezenční listina');
  pdf.setAuthor('JSDH Nehvizdy');
  const width = 595.28,
    height = 841.89,
    margin = 42,
    usable = width - margin * 2;
  let page = pdf.addPage([width, height]),
    y = height - margin;
  const pages = [page];
  const newPage = () => {
    page = pdf.addPage([width, height]);
    pages.push(page);
    y = height - margin;
  };
  const ensure = (space: number) => {
    if (y - space < 55) newPage();
  };
  const text = (value: string, x: number, at: number, size = 10) =>
    page.drawText(value, { x, y: at, font, size, color: rgb(0, 0, 0) });
  const lines = (value: string, available: number, size: number) =>
    wrapPdfText(value, font, available, size);
  const paragraph = (value: string, size = 10, gap = 5) => {
    for (const line of lines(value, usable, size)) {
      ensure(size + 6);
      text(line, margin, y - size, size);
      y -= size + 5;
    }
    y -= gap;
  };
  const centered = (value: string, size: number) => {
    text(
      value,
      (width - font.widthOfTextAtSize(value, size)) / 2,
      y - size,
      size,
    );
    y -= size + 9;
  };
  centered('JEDNOTKA SBORU DOBROVOLNÝCH HASIČŮ OBCE NEHVIZDY', 10);
  y -= 6;
  centered('ZÁZNAM O ODBORNÉ PŘÍPRAVĚ', 16);
  centered('PREZENČNÍ LISTINA', 12);
  y -= 13;
  const date = (value: string) =>
    new Intl.DateTimeFormat('cs-CZ', {
      timeZone: 'UTC',
      dateStyle: 'medium',
    }).format(new Date(value));
  const time = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat('cs-CZ', {
          timeZone: 'Europe/Prague',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(value))
      : 'Neuvedeno';
  paragraph('Datum: ' + date(session.date));
  paragraph(
    'Čas od: ' +
      time(session.startTime) +
      '     Čas do: ' +
      time(session.endTime),
  );
  paragraph(
    'Časová dotace: ' +
      session.durationMinutes +
      ' minut (' +
      (session.durationMinutes / 60).toLocaleString('cs-CZ', {
        maximumFractionDigits: 2,
      }) +
      ' h)',
  );
  paragraph('Místo: ' + (session.location || 'Neuvedeno'));
  paragraph(
    'Forma: ' +
      { THEORY: 'Teoretická', PRACTICE: 'Praktická', COMBINED: 'Kombinovaná' }[
        session.trainingType
      ],
  );
  paragraph('Školitel: ' + session.instructorName);
  if (session.status === 'DRAFT')
    paragraph('Stav: NÁVRH - školení dosud není dokončeno.');
  y -= 8;
  paragraph('TÉMATA ODBORNÉ PŘÍPRAVY', 11);
  let topicNumber = 1;
  for (const category of new Set(
    session.topics.map((topic) => topic.categorySnapshot),
  )) {
    for (const subcategory of new Set(
      session.topics
        .filter((topic) => topic.categorySnapshot === category)
        .map((topic) => topic.subcategorySnapshot),
    )) {
      ensure(35);
      paragraph(`${category} - ${subcategory}`, 10);
      for (const topic of session.topics.filter(
        (topic) =>
          topic.categorySnapshot === category &&
          topic.subcategorySnapshot === subcategory,
      )) {
        paragraph(`${topicNumber}. ${topic.nameSnapshot}`);
        topicNumber += 1;
      }
    }
  }
  if (session.notes) {
    ensure(45);
    paragraph('Obsah / poznámka k odborné přípravě:', 11);
    paragraph(session.notes);
  }
  y -= 8;
  const columns = [28, 162, 119, 78, usable - 387];
  const row = (values: string[], header: boolean) => {
    const wrapped = values.map((value, index) =>
      lines(value, columns[index] - 12, 9),
    );
    const rowHeight = Math.max(
      header ? 27 : 38,
      ...wrapped.map((value) => value.length * 13 + 14),
    );
    if (y - rowHeight < 55) {
      newPage();
      tableHeader();
    }
    let x = margin;
    columns.forEach((colWidth, index) => {
      page.drawRectangle({
        x,
        y: y - rowHeight,
        width: colWidth,
        height: rowHeight,
        borderColor: rgb(0.35, 0.35, 0.35),
        borderWidth: 0.5,
        ...(header ? { color: rgb(0.94, 0.94, 0.94) } : {}),
      });
      wrapped[index].forEach((line, li) =>
        text(line, x + 6, y - 16 - li * 13, 9),
      );
      x += colWidth;
    });
    y -= rowHeight;
  };
  const tableHeader = () =>
    row(['Č.', 'Jméno a příjmení', 'Funkce', 'Účast', 'Podpis'], true);
  ensure(70);
  tableHeader();
  session.participants.forEach((p, i) =>
    row(
      [
        String(i + 1),
        p.nameSnapshot,
        p.roleSnapshot,
        { PRESENT: 'Přítomen', ABSENT: 'Nepřítomen', EXCUSED: 'Omluven' }[
          p.status
        ],
        '',
      ],
      false,
    ),
  );
  ensure(135);
  y -= 23;
  paragraph('Školení provedl:', 11);
  paragraph('Jméno: ' + session.instructorName);
  paragraph('Podpis: ____________________________________');
  paragraph(
    'Datum vyhotovení: ' +
      new Intl.DateTimeFormat('cs-CZ', {
        timeZone: 'Europe/Prague',
        dateStyle: 'medium',
      }).format(issuedAt),
  );
  pages.forEach((p, index) =>
    p.drawText(
      'JSDH Nehvizdy  |  ' +
        session.id +
        '  |  Strana ' +
        (index + 1) +
        ' / ' +
        pages.length,
      { x: margin, y: 26, size: 8, font },
    ),
  );
  return pdf.save();
}
function wrapPdfText(
  value: string,
  font: PDFFont,
  width: number,
  size: number,
) {
  const result: string[] = [];
  for (const paragraph of value.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (
        font.widthOfTextAtSize((line ? line + ' ' : '') + word, size) <= width
      ) {
        line += (line ? ' ' : '') + word;
        continue;
      }
      if (line) result.push(line);
      line = '';
      for (const character of word) {
        if (font.widthOfTextAtSize(line + character, size) > width && line) {
          result.push(line);
          line = '';
        }
        line += character;
      }
    }
    result.push(line);
  }
  return result;
}
