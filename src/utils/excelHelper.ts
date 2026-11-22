import * as XLSX from 'xlsx';
import type {
  AdminStudentSummary,
  GradeRecord,
  MaterialDefinition,
} from '../types.ts';
import { PJOK_MATERIALS } from './athleteAnalytics.ts';
import {
  getPengetahuanDescription,
  getPraktikDescription,
  resolveUnifiedPengetahuanScore,
} from './gradeDescription.ts';

export interface GradeExportRow {
  NIS: string;
  Nama_Siswa: string;
  Kelas: string;
  Semester: string;
  Kode_Materi: string;
  Nama_Materi: string;
  Nilai_Praktik: number | '';
  Nilai_Pengetahuan: number | '';
  Rata_Rata: number | '';
  Deskripsi_Praktik: string;
  Deskripsi_Pengetahuan: string;
  Catatan_Guru: string;
}

export interface BuildGradeExportParams {
  students: AdminStudentSummary[];
  grades: GradeRecord[];
  classFilter: string;
  semesterFilter: string;
  availableMaterials?: MaterialDefinition[];
  materialFilter?: string;
  availableSemesters?: string[];
}

export function buildGradeExportRows({
  students,
  grades,
  classFilter,
  semesterFilter,
  availableMaterials,
  materialFilter = 'ALL',
  availableSemesters,
}: BuildGradeExportParams): GradeExportRow[] {
  const targetStudents = (
    classFilter === 'Semua Kelas'
      ? [...students]
      : students.filter((s) => s.className === classFilter)
  ).sort((a, b) => {
    const clsCmp = a.className.localeCompare(b.className, 'id', {
      numeric: true,
    });
    if (clsCmp !== 0) return clsCmp;
    return a.name.localeCompare(b.name, 'id');
  });

  const targetSemesters: string[] =
    semesterFilter === 'Semua Semester'
      ? availableSemesters && availableSemesters.length > 0
        ? availableSemesters
        : Array.from(new Set(grades.map((g) => g.semester))).filter(Boolean)
      : [semesterFilter];

  const effectiveSemesters =
    targetSemesters.length > 0 ? targetSemesters : ['Ganjil 2026/2027'];

  const materialMap = new Map<string, MaterialDefinition>();
  const baseMaterials =
    availableMaterials && availableMaterials.length > 0
      ? availableMaterials
      : [...PJOK_MATERIALS];
  baseMaterials.forEach((m) => {
    materialMap.set(m.code, m);
  });
  if (!availableMaterials || availableMaterials.length === 0) {
    grades.forEach((g) => {
      if (g.materialCode && !materialMap.has(g.materialCode)) {
        materialMap.set(g.materialCode, {
          code: g.materialCode,
          name: g.materialName || g.materialCode,
        });
      }
    });
  }
  const allMaterials = Array.from(materialMap.values());
  const targetMaterials =
    materialFilter && materialFilter !== 'ALL'
      ? allMaterials.filter((m) => m.code === materialFilter)
      : allMaterials;
  const effectiveMaterials =
    targetMaterials.length > 0 ? targetMaterials : allMaterials;

  const gradeLookup = new Map<string, GradeRecord>();
  const gradesByStudentSem = new Map<string, GradeRecord[]>();
  grades.forEach((g) => {
    gradeLookup.set(`${g.studentId}::${g.semester}::${g.materialCode}`, g);
    const key = `${g.studentId}::${g.semester}`;
    const list = gradesByStudentSem.get(key);
    if (list) list.push(g);
    else gradesByStudentSem.set(key, [g]);
  });
  const unifiedKByStudentSem = new Map<string, number | null>();
  gradesByStudentSem.forEach((list, key) => {
    unifiedKByStudentSem.set(key, resolveUnifiedPengetahuanScore(list));
  });

  const rows: GradeExportRow[] = [];

  effectiveSemesters.forEach((semester) => {
    effectiveMaterials.forEach((mat) => {
      targetStudents.forEach((stu) => {
        const g = gradeLookup.get(`${stu.id}::${semester}::${mat.code}`);
        const p = g && typeof g.praktikScore === 'number' ? g.praktikScore : '';
        const k =
          g && typeof g.pengetahuanScore === 'number'
            ? g.pengetahuanScore
            : '';
        const avg =
          typeof p === 'number' && typeof k === 'number'
            ? Math.round((p + k) / 2)
            : typeof p === 'number'
              ? p
              : typeof k === 'number'
                ? k
                : '';
        const unifiedK =
          unifiedKByStudentSem.get(`${stu.id}::${semester}`) ??
          g?.pengetahuanScore ??
          null;

        rows.push({
          NIS: stu.nis,
          Nama_Siswa: stu.name,
          Kelas: stu.className,
          Semester: semester,
          Kode_Materi: mat.code,
          Nama_Materi: mat.name,
          Nilai_Praktik: p,
          Nilai_Pengetahuan: k,
          Rata_Rata: avg,
          Deskripsi_Praktik: g
            ? getPraktikDescription(g.praktikScore, mat.name)
            : '',
          Deskripsi_Pengetahuan: getPengetahuanDescription(unifiedK),
          Catatan_Guru: g
            ? g.remedialDetail
              ? `${g.teacherNote} | Detail: ${g.remedialDetail}`
              : g.teacherNote
            : '',
        });
      });
    });
  });

  return rows;
}

