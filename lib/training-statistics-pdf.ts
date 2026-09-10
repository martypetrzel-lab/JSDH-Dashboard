import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type {
  TrainingStatistics,
  TrainingStatisticsMember,
} from './training-statistics';

const WIDTH = 841.89;
const HEIGHT = 595.28;
const MARGIN = 38;
const BOTTOM = 42;
const statusLabels = {
  PRESENT: 'Přítomen',
  ABSENT: 'Nepřítomen',
  EXCUSED: 'Omluven',
};
const formatMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));

const periodLabel = (period: TrainingStatistics['period']) =>
  period.from.endsWith('-01-01') &&
  period.to === `${period.from.slice(0, 4)}-12-31`
    ? `Rok ${period.from.slice(0, 4)}`
    : `${formatDate(period.from)} - ${formatDate(period.to)}`;

function wrap(value: string, font: PDFFont, width: number, size: number) {
  const result: string[] = [];
  for (const paragraph of value.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) result.push(line);
        line = word;
      }
    }
    result.push(line);
  }
  return result;
}

async function reportCanvas(title: string) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'),
    ),
    { subset: true },
  );
  pdf.setTitle(title);
  pdf.setAuthor('JSDH Nehvizdy');
  const pages: PDFPage[] = [];
  let page: PDFPage;
  let y: number;
  const addPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    pages.push(page);
    y = HEIGHT - MARGIN;
  };
  addPage();
  const draw = (value: string, x: number, at: number, size = 9) =>
    page.drawText(value, { x, y: at, size, font, color: rgb(0, 0, 0) });
  const ensure = (space: number) => {
    if (y - space < BOTTOM) addPage();
  };
  const paragraph = (value: string, size = 9, gap = 4) => {
    for (const line of wrap(value, font, WIDTH - MARGIN * 2, size)) {
      ensure(size + 5);
      draw(line, MARGIN, y - size, size);
      y -= size + 4;
    }
    y -= gap;
  };
  const center = (value: string, size: number) => {
    draw(
      value,
      (WIDTH - font.widthOfTextAtSize(value, size)) / 2,
      y - size,
      size,
    );
    y -= size + 7;
  };
  const tableRow = (
    values: string[],
    widths: number[],
    header = false,
    repeatHeader?: () => void,
  ) => {
    const content = values.map((value, index) =>
      wrap(value, font, widths[index] - 10, 8),
    );
    const rowHeight = Math.max(
      24,
      ...content.map((lines) => lines.length * 11 + 10),
    );
    if (y - rowHeight < BOTTOM) {
      addPage();
      repeatHeader?.();
    }
    let x = MARGIN;
    widths.forEach((width, index) => {
      page.drawRectangle({
        x,
        y: y - rowHeight,
        width,
        height: rowHeight,
        borderColor: rgb(0.38, 0.38, 0.38),
        borderWidth: 0.5,
        ...(header ? { color: rgb(0.93, 0.93, 0.93) } : {}),
      });
      content[index].forEach((line, lineIndex) =>
        draw(line, x + 5, y - 14 - lineIndex * 11, 8),
      );
      x += width;
    });
    y -= rowHeight;
  };
  return {
    addPage,
    ensure,
    paragraph,
    center,
    tableRow,
    getY: () => y,
    setY: (value: number) => {
      y = value;
    },
    save: async (period: TrainingStatistics['period']) => {
      pages.forEach((item, index) =>
        item.drawText(
          `JSDH Nehvizdy  |  Přehled odborné přípravy  |  ${periodLabel(period)}  |  Strana ${index + 1} / ${pages.length}`,
          { x: MARGIN, y: 20, size: 7.5, font, color: rgb(0, 0, 0) },
        ),
      );
      return pdf.save();
    },
  };
}

type Canvas = Awaited<ReturnType<typeof reportCanvas>>;

