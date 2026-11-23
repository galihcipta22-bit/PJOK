import type {
  AttendanceRecord,
  FutCardStats,
  GradeRecord,
  StudentPortalPayload,
  StudentRecord,
  TalentRecommendation,
} from '../types.ts';
import {
  buildAutoGradeDescription,
  isReplaceableAutoOrPlaceholderNote,
  resolveUnifiedPengetahuanScore,
} from './gradeDescription.ts';

export const PJOK_MATERIALS = [
  { code: 'ATLETIK', name: 'Atletik & Lari Sprint' },
  { code: 'BOLA_BASKET', name: 'Permainan Bola Basket' },
  { code: 'BOLA_VOLI', name: 'Permainan Bola Voli' },
  { code: 'SEPAK_BOLA_FUTSAL', name: 'Permainan Bola Sepak/Futsal' },
  { code: 'KEBUGARAN_TKJ', name: 'Kebugaran Jasmani (TKJ)' },
  { code: 'SENAM_IRAMA', name: 'Senam Irama' },
  { code: 'BULU_TANGKIS', name: 'Bulu Tangkis' },
  { code: 'AKTIFITAS_AKUATIK', name: 'Aktifitas Aquatik' },
] as const;

export type GradeLevelKey = '7' | '8' | '9';

export const DEFAULT_CLASS_KKM: Record<GradeLevelKey, number> = {
  '7': 78,
  '8': 75,
  '9': 75,
};

export function extractGradeLevel(className?: string): GradeLevelKey | null {
  const trimmed = (className ?? '').trim().toUpperCase();
  if (!trimmed || trimmed === 'SEMUA KELAS') return null;
  if (/^VIII(\b|\s|-|[A-Z0-9])/.test(trimmed)) return '8';
  if (/^VII(\b|\s|-|[A-Z0-9])/.test(trimmed)) return '7';
  if (/^IX(\b|\s|-|[A-Z0-9])/.test(trimmed)) return '9';
  if (/^7(\b|\s|-|[A-Z0-9])/.test(trimmed)) return '7';
  if (/^8(\b|\s|-|[A-Z0-9])/.test(trimmed)) return '8';
  if (/^9(\b|\s|-|[A-Z0-9])/.test(trimmed)) return '9';
  return null;
}

export function normalizeClassKkmMap(
  raw?: Record<string, number>
): Record<GradeLevelKey, number> {
  const out: Record<GradeLevelKey, number> = { ...DEFAULT_CLASS_KKM };
  (['7', '8', '9'] as const).forEach((lvl) => {
    const val = Number(raw?.[lvl]);
    if (Number.isFinite(val) && val >= 0 && val <= 100) {
      out[lvl] = Math.round(val);
    }
  });
  return out;
}

export function resolveEffectiveKkm(params: {
  className?: string;
  semester?: string;
  semesterKkm?: Record<string, number>;
  classKkm?: Record<string, number>;
  fallbackKkm?: number;
}): number {
  const { className, semester, semesterKkm, classKkm, fallbackKkm = 78 } = params;
  const level = extractGradeLevel(className);
  if (level) {
    const classVal = Number(classKkm?.[level]);
    if (Number.isFinite(classVal) && classVal >= 0 && classVal <= 100) {
      return Math.round(classVal);
    }
    if (level === '7') {
      return DEFAULT_CLASS_KKM['7'];
    }
  }
  if (semester) {
    const semVal = Number(semesterKkm?.[semester]);
    if (Number.isFinite(semVal) && semVal >= 0 && semVal <= 100) {
      return Math.round(semVal);
    }
  }
  if (level) {
    return DEFAULT_CLASS_KKM[level];
  }
  return fallbackKkm;
}

export function formatKkmSummaryLabel(params: {
  classFilter?: string;
  semester?: string;
  semesterKkm?: Record<string, number>;
  classKkm?: Record<string, number>;
}): string {
  const { classFilter, semester, semesterKkm, classKkm } = params;
  const level = extractGradeLevel(classFilter);
  if (level) {
    const kkm = resolveEffectiveKkm({
      className: classFilter,
      semester,
      semesterKkm,
      classKkm,
    });
    return `KKM Kelas ${level}: ${kkm}`;
  }
  const normalized = normalizeClassKkmMap(classKkm);
  const semKkm =
    semester && typeof semesterKkm?.[semester] === 'number'
      ? Math.round(semesterKkm[semester])
      : 78;
  return `KKM Kelas 7: ${normalized['7']} · Semester: ${semKkm}`;
}