export function exportGradesToFile(
  students: AdminStudentSummary[],
  grades: GradeRecord[],
  format: 'xlsx' | 'csv',
  classFilter: string,
  semesterFilter: string,
  availableMaterials?: MaterialDefinition[],
  materialFilter = 'ALL',
  availableSemesters?: string[]
) {
  const rows = buildGradeExportRows({
    students,
    grades,
    classFilter,
    semesterFilter,
    availableMaterials,
    materialFilter,
    availableSemesters,
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 13 },
    { wch: 28 },
    { wch: 10 },
    { wch: 20 },
    { wch: 18 },
    { wch: 26 },
    { wch: 14 },
    { wch: 17 },
    { wch: 11 },
    { wch: 44 },
    { wch: 48 },
    { wch: 42 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Nilai PJOK');

  const safeClass = classFilter.replace(/\s+/g, '_');
  const safeSem = semesterFilter.replace(/[\s/]+/g, '_');
  const safeMat =
    materialFilter && materialFilter !== 'ALL'
      ? `_${materialFilter.replace(/[^A-Za-z0-9_-]+/g, '_')}`
      : '_Semua_Materi';
  const filename = `Nilai_PJOK_SMPN2Ciamis_${safeClass}_${safeSem}${safeMat}.${format}`;

  if (format === 'csv') {
    XLSX.writeFile(workbook, filename, { bookType: 'csv' });
  } else {
    XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
  }
}

export function downloadImportTemplate(
  students?: AdminStudentSummary[],
  classFilter = 'Semua Kelas',
  semesterFilter = 'Ganjil 2026/2027',
  availableMaterials?: MaterialDefinition[],
  materialFilter = 'ALL'
) {
  if (students && students.length > 0) {
    const templateRows = buildGradeExportRows({
      students,
      grades: [],
      classFilter,
      semesterFilter,
      availableMaterials,
      materialFilter,
    }).map((row) => ({
      NIS: row.NIS,
      Nama_Siswa: row.Nama_Siswa,
      Kelas: row.Kelas,
      Semester: row.Semester,
      Kode_Materi: row.Kode_Materi,
      Nama_Materi: row.Nama_Materi,
      Nilai_Praktik: '',
      Nilai_Pengetahuan: '',
      Catatan_Guru: '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(templateRows);
    worksheet['!cols'] = [
      { wch: 13 },
      { wch: 28 },
      { wch: 10 },
      { wch: 20 },
      { wch: 18 },
      { wch: 26 },
      { wch: 14 },
      { wch: 17 },
      { wch: 36 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template Import Nilai');
    const safeClass = classFilter.replace(/\s+/g, '_');
    const safeMat =
      materialFilter && materialFilter !== 'ALL'
        ? `_${materialFilter.replace(/[^A-Za-z0-9_-]+/g, '_')}`
        : '';
    XLSX.writeFile(
      workbook,
      `Template_Import_Nilai_PJOK_SMPN2Ciamis_${safeClass}${safeMat}.xlsx`
    );
    return;
  }

  const sampleRows = [
    {
      NIS: '242507001',
      Nama_Siswa: 'Raka Pratama Nugraha',
      Kelas: 'VII A',
      Semester: 'Ganjil 2026/2027',
      Kode_Materi: 'ATLETIK',
      Nama_Materi: 'Atletik & Lari Sprint',
      Nilai_Praktik: '',
      Nilai_Pengetahuan: '',
      Catatan_Guru: '',
    },
    {
      NIS: '242507002',
      Nama_Siswa: 'Nadia Putri Ramadhani',
      Kelas: 'VII A',
      Semester: 'Ganjil 2026/2027',
      Kode_Materi: 'BULU_TANGKIS',
      Nama_Materi: 'Bulu Tangkis',
      Nilai_Praktik: '',
      Nilai_Pengetahuan: '',
      Catatan_Guru: '',
    },
  ];
  const worksheet = XLSX.utils.json_to_sheet(sampleRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Template Import Nilai');
  XLSX.writeFile(workbook, 'Template_Import_Nilai_PJOK_SMPN2Ciamis.xlsx');
}

function normalizeExcelHeaderKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function buildNormalizedRowLookup(
  row: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  Object.entries(row).forEach(([k, v]) => {
    const nk = normalizeExcelHeaderKey(k);
    if (nk && !(nk in normalized)) {
      normalized[nk] = v;
    }
  });
  return normalized;
}

function pickLookupValue(
  lookup: Record<string, unknown>,
  keys: string[]
): unknown {
  for (const key of keys) {
    const val = lookup[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return val;
    }
  }
  return undefined;
}

function cleanNisCell(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  let str = String(raw).trim();
  if (/^\d+\.0+$/.test(str)) {
    str = str.replace(/\.0+$/, '');
  }
  return str;
}

function parseOptionalImportedScore(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (
    !trimmed ||
    trimmed === '-' ||
    trimmed.toLowerCase() === 'kosong' ||
    trimmed.toLowerCase() === 'null'
  ) {
    return null;
  }
  const normalized = trimmed.replace(',', '.');
  const num = Number(normalized);
  if (Number.isNaN(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function readWorkbookFromBuffer(buffer: ArrayBuffer, fileName: string) {
  const isCsvOrText = /\.(csv|tsv|txt)$/i.test(fileName);
  if (isCsvOrText) {
    const rawText = new TextDecoder('utf-8')
      .decode(buffer)
      .replace(/^\uFEFF/, '');
    const firstNonEmptyLine =
      rawText.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
    const semiCount = (firstNonEmptyLine.match(/;/g) || []).length;
    const commaCount = (firstNonEmptyLine.match(/,/g) || []).length;
    const tabCount = (firstNonEmptyLine.match(/\t/g) || []).length;
    const fsChar =
      tabCount > semiCount && tabCount > commaCount
        ? '\t'
        : semiCount > commaCount
          ? ';'
          : ',';
    return XLSX.read(rawText, { type: 'string', FS: fsChar, raw: true });
  }
  return XLSX.read(buffer, { type: 'array' });
}

function extractRowsDetectingHeader(
  sheet: XLSX.WorkSheet
): Array<Record<string, unknown>> {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
  });
  let headerRowIdx = 0;
  const maxScan = Math.min(12, matrix.length);
  for (let i = 0; i < maxScan; i++) {
    const rowCells = Array.isArray(matrix[i]) ? matrix[i] : [];
    const normalizedCells = rowCells.map((c) =>
      normalizeExcelHeaderKey(String(c ?? ''))
    );
    const hasNisOrName = normalizedCells.some(
      (c) =>
        c === 'nis' ||
        c === 'noinduk' ||
        c === 'nomorinduksiswa' ||
        c === 'namasiswa'
    );
    const hasScoreOrClass = normalizedCells.some(
      (c) =>
        c === 'kelas' ||
        c === 'nilaipraktik' ||
        c === 'praktik' ||
        c === 'nilaipengetahuan' ||
        c === 'pengetahuan' ||
        c === 'kodemateri'
    );
    if (hasNisOrName && (hasScoreOrClass || i === 0)) {
      headerRowIdx = i;
      break;
    }
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    range: headerRowIdx,
    defval: '',
  });
}

export async function parseSpreadsheetFile(
  file: File,
  defaultSemester = 'Ganjil 2026/2027'
) {
  const buffer = await file.arrayBuffer();
  const workbook = readWorkbookFromBuffer(buffer, file.name);
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = extractRowsDetectingHeader(sheet);

  return rawRows.map((row) => {
    const lookup = buildNormalizedRowLookup(row);
    const rawP = pickLookupValue(lookup, [
      'nilaipraktik',
      'praktik',
      'praktikscore',
      'nilaiketerampilan',
      'keterampilan',
      'skorpraktik',
    ]);
    const rawK = pickLookupValue(lookup, [
      'nilaipengetahuan',
      'pengetahuan',
      'pengetahuanscore',
      'nilaiteori',
      'teori',
      'skorpengetahuan',
    ]);
    const nis = cleanNisCell(
      pickLookupValue(lookup, [
        'nis',
        'noinduk',
        'nomorinduk',
        'nomorinduksiswa',
        'nisn',
      ])
    );
    const name = String(
      pickLookupValue(lookup, [
        'namasiswa',
        'nama',
        'name',
        'namalengkap',
        'siswa',
      ]) ?? ''
    ).trim();
    const className = String(
      pickLookupValue(lookup, ['kelas', 'classname', 'class', 'rombel']) ?? ''
    ).trim();
    const semester = String(
      pickLookupValue(lookup, ['semester', 'periode', 'smt']) ?? defaultSemester
    ).trim();
    const materialCode = String(
      pickLookupValue(lookup, [
        'kodemateri',
        'materialcode',
        'namamateri',
        'materi',
        'materiinti',
      ]) ?? 'ATLETIK'
    ).trim();
    const teacherNote = String(
      pickLookupValue(lookup, [
        'catatanguru',
        'catatan',
        'teachernote',
        'keterangan',
      ]) ?? ''
    ).trim();

    return {
      nis,
      name,
      className,
      semester,
      materialCode,
      praktikScore: parseOptionalImportedScore(rawP),
      pengetahuanScore: parseOptionalImportedScore(rawK),
      teacherNote,
    };
  });
}

export interface StudentExportRow {
  NIS: string;
  Nama_Siswa: string;
  Kelas: string;
  Jenis_Kelamin: string;
  UID_RFID: string;
  Kode_QR: string;
  Nama_Orang_Tua: string;
  No_WA_Orang_Tua: string;
  Minat_Olahraga: string;
  Aktivitas_Non_Akademik: string;
}

export function exportStudentsToFile(
  students: AdminStudentSummary[],
  format: 'xlsx' | 'csv',
  classFilter = 'Semua Kelas'
) {
  const filtered =
    classFilter === 'Semua Kelas'
      ? students
      : students.filter((s) => s.className === classFilter);

  const rows: StudentExportRow[] = filtered.map((s) => ({
    NIS: s.nis,
    Nama_Siswa: s.name,
    Kelas: s.className,
    Jenis_Kelamin: s.gender,
    UID_RFID: s.rfidUid,
    Kode_QR: s.qrCodeValue || `SMPN2PJOK:${s.nis}`,
    Nama_Orang_Tua: s.parentName,
    No_WA_Orang_Tua: s.parentWhatsapp,
    Minat_Olahraga: s.primarySportInterest,
    Aktivitas_Non_Akademik: s.nonAcademicActivity,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Siswa');

  const safeClass = classFilter.replace(/\s+/g, '_');
  const filename = `Data_Siswa_PJOK_SMPN2Ciamis_${safeClass}.${format}`;

  if (format === 'csv') {
    XLSX.writeFile(workbook, filename, { bookType: 'csv' });
  } else {
    XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
  }
}

export function downloadStudentImportTemplate() {
  const sampleRows: StudentExportRow[] = [
    {
      NIS: '262707001',
      Nama_Siswa: 'Bima Sakti Nugroho',
      Kelas: 'VII A',
      Jenis_Kelamin: 'L',
      UID_RFID: 'RF-2627-001',
      Kode_QR: 'SMPN2PJOK:262707001',
      Nama_Orang_Tua: 'Bpk. Hendra Nugroho',
      No_WA_Orang_Tua: '6281234567801',
      Minat_Olahraga: 'Sepak Bola',
      Aktivitas_Non_Akademik: 'OSIS Sekbid Olahraga',
    },
    {
      NIS: '262707002',
      Nama_Siswa: 'Citra Kirana Dewi',
      Kelas: 'VII B',
      Jenis_Kelamin: 'P',
      UID_RFID: 'RF-2627-002',
      Kode_QR: 'SMPN2PJOK:262707002',
      Nama_Orang_Tua: 'Ibu Ratna Dewi',
      No_WA_Orang_Tua: '6281234567802',
      Minat_Olahraga: 'Bulutangkis',
      Aktivitas_Non_Akademik: 'PMR & UKS',
    },
  ];
  const worksheet = XLSX.utils.json_to_sheet(sampleRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Template Data Siswa');
  XLSX.writeFile(workbook, 'Template_Import_Siswa_PJOK_SMPN2Ciamis.xlsx');
}

export async function parseStudentSpreadsheetFile(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  return rawRows
    .map((row) => {
      const nis = String(
        row.NIS ?? row.nis ?? row['Nomor Induk Siswa'] ?? ''
      ).trim();
      const name = String(
        row.Nama_Siswa ?? row.Nama ?? row.name ?? ''
      ).trim();
      const rawGender = String(
        row.Jenis_Kelamin ?? row.JK ?? row.Gender ?? row.gender ?? 'L'
      )
        .trim()
        .toUpperCase();

      return {
        nis,
        name,
        className: String(row.Kelas ?? row.className ?? 'VII A').trim(),
        gender: (rawGender.startsWith('P') ? 'P' : 'L') as 'L' | 'P',
        rfidUid: String(
          row.UID_RFID ?? row.RFID ?? row.rfidUid ?? ''
        ).trim(),
        qrCodeValue: String(
          row.Kode_QR ?? row.QR ?? row.qrCodeValue ?? ''
        ).trim(),
        parentName: String(
          row.Nama_Orang_Tua ?? row.Wali ?? row.parentName ?? ''
        ).trim(),
        parentWhatsapp: String(
          row.No_WA_Orang_Tua ??
            row.WA_Orang_Tua ??
            row.Whatsapp ??
            row.parentWhatsapp ??
            ''
        ).trim(),
        primarySportInterest: String(
          row.Minat_Olahraga ?? row.Olahraga ?? row.primarySportInterest ?? 'Atletik'
        ).trim(),
        nonAcademicActivity: String(
          row.Aktivitas_Non_Akademik ??
            row.Ekstrakurikuler ??
            row.nonAcademicActivity ??
            'Pramuka Inti'
        ).trim(),
      };
    })
    .filter((r) => r.nis && r.name);
}

export interface StudentRecapExportRowInput {
  nis: string;
  name: string;
  className: string;
  pengetahuanScore: number | null;
  avgKeterampilan: number | null;
  avgCombined: number | null;
  activeKkm: number;
  statusLabel: string;
  perMaterialPraktik: Record<string, number | null>;
}

export function exportStudentRecapToFile({
  rows,
  materials,
  classFilter,
  semesterFilter,
  materialFilter = 'ALL',
  materialName,
  format = 'xlsx',
}: {
  rows: StudentRecapExportRowInput[];
  materials: MaterialDefinition[];
  classFilter: string;
  semesterFilter: string;
  materialFilter?: string;
  materialName?: string;
  format?: 'xlsx' | 'csv';
}) {
  const isSingleMaterial = materialFilter !== 'ALL';
  const targetMaterials = isSingleMaterial
    ? materials.filter((m) => m.code === materialFilter)
    : materials;

  const sheetRows = rows.map((row, idx) => {
    const record: Record<string, string | number> = {
      No: idx + 1,
      NIS: row.nis,
      Nama_Siswa: row.name,
      Kelas: row.className,
      Semester: semesterFilter,
      Materi_Inti: isSingleMaterial
        ? materialName || materialFilter
        : 'Semua Materi Inti',
      Nilai_Pengetahuan: row.pengetahuanScore ?? '',
      [isSingleMaterial
        ? 'Nilai_Keterampilan'
        : 'Rata_Rata_Keterampilan']: row.avgKeterampilan ?? '',
      Nilai_Gabungan: row.avgCombined ?? '',
      KKM: row.activeKkm,
      Status_Ketuntasan: row.statusLabel,
    };
    if (!isSingleMaterial) {
      targetMaterials.forEach((mat) => {
        const score = row.perMaterialPraktik[mat.code];
        record[`Keterampilan_${mat.name.replace(/\s+/g, '_')}`] =
          score !== null && score !== undefined ? score : '';
      });
    }
    return record;
  });

  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rekap Nilai PJOK');

  const safeClass = classFilter.replace(/\s+/g, '_');
  const safeMat = isSingleMaterial
    ? `_${(materialName || materialFilter).replace(/\s+/g, '_')}`
    : '';
  const safeSem = semesterFilter.replace(/\s+/g, '_');
  const filename = `Rekap_Nilai_Pengetahuan_Keterampilan_${safeClass}${safeMat}_${safeSem}.${format}`;

  if (format === 'csv') {
    XLSX.writeFile(workbook, filename, { bookType: 'csv' });
  } else {
    XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
  }
}
