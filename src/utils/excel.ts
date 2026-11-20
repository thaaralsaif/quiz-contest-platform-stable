import * as XLSX from 'xlsx';
import type { ImportedQuestionRow } from '../types/game';

function cleanCell(val: unknown, fallback = ''): string {
  const s = String(val ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || fallback;
}

export function downloadExcelTemplate(): void {
  const rows = [
    [
      'الجولة',
      'الفئة',
      'الصعوبة',
      'نص السؤال',
      'الخيار A',
      'الخيار B',
      'الخيار C',
      'الحرف الصحيح',
      'رابط الصورة (اختياري)',
      'رابط الصوت (اختياري)',
      'معلومة إثرائية (اختياري)',
    ],
    [
      'الجولة 1',
      'علوم',
      'سهل',
      'ما هو الرمز الكيميائي للماء؟',
      'H2O',
      'CO2',
      'O2',
      'A',
      '',
      '',
      'يتكون جزيء الماء من ذرتي هيدروجين وذرة أكسجين واحدة.',
    ],
    [
      'الجولة 1',
      'تاريخ',
      'متوسط',
      'في أي قارة تقع مدينة القيروان؟',
      'آسيا',
      'أفريقيا',
      'أوروبا',
      'B',
      '',
      '',
      'تأسست مدينة القيروان في تونس عام 50 هـ وتعد من أقدم المدن الإسلامية.',
    ],
    [
      'الجولة 2',
      'تقنية',
      'صعب',
      'ما البروتوكول المسؤول عن نقل صفحات الويب المشفرة؟',
      'FTP',
      'SSH',
      'HTTPS',
      'C',
      '',
      '',
      '',
    ],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'الأسئلة');
  XLSX.writeFile(wb, 'نموذج_أسئلة_المسابقة.xlsx');
}

export async function parseExcelQuestionsFile(file: File): Promise<ImportedQuestionRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('الملف لا يحتوي على أي ورقة عمل صالحة');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  const parsed: ImportedQuestionRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const row = Array.isArray(rawRows[i]) ? rawRows[i] : [];
    const col0 = cleanCell(row[0]);
    const col1 = cleanCell(row[1]);
    const col2 = cleanCell(row[2]);
    const col3 = cleanCell(row[3]);

    if (
      i === 0 &&
      (col0.includes('الجولة') ||
        col0.includes('الفئة') ||
        col2.includes('السؤال') ||
        col3.includes('السؤال') ||
        col0.toLowerCase().includes('round') ||
        col0.toLowerCase().includes('category'))
    ) {
      continue;
    }

    const hasEightColumns = row.length >= 8 || cleanCell(row[7]) !== '';

    if (hasEightColumns) {
      const qText = cleanCell(row[3]);
      if (!qText) continue;
      const imageUrl = cleanCell(row[8]);
      const audioUrl = cleanCell(row[9]);
      const explanation = cleanCell(row[10]);
      parsed.push({
        round: col0 || 'الجولة 1',
        category: col1 || 'عام',
        difficulty: col2 || 'سهل',
        question: qText,
        optA: cleanCell(row[4]),
        optB: cleanCell(row[5]),
        optC: cleanCell(row[6]),
        correct: cleanCell(row[7], 'A').toUpperCase(),
        ...(imageUrl ? { imageUrl } : {}),
        ...(audioUrl ? { audioUrl } : {}),
        ...(explanation ? { explanation } : {}),
      });
    } else {
      const qText = cleanCell(row[2]);
      if (!qText) continue;
      parsed.push({
        round: 'الجولة 1',
        category: col0 || 'عام',
        difficulty: col1 || 'سهل',
        question: qText,
        optA: cleanCell(row[3]),
        optB: cleanCell(row[4]),
        optC: cleanCell(row[5]),
        correct: cleanCell(row[6], 'A').toUpperCase(),
      });
    }
  }

  return parsed;
}