const LEGACY_MATERIAL_REMAP: Record<string, { code: string; name: string }> = {
  KEBUGARAN: { code: 'KEBUGARAN_TKJ', name: 'Kebugaran Jasmani (TKJ)' },
  SENAM: { code: 'SENAM_IRAMA', name: 'Senam Irama' },
  BOLA_KECIL: { code: 'BULU_TANGKIS', name: 'Bulu Tangkis' },
  BOLA_BESAR: { code: 'BOLA_BASKET', name: 'Permainan Bola Basket' },
};

const PREVIOUS_7_DEFAULT_CODES = [
  'ATLETIK',
  'BOLA_BASKET',
  'BOLA_VOLI',
  'SEPAK_BOLA_FUTSAL',
  'KEBUGARAN_TKJ',
  'SENAM_IRAMA',
  'BULU_TANGKIS',
] as const;

export function hasLegacyDefaultMaterials(
  materials?: Array<{ code: string; name: string }>
): boolean {
  if (!Array.isArray(materials) || materials.length === 0) return true;
  const codes = new Set(materials.map((m) => m.code));
  return (
    codes.has('BOLA_BESAR') &&
    codes.has('BOLA_KECIL') &&
    codes.has('KESEHATAN_P3K')
  );
}

export function isPrevious7DefaultMaterials(
  materials?: Array<{ code: string; name: string }>
): boolean {
  if (!Array.isArray(materials) || materials.length !== 7) return false;
  const codes = new Set(materials.map((m) => m.code));
  return (
    !codes.has('AKTIFITAS_AKUATIK') &&
    PREVIOUS_7_DEFAULT_CODES.every((code) => codes.has(code))
  );
}

export function isOutdatedDefaultMaterials(
  materials?: Array<{ code: string; name: string }>
): boolean {
  return (
    hasLegacyDefaultMaterials(materials) ||
    isPrevious7DefaultMaterials(materials)
  );
}

export function isLegacy18SeedStudents(
  students?: Array<{ id?: string; nis?: string }>
): boolean {
  if (!Array.isArray(students) || students.length !== 18) return false;
  return (
    students[0]?.nis === '242507001' &&
    students.every((s, idx) => s.id === `stu-${idx + 1}`)
  );
}

export const DEFAULT_SEED_SCORE = 75;

const OLD_SEED_GRADE_TIMESTAMPS = new Set([
  '2026-11-10T08:30:00.000Z',
  '2026-11-11T08:30:00.000Z',
  '2026-11-12T08:30:00.000Z',
]);

export function isOldDeterministicSeedGrades(
  grades?: Array<{
    id?: string;
    updatedAt?: string;
    praktikScore?: number | null;
    pengetahuanScore?: number | null;
  }>
): boolean {
  if (!Array.isArray(grades) || grades.length === 0) return false;
  const allUntouchedSeed = grades.every(
    (g) =>
      typeof g.id === 'string' &&
      g.id.startsWith('grd-stu-') &&
      typeof g.updatedAt === 'string' &&
      OLD_SEED_GRADE_TIMESTAMPS.has(g.updatedAt)
  );
  if (!allUntouchedSeed) return false;
  return grades.some(
    (g) => g.praktikScore !== DEFAULT_SEED_SCORE || g.pengetahuanScore !== DEFAULT_SEED_SCORE
  );
}

export function resolveMaterialCodeAlias(rawCode: string): string {
  const upper = rawCode.trim().toUpperCase();
  if (
    upper === 'AKTIFITAS_AQUATIK' ||
    upper === 'AKTIVITAS_AKUATIK' ||
    upper === 'AKTIVITAS_AQUATIK' ||
    upper === 'AKUATIK' ||
    upper === 'AQUATIK' ||
    upper === 'RENANG'
  ) {
    return 'AKTIFITAS_AKUATIK';
  }
  return LEGACY_MATERIAL_REMAP[upper]?.code ?? upper;
}

export function isSyntheticBackfillGrade(g: {
  id?: string;
  materialCode?: string;
  praktikScore?: number | null;
  pengetahuanScore?: number | null;
  updatedAt?: string;
}): boolean {
  return (
    typeof g.id === 'string' &&
    g.id.startsWith('grd-stu-') &&
    (g.materialCode === 'AKTIFITAS_AKUATIK' ||
      g.materialCode === 'AKTIFITAS_AQUATIK') &&
    g.praktikScore === DEFAULT_SEED_SCORE &&
    g.pengetahuanScore === DEFAULT_SEED_SCORE &&
    g.updatedAt === '2026-11-19T08:30:00.000Z'
  );
}

export function stripSyntheticBackfillGrades(grades: GradeRecord[]): {
  grades: GradeRecord[];
  removedCount: number;
} {
  const filtered = grades.filter((g) => !isSyntheticBackfillGrade(g));
  return {
    grades: filtered,
    removedCount: grades.length - filtered.length,
  };
}