function drawMemberDetails(canvas: Canvas, member: TrainingStatisticsMember) {
  canvas.ensure(90);
  canvas.paragraph(member.name.toLocaleUpperCase('cs-CZ'), 11, 2);
  canvas.paragraph(
    `Účast: ${member.attendancePercent === null ? '—' : `${member.attendancePercent} %`}  |  Absolvováno: ${formatMinutes(member.durationMinutes)}  |  Přítomen: ${member.present}  |  Omluven: ${member.excused}  |  Nepřítomen: ${member.absent}`,
    8.5,
    5,
  );
  const widths = [76, 467, 95, 127];
  const header = () =>
    canvas.tableRow(['Datum', 'Témata', 'Dotace', 'Stav'], widths, true);
  header();
  for (const session of member.sessions) {
    canvas.tableRow(
      [
        formatDate(session.date),
        session.topics.map((topic) => topic.nameSnapshot).join(', '),
        formatMinutes(session.durationMinutes),
        statusLabels[session.status],
      ],
      widths,
      false,
      header,
    );
  }
  canvas.setY(canvas.getY() - 16);
}

export async function createTrainingStatisticsPdf(
  statistics: TrainingStatistics,
  includeDetails = false,
) {
  const canvas = await reportCanvas('Přehled odborné přípravy a účasti členů');
  canvas.center('JEDNOTKA SBORU DOBROVOLNÝCH HASIČŮ OBCE NEHVIZDY', 10);
  canvas.center('PŘEHLED ODBORNÉ PŘÍPRAVY A ÚČASTI ČLENŮ', 15);
  canvas.center(periodLabel(statistics.period), 11);
  canvas.setY(canvas.getY() - 8);
  canvas.paragraph('SOUHRN ODBORNÉ PŘÍPRAVY', 11, 6);
  const summary = statistics.summary;
  canvas.paragraph(
    `Počet školení: ${summary.sessions}     Celková časová dotace: ${formatMinutes(summary.durationMinutes)}     Průměrná účast jednotky: ${summary.attendancePercent === null ? '—' : `${summary.attendancePercent} %`}`,
  );
  canvas.paragraph(
    `Celkem přítomen: ${summary.present}     Celkem omluven: ${summary.excused}     Celkem nepřítomen: ${summary.absent}`,
    9,
    10,
  );
  const widths = [28, 237, 70, 70, 75, 65, 105, 115];
  const header = () =>
    canvas.tableRow(
      [
        'Č.',
        'Jméno a příjmení',
        'Přítomen',
        'Omluven',
        'Nepřítomen',
        'Celkem',
        'Hodiny',
        'Účast %',
      ],
      widths,
      true,
    );
  header();
  statistics.members.forEach((member, index) =>
    canvas.tableRow(
      [
        String(index + 1),
        member.name,
        String(member.present),
        String(member.excused),
        String(member.absent),
        String(member.recordedSessions),
        formatMinutes(member.durationMinutes),
        member.attendancePercent === null
          ? '—'
          : `${member.attendancePercent} %`,
      ],
      widths,
      false,
      header,
    ),
  );
  if (includeDetails) {
    for (const member of statistics.members.filter(
      (item) => item.recordedSessions > 0,
    )) {
      canvas.addPage();
      drawMemberDetails(canvas, member);
    }
  }
  return canvas.save(statistics.period);
}

export async function createMemberTrainingStatisticsPdf(
  statistics: TrainingStatistics,
  member: TrainingStatisticsMember,
) {
  const canvas = await reportCanvas('Přehled odborné přípravy člena');
  canvas.center('JEDNOTKA SBORU DOBROVOLNÝCH HASIČŮ OBCE NEHVIZDY', 10);
  canvas.center('PŘEHLED ODBORNÉ PŘÍPRAVY ČLENA', 15);
  canvas.center(member.name, 13);
  canvas.center(periodLabel(statistics.period), 10);
  canvas.setY(canvas.getY() - 8);
  drawMemberDetails(canvas, member);
  return canvas.save(statistics.period);
}