export function backfillMissingDefaultGrades(params: {
  students: Array<{ id: string }>;
  semesters: string[];
  materials: Array<{ code: string; name: string }>;
  grades: GradeRecord[];
  defaultScore?: number;
}): { grades: GradeRecord[]; addedCount: number } {
  // Never synthesize fake 75/75 grades onto real inputted student data.
  return { grades: params.grades, addedCount: 0 };
}

export function reconcileAllGradesConsistency(params: {
  students: Array<{ id: string }>;
  materials: Array<{ code: string; name: string }>;
  grades: GradeRecord[];
}): {
  grades: GradeRecord[];
  changed: boolean;
  removedCount: number;
  updatedCount: number;
} {
  const { students, materials, grades } = params;
  const studentIdSet = new Set(students.map((s) => s.id));
  const matByCode = new Map(
    materials.map((m) => [m.code.trim().toUpperCase(), m])
  );
  const akuatikTarget = materials.find(
    (m) =>
      m.code === 'AKTIFITAS_AKUATIK' ||
      m.code === 'AKTIFITAS_AQUATIK' ||
      /aquatik|akuatik|renang/i.test(`${m.code} ${m.name}`)
  );

  let removedCount = 0;
  let updatedCount = 0;

  const dedupedMap = new Map<string, GradeRecord>();

  for (const raw of grades) {
    if (isSyntheticBackfillGrade(raw)) {
      removedCount += 1;
      continue;
    }
    if (studentIdSet.size > 0 && !studentIdSet.has(raw.studentId)) {
      removedCount += 1;
      continue;
    }

    const rawCode = String(raw.materialCode || '').trim();
    const rawUpper = rawCode.toUpperCase();
    let matchedMat = matByCode.get(rawUpper);
    if (!matchedMat) {
      const aliasUpper = resolveMaterialCodeAlias(rawUpper);
      matchedMat = matByCode.get(aliasUpper);
      if (
        !matchedMat &&
        akuatikTarget &&
        /aquatik|akuatik|renang/i.test(`${rawCode} ${raw.materialName || ''}`)
      ) {
        matchedMat = akuatikTarget;
      }
    }

    const finalCode = matchedMat ? matchedMat.code : rawCode;
    const finalName = matchedMat
      ? matchedMat.name
      : String(raw.materialName || rawCode).trim();
    const finalSemester = String(raw.semester || '').trim();

    const pScore =
      typeof raw.praktikScore === 'number' && Number.isFinite(raw.praktikScore)
        ? Math.max(0, Math.min(100, Math.round(raw.praktikScore)))
        : null;
    const kScore =
      typeof raw.pengetahuanScore === 'number' &&
      Number.isFinite(raw.pengetahuanScore)
        ? Math.max(0, Math.min(100, Math.round(raw.pengetahuanScore)))
        : null;

    if (
      finalCode !== raw.materialCode ||
      finalName !== raw.materialName ||
      finalSemester !== raw.semester ||
      pScore !== raw.praktikScore ||
      kScore !== raw.pengetahuanScore
    ) {
      updatedCount += 1;
    }

    const normalized: GradeRecord = {
      ...raw,
      semester: finalSemester,
      materialCode: finalCode,
      materialName: finalName,
      praktikScore: pScore,
      pengetahuanScore: kScore,
    };

    const key = `${normalized.studentId}::${normalized.semester}::${normalized.materialCode}`;
    const prev = dedupedMap.get(key);
    if (!prev) {
      dedupedMap.set(key, normalized);
    } else {
      removedCount += 1;
      const prevTs = prev.updatedAt ? Date.parse(prev.updatedAt) || 0 : 0;
      const nextTs = normalized.updatedAt
        ? Date.parse(normalized.updatedAt) || 0
        : 0;
      if (nextTs >= prevTs) {
        dedupedMap.set(key, normalized);
      }
    }
  }

  const dedupedList = Array.from(dedupedMap.values());
  const byStudentSem = new Map<string, GradeRecord[]>();
  for (const g of dedupedList) {
    const k = `${g.studentId}::${g.semester}`;
    const list = byStudentSem.get(k);
    if (list) list.push(g);
    else byStudentSem.set(k, [g]);
  }

  const reconciled: GradeRecord[] = [];
  for (const group of byStudentSem.values()) {
    const unifiedK = resolveUnifiedPengetahuanScore(group);
    for (const g of group) {
      let nextK = g.pengetahuanScore;
      let rowModified = false;
      if (unifiedK !== null && nextK !== unifiedK) {
        nextK = unifiedK;
        rowModified = true;
      }
      const autoDesc = buildAutoGradeDescription(
        g.praktikScore,
        nextK,
        g.materialName
      );
      let nextNote = g.teacherNote;
      if (autoDesc && isReplaceableAutoOrPlaceholderNote(g.teacherNote)) {
        if (g.teacherNote !== autoDesc) {
          nextNote = autoDesc;
          rowModified = true;
        }
      } else if (!nextNote) {
        nextNote =
          autoDesc ||
          'Silakan minta nilai dengan praktik atau tugas kepada guru PJOK.';
        if (nextNote !== g.teacherNote) {
          rowModified = true;
        }
      }

      if (rowModified) {
        updatedCount += 1;
        reconciled.push({
          ...g,
          pengetahuanScore: nextK,
          teacherNote: nextNote,
        });
      } else {
        reconciled.push(g);
      }
    }
  }

  return {
    grades: reconciled,
    changed: removedCount > 0 || updatedCount > 0,
    removedCount,
    updatedCount,
  };
}

export function stripSeedDefaultAttendance(
  attendance: AttendanceRecord[]
): { attendance: AttendanceRecord[]; removedCount: number } {
  const filtered = attendance.filter(
    (a) => typeof a.id !== 'string' || !/^att-stu-\d+-\d+$/.test(a.id)
  );
  return {
    attendance: filtered,
    removedCount: attendance.length - filtered.length,
  };
}

export function migrateLegacyGrades(grades: GradeRecord[]): GradeRecord[] {
  const out: GradeRecord[] = [];
  const seenKey = new Set<string>();
  for (const g of grades) {
    if (g.materialCode === 'KESEHATAN_P3K') {
      continue;
    }
    const mapped = LEGACY_MATERIAL_REMAP[g.materialCode];
    const nextCode = mapped ? mapped.code : g.materialCode;
    const nextName = mapped
      ? mapped.name
      : nextCode === 'ATLETIK'
        ? 'Atletik & Lari Sprint'
        : g.materialName;
    const dedupKey = `${g.studentId}::${g.semester}::${nextCode}`;
    if (seenKey.has(dedupKey)) continue;
    seenKey.add(dedupKey);
    out.push({
      ...g,
      materialCode: nextCode,
      materialName: nextName,
    });
  }
  return out;
}

export const DEFAULT_SEMESTERS = [
  'Ganjil 2025/2026',
  'Genap 2025/2026',
  'Ganjil 2026/2027',
];

export const DEFAULT_CLASSES = [
  'VII A',
  'VII B',
  'VII C',
  'VIII A',
  'VIII B',
  'VIII C',
  'IX A',
  'IX B',
  'IX C',
];

function classSortKey(cls: string): [number, string] {
  const trimmed = cls.trim().toUpperCase();
  if (/^IX(\b|\s|-|[A-Z0-9])/.test(trimmed)) return [9, trimmed];
  if (/^VIII(\b|\s|-|[A-Z0-9])/.test(trimmed)) return [8, trimmed];
  if (/^VII(\b|\s|-|[A-Z0-9])/.test(trimmed)) return [7, trimmed];
  const numMatch = /^(\d+)/.exec(trimmed);
  if (numMatch) return [Number(numMatch[1]), trimmed];
  return [99, trimmed];
}

export function extractActiveClasses(
  students: Array<{ className?: string }>
): string[] {
  const set = new Set<string>();
  students.forEach((s) => {
    const cls = s.className?.trim();
    if (cls) set.add(cls);
  });
  return Array.from(set).sort((a, b) => {
    const [numA, textA] = classSortKey(a);
    const [numB, textB] = classSortKey(b);
    if (numA !== numB) return numA - numB;
    return textA.localeCompare(textB, 'id', { numeric: true });
  });
}

function clampScore(value: number): number {
  return Math.max(40, Math.min(99, Math.round(value)));
}

export function computeAttendanceRate(attendance: AttendanceRecord[]): number {
  if (attendance.length === 0) return 0;
  const totalPoints = attendance.reduce((acc, rec) => {
    if (rec.status === 'Hadir') return acc + 100;
    if (rec.status === 'Terlambat') return acc + 85;
    if (rec.status === 'Izin' || rec.status === 'Sakit') return acc + 78;
    return acc + 0; // Alpa
  }, 0);
  return Math.round(totalPoints / attendance.length);
}

function buildMaterialAbbreviation(
  code: string,
  name: string,
  usedAbbrs: Set<string>
): string {
  const canonical = resolveMaterialCodeAlias(code);
  const presetMap: Record<string, string> = {
    ATLETIK: 'ATL',
    BOLA_BASKET: 'PBB',
    BOLA_VOLI: 'PBV',
    SEPAK_BOLA_FUTSAL: 'PBS',
    KEBUGARAN_TKJ: 'TKJ',
    SENAM_IRAMA: 'SNI',
    BULU_TANGKIS: 'BLT',
    AKTIFITAS_AKUATIK: 'RNG',
  };
  if (presetMap[canonical] && !usedAbbrs.has(presetMap[canonical])) {
    usedAbbrs.add(presetMap[canonical]);
    return presetMap[canonical];
  }

  const words = `${name} ${code}`
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let base =
    words.length >= 3
      ? `${words[0][0]}${words[1][0]}${words[2][0]}`
      : (words.join('').replace(/[AEIOU]/g, '').slice(0, 3) ||
        words.join('').slice(0, 3) ||
        'MAT');
  base = base.padEnd(3, 'X').slice(0, 3);
  if (!usedAbbrs.has(base)) {
    usedAbbrs.add(base);
    return base;
  }
  for (let i = 2; i <= 9; i++) {
    const candidate = `${base.slice(0, 2)}${i}`;
    if (!usedAbbrs.has(candidate)) {
      usedAbbrs.add(candidate);
      return candidate;
    }
  }
  return base;
}

export function computeFutStats(
  student: StudentRecord,
  grades: GradeRecord[],
  attendance: AttendanceRecord[],
  targetSemester?: string,
  materials?: Array<{ code: string; name: string }>
): FutCardStats {
  const scopedGrades = targetSemester
    ? grades.filter((g) => g.semester === targetSemester)
    : grades;
  const effectiveGrades = targetSemester ? scopedGrades : grades;

  const praktikScores = effectiveGrades
    .map((g) => g.praktikScore)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  const pengetahuanScores = effectiveGrades
    .map((g) => g.pengetahuanScore)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

  const hasPraktik = praktikScores.length > 0;
  const hasPengetahuan = pengetahuanScores.length > 0;

  const avgPraktik = hasPraktik
    ? Math.round(
        praktikScores.reduce((sum, v) => sum + v, 0) / praktikScores.length
      )
    : 0;

  const avgPengetahuan = hasPengetahuan
    ? Math.round(
        pengetahuanScores.reduce((sum, v) => sum + v, 0) /
          pengetahuanScores.length
      )
    : 0;

  const avgTotal =
    hasPraktik && hasPengetahuan
      ? Math.round((avgPraktik + avgPengetahuan) / 2)
      : hasPraktik
        ? avgPraktik
        : hasPengetahuan
          ? avgPengetahuan
          : 0;
  const attendanceRate = computeAttendanceRate(attendance);

  const findMaterial = (...codes: string[]) => {
    const normalizedTargets = new Set(
      codes.map((c) => resolveMaterialCodeAlias(c))
    );
    for (const code of codes) {
      const upper = code.trim().toUpperCase();
      const found = effectiveGrades.find(
        (g) =>
          g.materialCode.trim().toUpperCase() === upper &&
          typeof g.praktikScore === 'number'
      );
      if (found) return found;
    }
    return effectiveGrades.find(
      (g) =>
        normalizedTargets.has(resolveMaterialCodeAlias(g.materialCode)) &&
        typeof g.praktikScore === 'number'
    );
  };

  const averageScores = (
    scores: Array<number | null | undefined>,
    fallback: number
  ) => {
    const valid = scores.filter((v): v is number => typeof v === 'number');
    return valid.length > 0
      ? valid.reduce((sum, v) => sum + v, 0) / valid.length
      : fallback;
  };

  const atletik = findMaterial('ATLETIK')?.praktikScore ?? avgPraktik;
  const kebugaran =
    findMaterial('KEBUGARAN_TKJ', 'KEBUGARAN')?.praktikScore ?? avgPraktik;
  const bolaBasket = findMaterial('BOLA_BASKET', 'BOLA_BESAR')?.praktikScore;
  const bolaVoli = findMaterial('BOLA_VOLI')?.praktikScore;
  const sepakBola = findMaterial('SEPAK_BOLA_FUTSAL')?.praktikScore;
  const bolaBesar = averageScores(
    [bolaBasket, bolaVoli, sepakBola],
    avgPraktik
  );
  const buluTangkis =
    findMaterial('BULU_TANGKIS', 'BOLA_KECIL')?.praktikScore ?? avgPraktik;
  const senam =
    findMaterial('SENAM_IRAMA', 'SENAM')?.praktikScore ?? avgPraktik;
  const akuatik =
    findMaterial(
      'AKTIFITAS_AQUATIK',
      'AKTIFITAS_AKUATIK',
      'AKUATIK',
      'AQUATIK',
      'RENANG'
    )?.praktikScore ?? avgPraktik;

  const alpaCount = attendance.filter((a) => a.status === 'Alpa').length;

  const kec = clampScore(atletik * 0.65 + kebugaran * 0.35);
  const ket = clampScore(
    kebugaran * 0.45 + akuatik * 0.15 + attendanceRate * 0.4
  );
  const tek = clampScore(
    (bolaBesar + buluTangkis + senam + atletik + akuatik) / 5
  );
  const tak = clampScore(avgPengetahuan);
  const dis = clampScore(attendanceRate - alpaCount * 4);
  const spo = clampScore(
    ((bolaBesar + buluTangkis) / 2) * 0.5 + attendanceRate * 0.5 - alpaCount * 3
  );

  const ovr = clampScore(
    tek * 0.25 +
      tak * 0.2 +
      kec * 0.15 +
      ket * 0.15 +
      dis * 0.15 +
      spo * 0.1
  );

  const tier: FutCardStats['tier'] =
    ovr >= 88 ? 'GOLD' : ovr >= 80 ? 'SILVER' : 'BRONZE';
  const tierLabel =
    tier === 'GOLD'
      ? 'Emas Juara'
      : tier === 'SILVER'
        ? 'Perak Unggul'
        : 'Perunggu Binaan';

  const sportMap: Record<string, { code: string; label: string }> = {
    'Sepak Bola': { code: 'ST', label: 'Sepak Bola & Futsal' },
    Atletik: { code: 'SPR', label: 'Atletik & Sprint' },
    Bulutangkis: { code: 'BDM', label: 'Bulutangkis' },
    'Bola Basket': { code: 'PG', label: 'Bola Basket' },
    'Bola Voli': { code: 'SPK', label: 'Bola Voli' },
    'Pencak Silat': { code: 'SLT', label: 'Pencak Silat' },
    Renang: { code: 'AQ', label: 'Aktifitas Aquatik' },
    'Aktifitas Aquatik': { code: 'AQ', label: 'Aktifitas Aquatik' },
  };

  const mappedPos = sportMap[student.primarySportInterest] ?? {
    code: 'ATL',
    label: student.primarySportInterest || 'Multisport',
  };

  const baseMaterialList: Array<{ code: string; name: string }> =
    materials && materials.length > 0
      ? materials.map((m) => ({ code: m.code, name: m.name }))
      : PJOK_MATERIALS.map((m) => ({ code: m.code, name: m.name }));

  const seenCanonicalCodes = new Set<string>(
    baseMaterialList.map((m) => resolveMaterialCodeAlias(m.code))
  );
  const combinedMaterialList = [...baseMaterialList];
  effectiveGrades.forEach((g) => {
    const canonical = resolveMaterialCodeAlias(g.materialCode);
    if (!seenCanonicalCodes.has(canonical)) {
      seenCanonicalCodes.add(canonical);
      combinedMaterialList.push({
        code: g.materialCode,
        name: g.materialName || g.materialCode,
      });
    }
  });

  const namePatternsByCanonical: Record<string, RegExp> = {
    ATLETIK: /atletik|sprint/i,
    BOLA_BASKET: /basket/i,
    BOLA_VOLI: /voli/i,
    SEPAK_BOLA_FUTSAL: /sepak|futsal/i,
    KEBUGARAN_TKJ: /kebugaran|tkj/i,
    SENAM_IRAMA: /senam/i,
    BULU_TANGKIS: /bulu\s*tangkis|badminton/i,
    AKTIFITAS_AKUATIK: /aquatik|akuatik|renang/i,
  };

  const findMatchedGradeForMaterial = (mat: {
    code: string;
    name: string;
  }): GradeRecord | undefined => {
    const upperCode = mat.code.trim().toUpperCase();
    const canonical = resolveMaterialCodeAlias(upperCode);
    const exactMatch = effectiveGrades.find(
      (g) => g.materialCode.trim().toUpperCase() === upperCode
    );
    if (exactMatch) return exactMatch;

    const aliasMatch = effectiveGrades.find(
      (g) => resolveMaterialCodeAlias(g.materialCode) === canonical
    );
    if (aliasMatch) return aliasMatch;

    const pattern = namePatternsByCanonical[canonical];
    if (pattern) {
      return effectiveGrades.find((g) =>
        pattern.test(`${g.materialCode} ${g.materialName}`)
      );
    }
    return undefined;
  };

  const usedAbbrs = new Set<string>();
  const materialScores = combinedMaterialList.map((mat) => {
    const matched = findMatchedGradeForMaterial(mat);
    const pScore =
      matched &&
      typeof matched.praktikScore === 'number' &&
      !Number.isNaN(matched.praktikScore)
        ? Math.round(matched.praktikScore)
        : null;
    const kScore =
      matched &&
      typeof matched.pengetahuanScore === 'number' &&
      !Number.isNaN(matched.pengetahuanScore)
        ? Math.round(matched.pengetahuanScore)
        : null;
    const avgScore =
      pScore !== null && kScore !== null
        ? Math.round((pScore + kScore) / 2)
        : (pScore ?? kScore);
    const score = pScore !== null ? pScore : kScore;
    const scoreSource: 'praktik' | 'pengetahuan' | null =
      pScore !== null ? 'praktik' : kScore !== null ? 'pengetahuan' : null;

    return {
      code: mat.code,
      abbr: buildMaterialAbbreviation(mat.code, mat.name, usedAbbrs),
      name: mat.name,
      score,
      praktikScore: pScore,
      pengetahuanScore: kScore,
      avgScore,
      scoreSource,
    };
  });

  const scoredPracticeMaterials = effectiveGrades
    .filter(
      (g): g is typeof g & { praktikScore: number } =>
        typeof g.praktikScore === 'number' && !Number.isNaN(g.praktikScore)
    )
    .sort((a, b) => b.praktikScore - a.praktikScore);

  const scoredPengetahuanMaterials = effectiveGrades
    .filter(
      (g): g is typeof g & { pengetahuanScore: number } =>
        typeof g.pengetahuanScore === 'number' &&
        !Number.isNaN(g.pengetahuanScore)
    )
    .sort((a, b) => b.pengetahuanScore - a.pengetahuanScore);

  const topPractice = scoredPracticeMaterials[0] ?? null;
  const topPengetahuan = scoredPengetahuanMaterials[0] ?? null;
  const bestMaterialName =
    topPractice?.materialName ?? topPengetahuan?.materialName;
  const bestMaterialScore =
    topPractice?.praktikScore ?? topPengetahuan?.pengetahuanScore ?? null;

  return {
    ovr,
    tier,
    tierLabel,
    positionCode: mappedPos.code,
    positionLabel: mappedPos.label,
    kec,
    ket,
    tek,
    tak,
    dis,
    spo,
    attendanceRate,
    avgPraktik,
    avgPengetahuan,
    avgTotal,
    bestMaterialName,
    bestMaterialScore,
    materialScores,
  };
}

export function analyzeTalent(
  student: StudentRecord,
  grades: GradeRecord[],
  attendance: AttendanceRecord[],
  futStats: FutCardStats
): TalentRecommendation {
  const sportScore = Math.round(
    futStats.tek * 0.4 + futStats.kec * 0.3 + futStats.ket * 0.3
  );
  const academicScore = Math.round(
    futStats.tak * 0.75 + futStats.dis * 0.25
  );
  const nonAcademicScore = Math.round(
    futStats.dis * 0.55 + futStats.spo * 0.45
  );

  const activeGrades = grades.filter((g) => typeof g.praktikScore === 'number');
  const topPractice = [...activeGrades].sort(
    (a, b) => (b.praktikScore ?? 0) - (a.praktikScore ?? 0)
  )[0];

  let primaryTrack: TalentRecommendation['primaryTrack'] = 'Bidang Olahraga';
  let recommendedBranch = `Tim ${student.primarySportInterest || 'Olahraga Prestasi'} SMPN 2 Ciamis`;
  let summary = '';
  const actionPlan: string[] = [];

  if (sportScore >= academicScore && sportScore >= nonAcademicScore) {
    primaryTrack = 'Bidang Olahraga';
    const bestMat = topPractice?.materialName ?? student.primarySportInterest;
    recommendedBranch = `Pembinaan Prestasi ${student.primarySportInterest} & POPDA Kab. Ciamis`;
    summary = `Menunjukkan dominasi keterampilan motorik dan teknik praktik (${futStats.tek}) terutama pada ${bestMat} dengan daya tahan fisik ${futStats.ket}.`;
    actionPlan.push(
      `Daftarkan ke tim inti ekstrakurikuler ${student.primarySportInterest} SMPN 2 Ciamis.`,
      'Jadwalkan program latihan kecepatan dan kelincahan 2x seminggu bersama pelatih.',
      'Persiapkan seleksi O2SN / POPDA tingkat Kabupaten Ciamis.'
    );
  } else if (academicScore >= sportScore && academicScore >= nonAcademicScore) {
    primaryTrack = 'Bidang Akademik Olahraga';
    recommendedBranch = 'Olimpiade Sains Kesehatan, UKS & Analisis Taktik';
    summary = `Memiliki penguasaan teori PJOK, anatomi kebugaran, dan regulasi permainan yang sangat kuat (${futStats.tak}) serta konsistensi belajar tinggi.`;
    actionPlan.push(
      'Rekomendasikan sebagai Koordinator Materi & Duta Kesehatan Sekolah (UKS/PMR).',
      'Libatkan dalam lomba cerdas cermat kesehatan remaja & P3K tingkat kabupaten.',
      'Pertahankan skor praktik melalui latihan kebugaran rutin.'
    );
  } else {
    primaryTrack = 'Bidang Non-Akademik & Kepemimpinan';
    recommendedBranch = `Kepemimpinan ${student.nonAcademicActivity || 'OSIS / Paskibra'} & Kapten Regu`;
    summary = `Kedisiplinan (${futStats.dis}%) dan sportivitas tim (${futStats.spo}) sangat menonjol. Berbakat kuat memimpin kelompok dan organisasi siswa.`;
    actionPlan.push(
      `Berikan amanah sebagai Kapten Tim / Koordinator Lapangan di kelas ${student.className}.`,
      `Salurkan minat ke organisasi ${student.nonAcademicActivity || 'OSIS / Paskibra'} SMPN 2 Ciamis.`,
      'Kembangkan kemampuan manajemen event olahraga antar kelas (Classmeeting).'
    );
  }

  return {
    primaryTrack,
    sportScore,
    academicScore,
    nonAcademicScore,
    recommendedBranch,
    summary,
    actionPlan,
  };
}

export function isFactorySeedGrade(
  g: Pick<GradeRecord, 'id' | 'updatedAt'>
): boolean {
  return (
    typeof g.id === 'string' &&
    g.id.startsWith('grd-stu-') &&
    g.updatedAt === '2026-11-19T08:30:00.000Z'
  );
}

function getStudentPayloadSignals(payload: StudentPortalPayload) {
  const nonSeedGrades = payload.grades.filter(
    (g) =>
      !isFactorySeedGrade(g) &&
      (typeof g.praktikScore === 'number' ||
        typeof g.pengetahuanScore === 'number')
  );
  const anyNumericGrades = payload.grades.filter(
    (g) =>
      typeof g.praktikScore === 'number' ||
      typeof g.pengetahuanScore === 'number'
  );
  const gradePool = nonSeedGrades.length > 0 ? nonSeedGrades : anyNumericGrades;
  let maxGradeTs = 0;
  for (const g of gradePool) {
    const ts = g.updatedAt ? Date.parse(g.updatedAt) || 0 : 0;
    if (ts > maxGradeTs) maxGradeTs = ts;
  }

  let maxAttTs = 0;
  for (const a of payload.attendance) {
    const ts = a.date ? Date.parse(`${a.date}T${a.time || '00:00:00'}`) || 0 : 0;
    if (ts > maxAttTs) maxAttTs = ts;
  }

  let maxNotifTs = 0;
  for (const n of payload.notifications) {
    const ts = n.createdAt ? Date.parse(n.createdAt) || 0 : 0;
    if (ts > maxNotifTs) maxNotifTs = ts;
  }

  return {
    hasRealGrades: nonSeedGrades.length > 0,
    realCount: nonSeedGrades.length,
    totalNumericCount: anyNumericGrades.length,
    totalCount: payload.grades.length,
    maxGradeTs,
    attCount: payload.attendance.length,
    maxAttTs,
    maxNotifTs,
  };
}

/**
 * Picks the fresher StudentPortalPayload across server and Cloud Firestore sources.
 * Prioritizes real non-factory-seed grades and grade update timestamps so stale
 * attendance/notification timestamps on an unsynced server never override real grades.
 * Ties break in favor of `primary`.
 */
export function pickFresherStudentPayload(
  primary: StudentPortalPayload | null,
  secondary: StudentPortalPayload | null
): StudentPortalPayload | null {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const a = getStudentPayloadSignals(primary);
  const b = getStudentPayloadSignals(secondary);

  if (a.hasRealGrades !== b.hasRealGrades) {
    return a.hasRealGrades ? primary : secondary;
  }

  if (a.maxGradeTs > b.maxGradeTs + 1000) return primary;
  if (b.maxGradeTs > a.maxGradeTs + 1000) return secondary;

  if (a.realCount !== b.realCount) {
    return a.realCount > b.realCount ? primary : secondary;
  }
  if (a.totalNumericCount !== b.totalNumericCount) {
    return a.totalNumericCount > b.totalNumericCount ? primary : secondary;
  }
  if (a.totalCount !== b.totalCount) {
    return a.totalCount > b.totalCount ? primary : secondary;
  }

  if (a.attCount !== b.attCount) {
    return a.attCount > b.attCount ? primary : secondary;
  }
  if (a.maxAttTs !== b.maxAttTs) {
    return a.maxAttTs > b.maxAttTs ? primary : secondary;
  }
  if (a.maxNotifTs > b.maxNotifTs + 1000) return primary;
  if (b.maxNotifTs > a.maxNotifTs + 1000) return secondary;

  return primary;
}
