import { signInWithPopup, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { cacheResolvedMedia } from '../components/CloudImage.tsx';
import type {
  AdminDashboardPayload,
  AdminStudentSummary,
  AttendanceRecord,
  GradeRecord,
  MaterialCode,
  MaterialDefinition,
  NotificationRecord,
  PublicOverviewResponse,
  SchoolSettings,
  StudentPortalPayload,
  StudentRecord,
  TopStudentOverviewItem,
} from '../types.ts';
import {
  DEFAULT_CLASS_KKM,
  DEFAULT_SEED_SCORE,
  DEFAULT_SEMESTERS,
  PJOK_MATERIALS,
  analyzeTalent,
  computeAttendanceRate,
  computeFutStats,
  extractActiveClasses,
  hasLegacyDefaultMaterials,
  isLegacy18SeedStudents,
  isOldDeterministicSeedGrades,
  isOutdatedDefaultMaterials,
  isPrevious7DefaultMaterials,
  migrateLegacyGrades,
  normalizeClassKkmMap,
  reconcileAllGradesConsistency,
  stripSeedDefaultAttendance,
} from '../utils/athleteAnalytics.ts';
import { buildAutoGradeDescription } from '../utils/gradeDescription.ts';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  sanitizeFirestoreId,
  sha256Hex,
} from './firebase.ts';

export const AUTHORIZED_ADMIN_EMAIL = 'galihcipta22@gmail.com';
const DEFAULT_KKM = 78;
const LEGACY_TEACHER_NIP = '19920514 201903 1 008';
const CURRENT_TEACHER_NIP = '19890526 202221 1 006';
const FIRESTORE_BATCH_LIMIT = 180;

function isNonRetryableFirestoreError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /permission-denied|insufficient permissions|unauthenticated|resource-exhausted|quota|invalid-argument|not-found|already-exists/i.test(
    msg
  );
}

async function withCloudRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isNonRetryableFirestoreError(err) || attempt === maxAttempts) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        /unavailable|deadline-exceeded|aborted|internal|network|failed to fetch|offline|timeout|reset/i.test(
          msg
        );
      if (!isTransient) {
        throw err;
      }
      console.warn(
        `Cloud Firestore transient retry (${attempt}/${maxAttempts}) [${label}]:`,
        msg
      );
      await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
    }
  }
  throw lastError;
}

function clampOptionalScore(val: number | null | undefined): number | null {
  return typeof val === 'number' && Number.isFinite(val)
    ? Math.max(0, Math.min(100, Math.round(val)))
    : null;
}

function normalizeTeacherNip(nip: unknown): string {
  const value = String(nip ?? '');
  return value === LEGACY_TEACHER_NIP ? CURRENT_TEACHER_NIP : value;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v;
  });
  return out as T;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(
    val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      Object.getPrototypeOf(val) === Object.prototype
  );
}

function stableEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!stableEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).filter((k) => a[k] !== undefined);
    const bKeys = Object.keys(b).filter((k) => b[k] !== undefined);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!stableEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

export function isFirebaseAdminReady(): boolean {
  const user = auth.currentUser;
  return Boolean(
    user &&
      user.emailVerified &&
      user.email?.toLowerCase() === AUTHORIZED_ADMIN_EMAIL
  );
}

export async function signInAdminWithGoogle(
  displayName = 'Galih Cipta Setia, S.Pd.'
): Promise<{ uid: string; email: string }> {
  const current = auth.currentUser;
  let user = current;
  if (
    !user ||
    !user.emailVerified ||
    user.email?.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL
  ) {
    const cred = await signInWithPopup(auth, googleProvider);
    user = cred.user;
  }

  if (!user || !user.email) {
    throw new Error('Login Google tidak mengembalikan alamat email.');
  }
  if (!user.emailVerified) {
    throw new Error('Email akun Google belum terverifikasi.');
  }
  if (user.email.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL) {
    await signOut(auth);
    throw new Error(
      `Akun ${user.email} bukan admin guru PJOK terdaftar (${AUTHORIZED_ADMIN_EMAIL}).`
    );
  }

  // Ensure /admins/{uid} document exists
  const adminRef = doc(db, 'admins', user.uid);
  try {
    const snap = await getDoc(adminRef);
    if (!snap.exists()) {
      await setDoc(adminRef, {
        uid: user.uid,
        email: user.email,
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(adminRef, {
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `admins/${user.uid}`);
  }

  return { uid: user.uid, email: user.email };
}

export async function signOutFirebase(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}

export async function uploadMediaAssetIfDataUrl(
  rawUrl: string | undefined,
  kind: 'photo' | 'qr' | 'logo' | 'hero'
): Promise<string> {
  const value = (rawUrl ?? '').trim();
  if (!value) return '';
  if (!value.startsWith('data:')) return value;

  if (value.length > 470000) {
    throw new Error(
      'Ukuran file gambar melebihi batas aman penyimpanan cloud (maksimal ~350KB setelah kompresi). Gunakan gambar beresolusi lebih kecil.'
    );
  }

  const user = auth.currentUser;
  if (!user) return value;

  const mimeMatch = /^data:([^;]+);base64,/.exec(value);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const digest = await sha256Hex(`${kind}:${value}`);
  const assetId = sanitizeFirestoreId(`asset-${kind}-${digest.slice(0, 24)}`);
  const mediaRef = `firestore-media://${assetId}`;
  cacheResolvedMedia(mediaRef, value);

  const ref = doc(db, 'media_assets', assetId);
  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        id: assetId,
        kind,
        mimeType,
        dataUrl: value,
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `media_assets/${assetId}`);
  }

  return mediaRef;
}

const DEFAULT_HERO_IMAGE_URL =
  '/src/assets/images/hero_sports_arena_1794923888842.jpg';

function buildPublicSettings(
  settings: SchoolSettings,
  includeHero = true
): SchoolSettings {
  const base: SchoolSettings = {
    schoolName: settings.schoolName,
    teacherName: settings.teacherName,
    teacherNip: settings.teacherNip || '',
    schoolAddress: settings.schoolAddress || '',
    activeSemester: settings.activeSemester,
    logoUrl: settings.logoUrl || '',
    whatsappGatewayUrl: '',
    whatsappGatewayToken: '',
    socialLinks: {
      instagram: settings.socialLinks?.instagram || '',
      youtube: settings.socialLinks?.youtube || '',
      facebook: settings.socialLinks?.facebook || '',
      tiktok: settings.socialLinks?.tiktok || '',
    },
  };
  if (includeHero) {
    base.heroImageUrl = settings.heroImageUrl?.trim() || DEFAULT_HERO_IMAGE_URL;
  }
  return base;
}

function computeOverviewSnapshot(params: {
  settings: SchoolSettings;
  students: StudentRecord[];
  grades: GradeRecord[];
  attendance: AttendanceRecord[];
  materials: MaterialDefinition[];
  semesters: string[];
  semesterKkm: Record<string, number>;
  classKkm: Record<string, number>;
  availableClasses: string[];
  selectedClass: string;
  selectedSemester: string;
}): PublicOverviewResponse {
  const {
    settings,
    students,
    grades,
    attendance,
    materials,
    semesters,
    semesterKkm,
    classKkm,
    availableClasses,
    selectedClass,
    selectedSemester,
  } = params;

  const filteredStudents =
    selectedClass === 'Semua Kelas'
      ? students
      : students.filter((s) => s.className === selectedClass);
  const filteredIds = new Set(filteredStudents.map((s) => s.id));

  const studentComposites: number[] = [];
  const studentPraktiks: number[] = [];
  const studentPengetahuans: number[] = [];

  filteredStudents.forEach((student) => {
    const sGrades = grades.filter(
      (g) => g.studentId === student.id && g.semester === selectedSemester
    );
    const pVals = sGrades
      .map((g) => g.praktikScore)
      .filter((v): v is number => typeof v === 'number');
    const kVals = sGrades
      .map((g) => g.pengetahuanScore)
      .filter((v): v is number => typeof v === 'number');
    if (pVals.length > 0 && kVals.length > 0) {
      const avgP = pVals.reduce((sum, v) => sum + v, 0) / pVals.length;
      const avgK = kVals.reduce((sum, v) => sum + v, 0) / kVals.length;
      studentPraktiks.push(avgP);
      studentPengetahuans.push(avgK);
      studentComposites.push((avgP + avgK) / 2);
    } else if (pVals.length > 0 || kVals.length > 0) {
      const avgP = pVals.length
        ? pVals.reduce((sum, v) => sum + v, 0) / pVals.length
        : 0;
      const avgK = kVals.length
        ? kVals.reduce((sum, v) => sum + v, 0) / kVals.length
        : 0;
      if (pVals.length) studentPraktiks.push(avgP);
      if (kVals.length) studentPengetahuans.push(avgK);
      studentComposites.push(
        pVals.length && kVals.length ? (avgP + avgK) / 2 : avgP || avgK
      );
    }
  });

  const highestScore =
    studentComposites.length > 0
      ? Math.round(Math.max(...studentComposites) * 10) / 10
      : 0;
  const lowestScore =
    studentComposites.length > 0
      ? Math.round(Math.min(...studentComposites) * 10) / 10
      : 0;
  const averageScore =
    studentComposites.length > 0
      ? Math.round(
          (studentComposites.reduce((a, b) => a + b, 0) /
            studentComposites.length) *
            10
        ) / 10
      : 0;
  const averagePraktik =
    studentPraktiks.length > 0
      ? Math.round(
          (studentPraktiks.reduce((a, b) => a + b, 0) /
            studentPraktiks.length) *
            10
        ) / 10
      : 0;
  const averagePengetahuan =
    studentPengetahuans.length > 0
      ? Math.round(
          (studentPengetahuans.reduce((a, b) => a + b, 0) /
            studentPengetahuans.length) *
            10
        ) / 10
      : 0;

  const scopedAttendance = attendance.filter((a) =>
    filteredIds.has(a.studentId)
  );
  const attendanceRate = computeAttendanceRate(scopedAttendance);

  const semesterHistory = semesters.map((semester) => {
    const sGrades = grades.filter(
      (g) => g.semester === semester && filteredIds.has(g.studentId)
    );
    const pVals = sGrades
      .map((g) => g.praktikScore)
      .filter((v): v is number => typeof v === 'number');
    const kVals = sGrades
      .map((g) => g.pengetahuanScore)
      .filter((v): v is number => typeof v === 'number');
    if (pVals.length === 0 && kVals.length === 0) {
      return { semester, avgPraktik: 0, avgPengetahuan: 0, avgTotal: 0 };
    }
    const avgP = pVals.length
      ? Math.round(pVals.reduce((sum, v) => sum + v, 0) / pVals.length)
      : 0;
    const avgK = kVals.length
      ? Math.round(kVals.reduce((sum, v) => sum + v, 0) / kVals.length)
      : 0;
    return {
      semester,
      avgPraktik: avgP,
      avgPengetahuan: avgK,
      avgTotal: Math.round((avgP + avgK) / 2),
    };
  });

  const classComparison = availableClasses.map((cls) => {
    const clsStudents = students.filter((s) => s.className === cls);
    const clsComposites: number[] = [];
    const clsPraktiks: number[] = [];
    const clsK: number[] = [];
    clsStudents.forEach((st) => {
      const stGrades = grades.filter(
        (g) => g.studentId === st.id && g.semester === selectedSemester
      );
      const pVals = stGrades
        .map((g) => g.praktikScore)
        .filter((v): v is number => typeof v === 'number');
      const kVals = stGrades
        .map((g) => g.pengetahuanScore)
        .filter((v): v is number => typeof v === 'number');
      if (pVals.length > 0 || kVals.length > 0) {
        const p = pVals.length
          ? pVals.reduce((a, b) => a + b, 0) / pVals.length
          : 0;
        const k = kVals.length
          ? kVals.reduce((a, b) => a + b, 0) / kVals.length
          : 0;
        if (pVals.length) clsPraktiks.push(p);
        if (kVals.length) clsK.push(k);
        clsComposites.push(
          pVals.length && kVals.length ? (p + k) / 2 : p || k
        );
      }
    });
    return {
      className: cls,
      avgPraktik:
        clsPraktiks.length > 0
          ? Math.round(
              clsPraktiks.reduce((a, b) => a + b, 0) / clsPraktiks.length
            )
          : 0,
      avgPengetahuan:
        clsK.length > 0
          ? Math.round(clsK.reduce((a, b) => a + b, 0) / clsK.length)
          : 0,
      highest:
        clsComposites.length > 0 ? Math.round(Math.max(...clsComposites)) : 0,
      lowest:
        clsComposites.length > 0 ? Math.round(Math.min(...clsComposites)) : 0,
      studentCount: clsStudents.length,
    };
  }).filter((c) => c.studentCount > 0);

  const materialBreakdown = materials.map((mat) => {
    const mGrades = grades.filter(
      (g) =>
        g.semester === selectedSemester &&
        g.materialCode === mat.code &&
        filteredIds.has(g.studentId)
    );
    const pVals = mGrades
      .map((g) => g.praktikScore)
      .filter((v): v is number => typeof v === 'number');
    const kVals = mGrades
      .map((g) => g.pengetahuanScore)
      .filter((v): v is number => typeof v === 'number');
    return {
      materialCode: mat.code,
      materialName: mat.name,
      avgPraktik:
        pVals.length > 0
          ? Math.round(pVals.reduce((s, v) => s + v, 0) / pVals.length)
          : 0,
      avgPengetahuan:
        kVals.length > 0
          ? Math.round(kVals.reduce((s, v) => s + v, 0) / kVals.length)
          : 0,
    };
  });

  const buildTop5ForMaterial = (matCode: string): TopStudentOverviewItem[] => {
    return filteredStudents
      .map((stu) => {
        const stuGrades = grades.filter(
          (g) =>
            g.studentId === stu.id &&
            g.semester === selectedSemester &&
            (matCode === 'ALL' || g.materialCode === matCode)
        );
        const pVals = stuGrades
          .map((g) => g.praktikScore)
          .filter((v): v is number => typeof v === 'number');
        const kVals = stuGrades
          .map((g) => g.pengetahuanScore)
          .filter((v): v is number => typeof v === 'number');
        if (matCode === 'ALL') {
          if (pVals.length === 0 && kVals.length === 0) return null;
        } else if (pVals.length === 0 && !kVals.some((v) => v > 0)) {
          return null;
        }

        const avgP = pVals.length
          ? Math.round(
              (pVals.reduce((sum, v) => sum + v, 0) / pVals.length) * 10
            ) / 10
          : null;
        const avgK = kVals.length
          ? Math.round(
              (kVals.reduce((sum, v) => sum + v, 0) / kVals.length) * 10
            ) / 10
          : null;
        const avgCombined =
          avgP !== null && avgK !== null
            ? Math.round(((avgP + avgK) / 2) * 10) / 10
            : (avgP ?? avgK);
        if (avgCombined === null) return null;

        const bestMatGrade = [...stuGrades]
          .map((g) => {
            const p = g.praktikScore;
            const k = g.pengetahuanScore;
            const mAvg =
              p !== null && k !== null ? (p + k) / 2 : (p ?? k ?? -1);
            return { name: g.materialName, mAvg };
          })
          .sort((a, b) => b.mAvg - a.mAvg)[0];

        const firstName = stu.name.split(' ')[0];
        return {
          name: stu.name,
          shortName:
            firstName.length > 10 ? `${firstName.slice(0, 9)}.` : firstName,
          className: stu.className,
          avgPraktik: avgP,
          avgPengetahuan: avgK,
          avgCombined,
          bestMaterialName:
            bestMatGrade && bestMatGrade.mAvg >= 0 ? bestMatGrade.name : '-',
        };
      })
      .filter((item): item is TopStudentOverviewItem => item !== null)
      .sort(
        (a, b) =>
          b.avgCombined - a.avgCombined ||
          (b.avgPraktik ?? 0) - (a.avgPraktik ?? 0) ||
          (b.avgPengetahuan ?? 0) - (a.avgPengetahuan ?? 0)
      )
      .slice(0, 5);
  };

  const top5ByMaterial: Record<string, TopStudentOverviewItem[]> = {
    ALL: buildTop5ForMaterial('ALL'),
  };
  materials.forEach((mat) => {
    top5ByMaterial[mat.code] = buildTop5ForMaterial(mat.code);
  });

  return {
    settings: buildPublicSettings(settings),
    availableClasses,
    availableSemesters: semesters,
    semesterKkm,
    classKkm,
    availableMaterials: materials.map((m) => ({
      code: m.code as MaterialCode,
      name: m.name,
    })),
    selectedClass,
    selectedSemester,
    summary: {
      totalStudents: filteredStudents.length,
      highestScore,
      lowestScore,
      averageScore,
      averagePraktik,
      averagePengetahuan,
      attendanceRate,
    },
    semesterHistory,
    classComparison,
    materialBreakdown,
    top5ByMaterial,
  };
}

function buildStudentReportPayload(params: {
  student: StudentRecord;
  settings: SchoolSettings;
  grades: GradeRecord[];
  attendance: AttendanceRecord[];
  notifications: NotificationRecord[];
  semesters: string[];
  semesterKkm: Record<string, number>;
  classKkm: Record<string, number>;
  materials: MaterialDefinition[];
}): StudentPortalPayload {
  const {
    student,
    settings,
    grades,
    attendance,
    notifications,
    semesters,
    semesterKkm,
    classKkm,
    materials,
  } = params;

  const sGrades = grades.filter((g) => g.studentId === student.id);
  const sAttendance = attendance
    .filter((a) => a.studentId === student.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((a) => ({
      id: a.id,
      studentId: a.studentId,
      date: a.date,
      time: a.time,
      status: a.status,
      method: a.method,
      whatsappNotified: Boolean(a.whatsappNotified),
      whatsappMessage: '',
    }));
  const sNotifs = notifications
    .filter((n) => n.studentId === student.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((n) => ({
      id: n.id,
      studentId: n.studentId,
      targetRole: n.targetRole,
      type: n.type,
      title: n.title,
      message: n.message,
      isRead: Boolean(n.isRead),
      whatsappSent: Boolean(n.whatsappSent),
      createdAt: n.createdAt,
    }));

  const activeSem = settings.activeSemester || semesters[0] || '';
  const futStats = computeFutStats(
    student,
    sGrades,
    sAttendance,
    activeSem,
    materials
  );
  const activeSemGrades = sGrades.filter((g) => g.semester === activeSem);
  const talent = analyzeTalent(student, activeSemGrades, sAttendance, futStats);

  return {
    student: {
      id: student.id,
      nis: student.nis,
      name: student.name,
      className: student.className,
      gender: student.gender,
      rfidUid: student.rfidUid,
      parentName: 'Wali Murid Terdaftar',
      parentWhatsapp: 'Terlindungi Privasi',
      photoUrl: student.photoUrl || '',
      qrCodeValue: student.qrCodeValue || `SMPN2PJOK:${student.nis}`,
      qrImageUrl: student.qrImageUrl || '',
      primarySportInterest: student.primarySportInterest,
      nonAcademicActivity: student.nonAcademicActivity,
    },
    settings: buildPublicSettings(settings, false),
    grades: sGrades,
    attendance: sAttendance,
    notifications: sNotifs,
    availableSemesters: semesters,
    semesterKkm,
    classKkm,
    availableMaterials: materials.map((m) => ({
      code: m.code as MaterialCode,
      name: m.name,
    })),
    futStats,
    talent,
  };
}

function normalizePublicOverview(
  rawChosen: PublicOverviewResponse
): PublicOverviewResponse | null {
  if (
    isOutdatedDefaultMaterials(rawChosen.availableMaterials) ||
    !rawChosen.classKkm ||
    (rawChosen.summary?.totalStudents === 18 &&
      rawChosen.availableMaterials?.length === 7)
  ) {
    return null;
  }
  const activeComparison = (rawChosen.classComparison ?? []).filter(
    (c) => c.studentCount > 0
  );
  const activeClasses =
    activeComparison.length > 0
      ? activeComparison.map((c) => c.className)
      : rawChosen.availableClasses ?? [];
  const safeSelectedClass =
    rawChosen.selectedClass === 'Semua Kelas' ||
    activeClasses.includes(rawChosen.selectedClass)
      ? rawChosen.selectedClass
      : 'Semua Kelas';
  return {
    ...rawChosen,
    classKkm: normalizeClassKkmMap(rawChosen.classKkm),
    availableClasses: activeClasses,
    classComparison: activeComparison,
    selectedClass: safeSelectedClass,
    settings: {
      ...rawChosen.settings,
      teacherNip:
        rawChosen.settings.teacherNip === LEGACY_TEACHER_NIP
          ? CURRENT_TEACHER_NIP
          : rawChosen.settings.teacherNip,
      heroImageUrl:
        rawChosen.settings.heroImageUrl?.trim() || DEFAULT_HERO_IMAGE_URL,
    },
  };
}

function normalizeStudentReport(
  payload: StudentPortalPayload | null
): StudentPortalPayload | null {
  if (!payload) return null;
  if (
    isOutdatedDefaultMaterials(payload.availableMaterials) ||
    !payload.classKkm
  ) {
    return null;
  }
  const activeSem =
    payload.settings?.activeSemester ||
    payload.availableSemesters?.[0] ||
    DEFAULT_SEMESTERS[2];
  const effectiveMaterials =
    payload.availableMaterials?.length > 0
      ? payload.availableMaterials
      : PJOK_MATERIALS.map((m) => ({ code: m.code, name: m.name }));
  const reconciled = reconcileAllGradesConsistency({
    students: [payload.student],
    materials: effectiveMaterials,
    grades: payload.grades ?? [],
  });
  const syncedGrades = reconciled.grades;
  const cleanAttResult = stripSeedDefaultAttendance(payload.attendance ?? []);
  const syncedAttendance = cleanAttResult.attendance;
  const activeSemGrades = syncedGrades.filter((g) => g.semester === activeSem);
  const recomputedFutStats = computeFutStats(
    payload.student,
    syncedGrades,
    syncedAttendance,
    activeSem,
    effectiveMaterials
  );
  const recomputedTalent = analyzeTalent(
    payload.student,
    activeSemGrades,
    syncedAttendance,
    recomputedFutStats
  );
  return {
    ...payload,
    grades: syncedGrades,
    attendance: syncedAttendance,
    futStats: recomputedFutStats,
    talent: recomputedTalent,
    classKkm: normalizeClassKkmMap(payload.classKkm),
    settings:
      payload.settings?.teacherNip === LEGACY_TEACHER_NIP
        ? {
            ...payload.settings,
            teacherNip: CURRENT_TEACHER_NIP,
          }
        : payload.settings,
  };
}

export async function getPublicOverviewFromCloud(
  selectedClass: string,
  selectedSemester: string
): Promise<PublicOverviewResponse | null> {
  try {
    const indexSnap = await getDoc(doc(db, 'public_portal', 'index'));
    if (!indexSnap.exists()) return null;
    const indexOverview = indexSnap.data().overview as
      | PublicOverviewResponse
      | undefined;
    if (!indexOverview) return null;

    const targetSem =
      selectedSemester &&
      indexOverview.availableSemesters.includes(selectedSemester)
        ? selectedSemester
        : indexOverview.settings.activeSemester;
    const targetCls =
      selectedClass === 'Semua Kelas' ||
      indexOverview.availableClasses.includes(selectedClass)
        ? selectedClass
        : 'Semua Kelas';

    const hash = await sha256Hex(`${targetCls}::${targetSem}`);
    const snapId = `ov_${hash.slice(0, 24)}`;
    const snap = await getDoc(doc(db, 'public_portal', snapId));
    const rawChosen =
      snap.exists() && snap.data().overview
        ? (snap.data().overview as PublicOverviewResponse)
        : indexOverview;
    return normalizePublicOverview(rawChosen);
  } catch (err) {
    console.warn('Cloud public overview fallback:', err);
    return null;
  }
}

export function subscribePublicOverviewFromCloud(
  selectedClass: string,
  selectedSemester: string,
  onUpdate: (overview: PublicOverviewResponse) => void
): Unsubscribe {
  let active = true;
  let unsubDoc: Unsubscribe | null = null;

  void (async () => {
    try {
      const targetCls = selectedClass || 'Semua Kelas';
      const targetSem = selectedSemester || DEFAULT_SEMESTERS[2];
      const hash = await sha256Hex(`${targetCls}::${targetSem}`);
      const snapId = `ov_${hash.slice(0, 24)}`;
      if (!active) return;

      unsubDoc = onSnapshot(
        doc(db, 'public_portal', snapId),
        (snap) => {
          if (!active || !snap.exists()) return;
          const raw = snap.data().overview as PublicOverviewResponse | undefined;
          if (!raw) return;
          const normalized = normalizePublicOverview(raw);
          if (normalized) onUpdate(normalized);
        },
        (error) => {
          console.warn('Public overview live subscription warning:', error.message);
        }
      );
    } catch (err) {
      console.warn('Public overview subscription setup failed:', err);
    }
  })();

  return () => {
    active = false;
    if (unsubDoc) unsubDoc();
  };
}

export async function getStudentReportFromCloudByNis(
  nis: string
): Promise<StudentPortalPayload | null> {
  const cleanNis = nis.trim();
  if (!cleanNis) return null;
  try {
    const reportId = await sha256Hex(`smpn2pjok_${cleanNis}`);
    const snap = await getDoc(doc(db, 'student_reports', reportId));
    if (!snap.exists()) return null;
    const payload = (snap.data().payload as StudentPortalPayload) ?? null;
    return normalizeStudentReport(payload);
  } catch (err) {
    console.warn('Cloud student report fallback:', err);
    return null;
  }
}

export function subscribeStudentReportFromCloudByNis(
  nis: string,
  onUpdate: (report: StudentPortalPayload) => void
): Unsubscribe {
  const cleanNis = nis.trim();
  if (!cleanNis) return () => {};

  let active = true;
  let unsubDoc: Unsubscribe | null = null;

  void (async () => {
    try {
      const reportId = await sha256Hex(`smpn2pjok_${cleanNis}`);
      if (!active) return;
      unsubDoc = onSnapshot(
        doc(db, 'student_reports', reportId),
        (snap) => {
          if (!active || !snap.exists()) return;
          const raw = (snap.data().payload as StudentPortalPayload) ?? null;
          const normalized = normalizeStudentReport(raw);
          if (normalized) onUpdate(normalized);
        },
        (error) => {
          console.warn('Student report live subscription warning:', error.message);
        }
      );
    } catch (err) {
      console.warn('Student report subscription setup failed:', err);
    }
  })();

  return () => {
    active = false;
    if (unsubDoc) unsubDoc();
  };
}

async function upsertPublicPortalSnapshots(params: {
  ownerUid: string;
  settings: SchoolSettings;
  students: StudentRecord[];
  grades: GradeRecord[];
  attendance: AttendanceRecord[];
  materials: MaterialDefinition[];
  semesters: string[];
  semesterKkm: Record<string, number>;
  classKkm: Record<string, number>;
}): Promise<void> {
  const {
    ownerUid,
    settings,
    students,
    grades,
    attendance,
    materials,
    semesters,
    semesterKkm,
    classKkm,
  } = params;

  const availableClasses = extractActiveClasses(students);

  const defaultOverview = computeOverviewSnapshot({
    settings,
    students,
    grades,
    attendance,
    materials,
    semesters,
    semesterKkm,
    classKkm,
    availableClasses,
    selectedClass: 'Semua Kelas',
    selectedSemester: settings.activeSemester || semesters[0] || '',
  });

  const existingPublicSnap = await getDocs(
    query(collection(db, 'public_portal'), where('ownerUid', '==', ownerUid))
  ).catch((err) =>
    handleFirestoreError(err, OperationType.LIST, 'public_portal')
  );
  const existingPublicMap = new Map(
    existingPublicSnap.docs.map((d) => [d.id, d.data()])
  );

  let pubBatch = writeBatch(db);
  let pubOps = 0;
  const commitPubBatch = async (force = false) => {
    if (pubOps >= FIRESTORE_BATCH_LIMIT || (force && pubOps > 0)) {
      await withCloudRetry(() => pubBatch.commit(), 'public_portal_batch');
      pubBatch = writeBatch(db);
      pubOps = 0;
    }
  };

  // Queue index document only if changed or new
  const indexRef = doc(db, 'public_portal', 'index');
  const existingIndex = existingPublicMap.get('index');
  if (existingIndex) {
    if (!stableEqual(existingIndex.overview, defaultOverview)) {
      pubBatch.update(indexRef, {
        overview: defaultOverview,
        updatedAt: serverTimestamp(),
      });
      pubOps += 1;
    }
  } else {
    pubBatch.set(indexRef, {
      id: 'index',
      overview: defaultOverview,
      ownerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    pubOps += 1;
  }

  // Queue per class+semester snapshots only if changed or new & clean up removed ones
  const targetSnapIds = new Set<string>(['index']);
  const allClassChoices = ['Semua Kelas', ...availableClasses];
  for (const cls of allClassChoices) {
    for (const sem of semesters) {
      const hash = await sha256Hex(`${cls}::${sem}`);
      const snapId = `ov_${hash.slice(0, 24)}`;
      targetSnapIds.add(snapId);
      const overview = computeOverviewSnapshot({
        settings,
        students,
        grades,
        attendance,
        materials,
        semesters,
        semesterKkm,
        classKkm,
        availableClasses,
        selectedClass: cls,
        selectedSemester: sem,
      });
      const snapRef = doc(db, 'public_portal', snapId);
      const existingSnapData = existingPublicMap.get(snapId);
      if (existingSnapData) {
        if (!stableEqual(existingSnapData.overview, overview)) {
          pubBatch.update(snapRef, {
            overview,
            updatedAt: serverTimestamp(),
          });
          pubOps += 1;
          await commitPubBatch();
        }
      } else {
        pubBatch.set(snapRef, {
          id: snapId,
          overview,
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        pubOps += 1;
        await commitPubBatch();
      }
    }
  }

  for (const pDoc of existingPublicSnap.docs) {
    if (!targetSnapIds.has(pDoc.id)) {
      pubBatch.delete(doc(db, 'public_portal', pDoc.id));
      pubOps += 1;
      await commitPubBatch();
    }
  }
  await commitPubBatch(true);
}

let cloudSyncQueue: Promise<void> = Promise.resolve();

export function enqueueCloudSync<T>(task: () => Promise<T>): Promise<T> {
  const run = cloudSyncQueue.then(task);
  cloudSyncQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function waitForPendingCloudSync(): Promise<void> {
  return cloudSyncQueue;
}

export async function syncGradeDeltaToCloud(params: {
  payload: AdminDashboardPayload;
  savedGrades: GradeRecord[];
  createdStudents?: AdminStudentSummary[];
  createdNotifications?: NotificationRecord[];
  semestersChanged?: boolean;
}): Promise<void> {
  return enqueueCloudSync(async () => {
    const user = auth.currentUser;
    if (!user || !isFirebaseAdminReady()) return;
    const ownerUid = user.uid;

    const {
      payload,
      savedGrades,
      createdStudents = [],
      createdNotifications = [],
      semestersChanged = false,
    } = params;

    const classKkm = normalizeClassKkmMap(payload.classKkm);

    // Ensure /app_config/main exists; if not, perform full initial cloud sync instead
    const configRef = doc(db, 'app_config', 'main');
    const configSnap = await getDoc(configRef).catch((err) =>
      handleFirestoreError(err, OperationType.GET, 'app_config/main')
    );
    if (!configSnap.exists()) {
      await syncFullDatabaseToCloudInternal(payload);
      return;
    }

    if (semestersChanged) {
      await updateDoc(configRef, {
        semesters: payload.availableSemesters,
        updatedAt: serverTimestamp(),
      }).catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, 'app_config/main')
      );
    }

    // 1. Upsert any newly created students first so Firestore exists() rules pass
    if (createdStudents.length > 0) {
      let stuBatch = writeBatch(db);
      let stuOps = 0;
      const commitStu = async (force = false) => {
        if (stuOps >= FIRESTORE_BATCH_LIMIT || (force && stuOps > 0)) {
          await withCloudRetry(() => stuBatch.commit(), 'delta_students_batch');
          stuBatch = writeBatch(db);
          stuOps = 0;
        }
      };

      const stuDocs = await Promise.all(
        createdStudents.map((stu) => {
          const sId = sanitizeFirestoreId(stu.id, 'stu');
          return getDoc(doc(db, 'students', sId));
        })
      );

      for (let i = 0; i < createdStudents.length; i++) {
        const stu = createdStudents[i];
        const sId = sanitizeFirestoreId(stu.id, 'stu');
        const ref = doc(db, 'students', sId);
        const stuFields = {
          nis: String(stu.nis).slice(0, 32),
          name: String(stu.name).slice(0, 120),
          className: String(stu.className).slice(0, 32),
          gender: stu.gender,
          rfidUid: (stu.rfidUid || '').slice(0, 64),
          parentName: (stu.parentName || '').slice(0, 120),
          parentWhatsapp: (stu.parentWhatsapp || '').slice(0, 32),
          photoUrl: (stu.photoUrl || '').slice(0, 500),
          qrCodeValue: (stu.qrCodeValue || `SMPN2PJOK:${stu.nis}`).slice(
            0,
            200
          ),
          qrImageUrl: (stu.qrImageUrl || '').slice(0, 500),
          primarySportInterest: (stu.primarySportInterest || 'Atletik').slice(
            0,
            80
          ),
          nonAcademicActivity: (
            stu.nonAcademicActivity || 'Pramuka Inti'
          ).slice(0, 120),
        };
        if (stuDocs[i]?.exists()) {
          stuBatch.update(ref, { ...stuFields, updatedAt: serverTimestamp() });
        } else {
          stuBatch.set(ref, {
            id: sId,
            ...stuFields,
            ownerUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        stuOps += 1;
        await commitStu();
      }
      await commitStu(true);
    }

    // 2. Upsert only modified/created grades
    const dedupedGrades = Array.from(
      new Map(
        savedGrades.map((g) => [sanitizeFirestoreId(g.id, 'grd'), g])
      ).values()
    );

    if (dedupedGrades.length > 0) {
      let existingGradeIds: Set<string>;
      if (dedupedGrades.length <= 25) {
        const snaps = await Promise.all(
          dedupedGrades.map((g) =>
            getDoc(doc(db, 'grades', sanitizeFirestoreId(g.id, 'grd')))
          )
        );
        existingGradeIds = new Set(
          snaps.filter((s) => s.exists()).map((s) => s.id)
        );
      } else {
        const snap = await getDocs(
          query(collection(db, 'grades'), where('ownerUid', '==', ownerUid))
        ).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'grades')
        );
        existingGradeIds = new Set(snap.docs.map((d) => d.id));
      }

      let gBatch = writeBatch(db);
      let gOps = 0;
      const commitGrades = async (force = false) => {
        if (gOps >= FIRESTORE_BATCH_LIMIT || (force && gOps > 0)) {
          await withCloudRetry(() => gBatch.commit(), 'delta_grades_batch');
          gBatch = writeBatch(db);
          gOps = 0;
        }
      };

      for (const g of dedupedGrades) {
        const gId = sanitizeFirestoreId(g.id, 'grd');
        const sId = sanitizeFirestoreId(g.studentId, 'stu');
        const ref = doc(db, 'grades', gId);
        const gradeFields = stripUndefined({
          semester: String(g.semester).slice(0, 64),
          materialCode: String(g.materialCode).slice(0, 64),
          materialName: String(g.materialName).slice(0, 120),
          praktikScore: clampOptionalScore(g.praktikScore),
          pengetahuanScore: clampOptionalScore(g.pengetahuanScore),
          teacherNote: (g.teacherNote || '').slice(0, 495),
          remedialDetail: (g.remedialDetail || '').slice(0, 495),
          updatedAt: (g.updatedAt || new Date().toISOString()).slice(0, 64),
        });
        if (existingGradeIds.has(gId)) {
          gBatch.update(ref, {
            ...gradeFields,
            serverUpdatedAt: serverTimestamp(),
          });
        } else {
          gBatch.set(ref, {
            id: gId,
            studentId: sId,
            ...gradeFields,
            ownerUid,
            createdAt: serverTimestamp(),
            serverUpdatedAt: serverTimestamp(),
          });
        }
        gOps += 1;
        await commitGrades();
      }
      await commitGrades(true);
    }

    // 3. Insert newly created notifications (capped at newest 40 per bulk burst; student_reports retains full per-student logs)
    if (createdNotifications.length > 0) {
      const notificationsToSync = createdNotifications.slice(0, 40);
      let nBatch = writeBatch(db);
      let nOps = 0;
      const commitNotifs = async (force = false) => {
        if (nOps >= FIRESTORE_BATCH_LIMIT || (force && nOps > 0)) {
          await withCloudRetry(() => nBatch.commit(), 'delta_notifications_batch');
          nBatch = writeBatch(db);
          nOps = 0;
        }
      };
      for (const n of notificationsToSync) {
        const nId = sanitizeFirestoreId(n.id, 'notif');
        const sId = sanitizeFirestoreId(n.studentId, 'stu');
        nBatch.set(doc(db, 'notifications', nId), {
          id: nId,
          studentId: sId,
          targetRole: n.targetRole || 'all',
          type: n.type || 'GRADE_UPDATE',
          title: (n.title || 'Pembaruan').slice(0, 195),
          message: (n.message || '-').slice(0, 780),
          isRead: Boolean(n.isRead),
          whatsappSent: Boolean(n.whatsappSent),
          whatsappUrl: (n.whatsappUrl || '').slice(0, 1180),
          clientCreatedAt: n.createdAt || new Date().toISOString(),
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        nOps += 1;
        await commitNotifs();
      }
      await commitNotifs(true);
    }

    // 4. Refresh only affected student_reports/{nisHash}
    const affectedStudentIds = new Set<string>([
      ...dedupedGrades.map((g) => g.studentId),
      ...createdStudents.map((s) => s.id),
    ]);
    const affectedStudents = payload.students.filter((s) =>
      affectedStudentIds.has(s.id)
    );

    if (affectedStudents.length > 0) {
      const cleanGrades = payload.grades.map((g) => ({
        ...g,
        id: sanitizeFirestoreId(g.id, 'grd'),
        studentId: sanitizeFirestoreId(g.studentId, 'stu'),
      }));
      const cleanAtt = payload.attendance.map((a) => ({
        ...a,
        id: sanitizeFirestoreId(a.id, 'att'),
        studentId: sanitizeFirestoreId(a.studentId, 'stu'),
      }));
      const cleanNotifs = payload.notifications.map((n) => ({
        ...n,
        id: sanitizeFirestoreId(n.id, 'notif'),
        studentId: sanitizeFirestoreId(n.studentId, 'stu'),
      }));

      const reportTargets = await Promise.all(
        affectedStudents.map(async (stu) => ({
          stu,
          rId: await sha256Hex(`smpn2pjok_${stu.nis.trim()}`),
        }))
      );

      let existingReportIds: Set<string>;
      if (reportTargets.length <= 25) {
        const snaps = await Promise.all(
          reportTargets.map((t) => getDoc(doc(db, 'student_reports', t.rId)))
        );
        existingReportIds = new Set(
          snaps.filter((s) => s.exists()).map((s) => s.id)
        );
      } else {
        const snap = await getDocs(
          query(
            collection(db, 'student_reports'),
            where('ownerUid', '==', ownerUid)
          )
        );
        existingReportIds = new Set(snap.docs.map((d) => d.id));
      }

      let rBatch = writeBatch(db);
      let rOps = 0;
      const commitReports = async (force = false) => {
        if (rOps >= FIRESTORE_BATCH_LIMIT || (force && rOps > 0)) {
          await withCloudRetry(() => rBatch.commit(), 'delta_student_reports_batch');
          rBatch = writeBatch(db);
          rOps = 0;
        }
      };

      for (const { stu, rId } of reportTargets) {
        const safeStu = {
          ...stu,
          id: sanitizeFirestoreId(stu.id, 'stu'),
        };
        const reportPayload = buildStudentReportPayload({
          student: safeStu,
          settings: payload.settings,
          grades: cleanGrades,
          attendance: cleanAtt,
          notifications: cleanNotifs,
          semesters: payload.availableSemesters,
          semesterKkm: payload.semesterKkm,
          classKkm,
          materials: payload.availableMaterials,
        });
        const reportRef = doc(db, 'student_reports', rId);
        if (existingReportIds.has(rId)) {
          rBatch.update(reportRef, {
            payload: reportPayload,
            updatedAt: serverTimestamp(),
          });
        } else {
          rBatch.set(reportRef, {
            id: rId,
            studentId: safeStu.id,
            payload: reportPayload,
            ownerUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        rOps += 1;
        await commitReports();
      }
      await commitReports(true);
    }

    // 5. Refresh only affected public_portal snapshots ('index' + affected class+semester)
    const availableClasses = extractActiveClasses(payload.students);
    const affectedSemesters = Array.from(
      new Set(
        dedupedGrades
          .map((g) => g.semester)
          .concat(payload.settings.activeSemester ? [payload.settings.activeSemester] : [])
      )
    ).filter(Boolean);
    const affectedClasses = Array.from(
      new Set([
        'Semua Kelas',
        ...affectedStudents.map((s) => s.className).filter(Boolean),
      ])
    );

    const snapshotTargets: Array<{ cls: string; sem: string; snapId: string }> =
      [];
    for (const cls of affectedClasses) {
      for (const sem of affectedSemesters) {
        const hash = await sha256Hex(`${cls}::${sem}`);
        snapshotTargets.push({ cls, sem, snapId: `ov_${hash.slice(0, 24)}` });
      }
    }

    const allPubIds = ['index', ...snapshotTargets.map((t) => t.snapId)];
    const pubSnaps = await Promise.all(
      allPubIds.map((id) => getDoc(doc(db, 'public_portal', id)))
    );
    const existingPubSet = new Set(
      pubSnaps.filter((s) => s.exists()).map((s) => s.id)
    );

    let pubBatch = writeBatch(db);
    const defaultOverview = computeOverviewSnapshot({
      settings: payload.settings,
      students: payload.students,
      grades: payload.grades,
      attendance: payload.attendance,
      materials: payload.availableMaterials,
      semesters: payload.availableSemesters,
      semesterKkm: payload.semesterKkm,
      classKkm,
      availableClasses,
      selectedClass: 'Semua Kelas',
      selectedSemester:
        payload.settings.activeSemester ||
        payload.availableSemesters[0] ||
        '',
    });

    const indexRef = doc(db, 'public_portal', 'index');
    if (existingPubSet.has('index')) {
      pubBatch.update(indexRef, {
        overview: defaultOverview,
        updatedAt: serverTimestamp(),
      });
    } else {
      pubBatch.set(indexRef, {
        id: 'index',
        overview: defaultOverview,
        ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const target of snapshotTargets) {
      const overview = computeOverviewSnapshot({
        settings: payload.settings,
        students: payload.students,
        grades: payload.grades,
        attendance: payload.attendance,
        materials: payload.availableMaterials,
        semesters: payload.availableSemesters,
        semesterKkm: payload.semesterKkm,
        classKkm,
        availableClasses,
        selectedClass: target.cls,
        selectedSemester: target.sem,
      });
      const snapRef = doc(db, 'public_portal', target.snapId);
      if (existingPubSet.has(target.snapId)) {
        pubBatch.update(snapRef, {
          overview,
          updatedAt: serverTimestamp(),
        });
      } else {
        pubBatch.set(snapRef, {
          id: target.snapId,
          overview,
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await withCloudRetry(() => pubBatch.commit(), 'delta_public_portal');
  });
}

async function syncStudentReportsSubset(params: {
  ownerUid: string;
  students: AdminStudentSummary[];
  allStudents?: AdminStudentSummary[];
  settings: SchoolSettings;
  grades: GradeRecord[];
  attendance: AttendanceRecord[];
  notifications: NotificationRecord[];
  semesters: string[];
  semesterKkm: Record<string, number>;
  classKkm: Record<string, number>;
  materials: MaterialDefinition[];
  pruneOrphans?: boolean;
}): Promise<void> {
  const {
    ownerUid,
    students,
    allStudents = students,
    settings,
    grades,
    attendance,
    notifications,
    semesters,
    semesterKkm,
    classKkm,
    materials,
    pruneOrphans = false,
  } = params;

  if (students.length === 0 && !pruneOrphans) return;

  const cleanGrades = grades.map((g) => ({
    ...g,
    id: sanitizeFirestoreId(g.id, 'grd'),
    studentId: sanitizeFirestoreId(g.studentId, 'stu'),
  }));
  const cleanAtt = attendance.map((a) => ({
    ...a,
    id: sanitizeFirestoreId(a.id, 'att'),
    studentId: sanitizeFirestoreId(a.studentId, 'stu'),
  }));
  const cleanNotifs = notifications.map((n) => ({
    ...n,
    id: sanitizeFirestoreId(n.id, 'notif'),
    studentId: sanitizeFirestoreId(n.studentId, 'stu'),
  }));

  const reportTargets = await Promise.all(
    students.map(async (stu) => ({
      stu: { ...stu, id: sanitizeFirestoreId(stu.id, 'stu') },
      rId: await sha256Hex(`smpn2pjok_${stu.nis.trim()}`),
    }))
  );

  const existingReportMap = new Map<string, Record<string, unknown>>();
  if (!pruneOrphans && reportTargets.length <= 25) {
    const snaps = await Promise.all(
      reportTargets.map((t) => getDoc(doc(db, 'student_reports', t.rId)))
    );
    snaps.forEach((s) => {
      if (s.exists()) existingReportMap.set(s.id, s.data());
    });
  } else {
    const snap = await getDocs(
      query(collection(db, 'student_reports'), where('ownerUid', '==', ownerUid))
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, 'student_reports')
    );
    snap.docs.forEach((d) => existingReportMap.set(d.id, d.data()));
  }

  let batch = writeBatch(db);
  let ops = 0;
  const commitIfNeeded = async (force = false) => {
    if (ops >= FIRESTORE_BATCH_LIMIT || (force && ops > 0)) {
      await withCloudRetry(() => batch.commit(), 'student_reports_subset');
      batch = writeBatch(db);
      ops = 0;
    }
  };

  for (const { stu, rId } of reportTargets) {
    const reportPayload = buildStudentReportPayload({
      student: stu,
      settings,
      grades: cleanGrades,
      attendance: cleanAtt,
      notifications: cleanNotifs,
      semesters,
      semesterKkm,
      classKkm,
      materials,
    });
    const reportRef = doc(db, 'student_reports', rId);
    const existing = existingReportMap.get(rId);
    if (existing) {
      if (!stableEqual(existing.payload, reportPayload)) {
        batch.update(reportRef, {
          payload: reportPayload,
          updatedAt: serverTimestamp(),
        });
        ops += 1;
        await commitIfNeeded();
      }
    } else {
      batch.set(reportRef, {
        id: rId,
        studentId: stu.id,
        payload: reportPayload,
        ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ops += 1;
      await commitIfNeeded();
    }
  }

  if (pruneOrphans) {
    const validReportIds = new Set(
      await Promise.all(
        allStudents.map((s) => sha256Hex(`smpn2pjok_${s.nis.trim()}`))
      )
    );
    for (const oldId of existingReportMap.keys()) {
      if (!validReportIds.has(oldId)) {
        batch.delete(doc(db, 'student_reports', oldId));
        ops += 1;
        await commitIfNeeded();
      }
    }
  }

  await commitIfNeeded(true);
}

export async function syncConfigAndOverviewToCloud(
  payload: AdminDashboardPayload
): Promise<AdminDashboardPayload> {
  return enqueueCloudSync(async () => {
    const user = auth.currentUser;
    if (!user || !isFirebaseAdminReady()) return payload;
    const ownerUid = user.uid;

    const configRef = doc(db, 'app_config', 'main');
    const configSnap = await getDoc(configRef).catch((err) =>
      handleFirestoreError(err, OperationType.GET, 'app_config/main')
    );
    if (!configSnap.exists()) {
      return await syncFullDatabaseToCloudInternal(payload);
    }

    const [safeLogoUrl, safeHeroImageUrl] = await Promise.all([
      uploadMediaAssetIfDataUrl(payload.settings.logoUrl, 'logo'),
      uploadMediaAssetIfDataUrl(payload.settings.heroImageUrl, 'hero'),
    ]);
    const cleanSettings: SchoolSettings = {
      ...payload.settings,
      logoUrl: safeLogoUrl,
      heroImageUrl: safeHeroImageUrl,
      whatsappGatewayToken:
        payload.settings.whatsappGatewayToken === 'CONFIGURED'
          ? ''
          : payload.settings.whatsappGatewayToken || '',
    };
    const classKkm = normalizeClassKkmMap(payload.classKkm);

    const configFields = {
      schoolName: cleanSettings.schoolName,
      teacherName: cleanSettings.teacherName,
      teacherNip: cleanSettings.teacherNip || '',
      schoolAddress: cleanSettings.schoolAddress || '',
      activeSemester: cleanSettings.activeSemester,
      logoUrl: cleanSettings.logoUrl || '',
      heroImageUrl: cleanSettings.heroImageUrl || '',
      whatsappGatewayUrl: cleanSettings.whatsappGatewayUrl || '',
      whatsappGatewayToken: cleanSettings.whatsappGatewayToken || '',
      socialLinks: cleanSettings.socialLinks,
      materials: payload.availableMaterials,
      semesters: payload.availableSemesters,
      semesterKkm: payload.semesterKkm,
      classKkm,
    };

    const existingCfg = configSnap.data();
    const configChanged = Object.entries(configFields).some(
      ([k, v]) => !stableEqual(existingCfg[k], v)
    );
    if (configChanged) {
      await updateDoc(configRef, {
        ...configFields,
        updatedAt: serverTimestamp(),
      }).catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, 'app_config/main')
      );
    }

    // Only refresh student_reports if settings shown on student portal or curriculum/KKM changed
    const studentVisibleConfigChanged =
      !stableEqual(existingCfg.schoolName, configFields.schoolName) ||
      !stableEqual(existingCfg.teacherName, configFields.teacherName) ||
      !stableEqual(existingCfg.teacherNip, configFields.teacherNip) ||
      !stableEqual(existingCfg.schoolAddress, configFields.schoolAddress) ||
      !stableEqual(existingCfg.activeSemester, configFields.activeSemester) ||
      !stableEqual(existingCfg.logoUrl, configFields.logoUrl) ||
      !stableEqual(existingCfg.socialLinks, configFields.socialLinks) ||
      !stableEqual(existingCfg.materials, configFields.materials) ||
      !stableEqual(existingCfg.semesters, configFields.semesters) ||
      !stableEqual(existingCfg.semesterKkm, configFields.semesterKkm) ||
      !stableEqual(existingCfg.classKkm, configFields.classKkm);

    if (studentVisibleConfigChanged) {
      await syncStudentReportsSubset({
        ownerUid,
        students: payload.students,
        settings: cleanSettings,
        grades: payload.grades,
        attendance: payload.attendance,
        notifications: payload.notifications,
        semesters: payload.availableSemesters,
        semesterKkm: payload.semesterKkm,
        classKkm,
        materials: payload.availableMaterials,
      });
    }

    await upsertPublicPortalSnapshots({
      ownerUid,
      settings: cleanSettings,
      students: payload.students,
      grades: payload.grades,
      attendance: payload.attendance,
      materials: payload.availableMaterials,
      semesters: payload.availableSemesters,
      semesterKkm: payload.semesterKkm,
      classKkm,
    });

    return {
      ...payload,
      settings: cleanSettings,
      classKkm,
    };
  });
}

export async function syncAttendanceDeltaToCloud(
  payload: AdminDashboardPayload
): Promise<AdminDashboardPayload> {
  return enqueueCloudSync(async () => {
    const user = auth.currentUser;
    if (!user || !isFirebaseAdminReady()) return payload;
    const ownerUid = user.uid;

    const configSnap = await getDoc(doc(db, 'app_config', 'main')).catch((err) =>
      handleFirestoreError(err, OperationType.GET, 'app_config/main')
    );
    if (!configSnap.exists()) {
      return await syncFullDatabaseToCloudInternal(payload);
    }

    const targetStudentIds = new Set(
      payload.students.map((s) => sanitizeFirestoreId(s.id, 'stu'))
    );
    const affectedStudentIds = new Set<string>();

    const [existingAttSnap, existingNotifSnap] = await Promise.all([
      getDocs(
        query(collection(db, 'attendance'), where('ownerUid', '==', ownerUid))
      ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'attendance')),
      getDocs(
        query(collection(db, 'notifications'), where('ownerUid', '==', ownerUid))
      ).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, 'notifications')
      ),
    ]);

    const existingAttMap = new Map(
      existingAttSnap.docs.map((d) => [d.id, d.data()])
    );
    const cleanAtt = payload.attendance
      .map((a) => ({
        ...a,
        id: sanitizeFirestoreId(a.id, 'att'),
        studentId: sanitizeFirestoreId(a.studentId, 'stu'),
      }))
      .filter((a) => targetStudentIds.has(a.studentId));
    const targetAttIds = new Set(cleanAtt.map((a) => a.id));

    let batch = writeBatch(db);
    let ops = 0;
    const commitIfNeeded = async (force = false) => {
      if (ops >= FIRESTORE_BATCH_LIMIT || (force && ops > 0)) {
        await withCloudRetry(() => batch.commit(), 'delta_attendance_batch');
        batch = writeBatch(db);
        ops = 0;
      }
    };

    for (const a of cleanAtt) {
      const ref = doc(db, 'attendance', a.id);
      const attFields = {
        date: a.date,
        time: a.time,
        status: a.status,
        method: a.method,
        whatsappNotified: Boolean(a.whatsappNotified),
        whatsappMessage: (a.whatsappMessage || '').slice(0, 780),
        whatsappUrl: (a.whatsappUrl || '').slice(0, 1180),
        notifiedAt: a.notifiedAt || '',
      };
      const existing = existingAttMap.get(a.id);
      if (existing) {
        const changed = Object.entries(attFields).some(
          ([k, v]) => !stableEqual(existing[k], v)
        );
        if (changed) {
          batch.update(ref, { ...attFields, updatedAt: serverTimestamp() });
          ops += 1;
          affectedStudentIds.add(a.studentId);
          await commitIfNeeded();
        }
      } else {
        batch.set(ref, {
          id: a.id,
          studentId: a.studentId,
          ...attFields,
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        ops += 1;
        affectedStudentIds.add(a.studentId);
        await commitIfNeeded();
      }
    }
    for (const [oldId, oldData] of existingAttMap.entries()) {
      if (!targetAttIds.has(oldId)) {
        batch.delete(doc(db, 'attendance', oldId));
        ops += 1;
        if (typeof oldData.studentId === 'string') {
          affectedStudentIds.add(oldData.studentId);
        }
        await commitIfNeeded();
      }
    }

    const existingNotifMap = new Map(
      existingNotifSnap.docs.map((d) => [d.id, d.data()])
    );
    const cleanNotifs = payload.notifications
      .map((n) => ({
        ...n,
        id: sanitizeFirestoreId(n.id, 'notif'),
        studentId: sanitizeFirestoreId(n.studentId, 'stu'),
      }))
      .filter((n) => targetStudentIds.has(n.studentId));
    const targetNotifIds = new Set(cleanNotifs.map((n) => n.id));

    for (const n of cleanNotifs) {
      const ref = doc(db, 'notifications', n.id);
      const notifFields = {
        isRead: Boolean(n.isRead),
        whatsappSent: Boolean(n.whatsappSent),
      };
      const existing = existingNotifMap.get(n.id);
      if (existing) {
        if (
          Boolean(existing.isRead) !== notifFields.isRead ||
          Boolean(existing.whatsappSent) !== notifFields.whatsappSent
        ) {
          batch.update(ref, { ...notifFields, updatedAt: serverTimestamp() });
          ops += 1;
          affectedStudentIds.add(n.studentId);
          await commitIfNeeded();
        }
      } else {
        batch.set(ref, {
          id: n.id,
          studentId: n.studentId,
          targetRole: n.targetRole || 'all',
          type: n.type || 'GRADE_UPDATE',
          title: (n.title || 'Pembaruan').slice(0, 195),
          message: (n.message || '-').slice(0, 780),
          ...notifFields,
          whatsappUrl: (n.whatsappUrl || '').slice(0, 1180),
          clientCreatedAt: n.createdAt || new Date().toISOString(),
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        ops += 1;
        affectedStudentIds.add(n.studentId);
        await commitIfNeeded();
      }
    }
    for (const [oldId, oldData] of existingNotifMap.entries()) {
      if (!targetNotifIds.has(oldId)) {
        batch.delete(doc(db, 'notifications', oldId));
        ops += 1;
        if (typeof oldData.studentId === 'string') {
          affectedStudentIds.add(oldData.studentId);
        }
        await commitIfNeeded();
      }
    }
    await commitIfNeeded(true);

    const affectedStudents = payload.students.filter((s) =>
      affectedStudentIds.has(sanitizeFirestoreId(s.id, 'stu'))
    );
    const classKkm = normalizeClassKkmMap(payload.classKkm);

    if (affectedStudents.length > 0) {
      await syncStudentReportsSubset({
        ownerUid,
        students: affectedStudents,
        allStudents: payload.students,
        settings: payload.settings,
        grades: payload.grades,
        attendance: cleanAtt,
        notifications: cleanNotifs,
        semesters: payload.availableSemesters,
        semesterKkm: payload.semesterKkm,
        classKkm,
        materials: payload.availableMaterials,
      });

      await upsertPublicPortalSnapshots({
        ownerUid,
        settings: payload.settings,
        students: payload.students,
        grades: payload.grades,
        attendance: cleanAtt,
        materials: payload.availableMaterials,
        semesters: payload.availableSemesters,
        semesterKkm: payload.semesterKkm,
        classKkm,
      });
    }

    return payload;
  });
}

export async function syncStudentsDeltaToCloud(
  payload: AdminDashboardPayload
): Promise<AdminDashboardPayload> {
  return enqueueCloudSync(async () => {
    const user = auth.currentUser;
    if (!user || !isFirebaseAdminReady()) return payload;
    const ownerUid = user.uid;

    const configSnap = await getDoc(doc(db, 'app_config', 'main')).catch((err) =>
      handleFirestoreError(err, OperationType.GET, 'app_config/main')
    );
    if (!configSnap.exists()) {
      return await syncFullDatabaseToCloudInternal(payload);
    }

    const migratedStudents: AdminStudentSummary[] = [];
    for (const stu of payload.students) {
      const [safePhoto, safeQr] = await Promise.all([
        uploadMediaAssetIfDataUrl(stu.photoUrl, 'photo'),
        uploadMediaAssetIfDataUrl(stu.qrImageUrl, 'qr'),
      ]);
      migratedStudents.push({
        ...stu,
        id: sanitizeFirestoreId(stu.id, 'stu'),
        photoUrl: safePhoto,
        qrImageUrl: safeQr,
      });
    }

    const existingStudentsSnap = await getDocs(
      query(collection(db, 'students'), where('ownerUid', '==', ownerUid))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'students'));
    const existingStudentMap = new Map(
      existingStudentsSnap.docs.map((d) => [d.id, d.data()])
    );
    const targetStudentIds = new Set(migratedStudents.map((s) => s.id));

    const deletedStudentIds = Array.from(existingStudentMap.keys()).filter(
      (id) => !targetStudentIds.has(id)
    );
    // If a student was deleted, run full diffed sync to clean up orphaned grades/attendance/notifications
    if (deletedStudentIds.length > 0) {
      return await syncFullDatabaseToCloudInternal({
        ...payload,
        students: migratedStudents,
      });
    }

    const addedStudentIds = new Set<string>();
    const changedStudents: AdminStudentSummary[] = [];

    let stuBatch = writeBatch(db);
    let stuOps = 0;
    const commitStu = async (force = false) => {
      if (stuOps >= FIRESTORE_BATCH_LIMIT || (force && stuOps > 0)) {
        await withCloudRetry(() => stuBatch.commit(), 'students_delta_batch');
        stuBatch = writeBatch(db);
        stuOps = 0;
      }
    };

    for (const stu of migratedStudents) {
      const ref = doc(db, 'students', stu.id);
      const safeNis = (String(stu.nis || stu.id).trim() || stu.id).slice(0, 32);
      const safeName = (
        String(stu.name || '').trim() || `Siswa ${safeNis}`
      ).slice(0, 120);
      const safeClass = (String(stu.className || '').trim() || 'VII A').slice(
        0,
        32
      );
      const stuFields = {
        nis: safeNis,
        name: safeName,
        className: safeClass,
        gender: stu.gender === 'P' ? 'P' : 'L',
        rfidUid: (stu.rfidUid || '').slice(0, 64),
        parentName: (stu.parentName || '').slice(0, 120),
        parentWhatsapp: (stu.parentWhatsapp || '').slice(0, 32),
        photoUrl: (stu.photoUrl || '').slice(0, 500),
        qrCodeValue: (stu.qrCodeValue || `SMPN2PJOK:${safeNis}`).slice(0, 200),
        qrImageUrl: (stu.qrImageUrl || '').slice(0, 500),
        primarySportInterest: (stu.primarySportInterest || 'Atletik').slice(
          0,
          80
        ),
        nonAcademicActivity: (
          stu.nonAcademicActivity || 'Pramuka Inti'
        ).slice(0, 120),
      };
      const existing = existingStudentMap.get(stu.id);
      if (existing) {
        const changed = Object.entries(stuFields).some(
          ([k, v]) => !stableEqual(existing[k], v)
        );
        if (changed) {
          stuBatch.update(ref, { ...stuFields, updatedAt: serverTimestamp() });
          stuOps += 1;
          changedStudents.push(stu);
          await commitStu();
        }
      } else {
        stuBatch.set(ref, {
          id: stu.id,
          ...stuFields,
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        stuOps += 1;
        addedStudentIds.add(stu.id);
        changedStudents.push(stu);
        await commitStu();
      }
    }
    await commitStu(true);

    // Seed initial default grades for newly added students without scanning all grades
    if (addedStudentIds.size > 0) {
      const newGrades = payload.grades.filter((g) =>
        addedStudentIds.has(sanitizeFirestoreId(g.studentId, 'stu'))
      );
      let gBatch = writeBatch(db);
      let gOps = 0;
      const commitGrades = async (force = false) => {
        if (gOps >= FIRESTORE_BATCH_LIMIT || (force && gOps > 0)) {
          await withCloudRetry(() => gBatch.commit(), 'students_new_grades_batch');
          gBatch = writeBatch(db);
          gOps = 0;
        }
      };
      for (const g of newGrades) {
        const gId = sanitizeFirestoreId(g.id, 'grd');
        const sId = sanitizeFirestoreId(g.studentId, 'stu');
        gBatch.set(doc(db, 'grades', gId), {
          id: gId,
          studentId: sId,
          ...stripUndefined({
            semester: (
              String(g.semester || '').trim() ||
              payload.settings.activeSemester ||
              'Ganjil 2026/2027'
            ).slice(0, 64),
            materialCode: (
              String(g.materialCode || '').trim() || 'ATLETIK'
            ).slice(0, 64),
            materialName: (
              String(g.materialName || '').trim() || 'ATLETIK'
            ).slice(0, 120),
            praktikScore:
              typeof g.praktikScore === 'number' ? g.praktikScore : null,
            pengetahuanScore:
              typeof g.pengetahuanScore === 'number'
                ? g.pengetahuanScore
                : null,
            teacherNote: (g.teacherNote || '').slice(0, 495),
            remedialDetail: (g.remedialDetail || '').slice(0, 495),
            updatedAt: (g.updatedAt || new Date().toISOString()).slice(0, 64),
          }),
          ownerUid,
          createdAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
        });
        gOps += 1;
        await commitGrades();
      }
      await commitGrades(true);
    }

    const classKkm = normalizeClassKkmMap(payload.classKkm);
    if (changedStudents.length > 0) {
      await syncStudentReportsSubset({
        ownerUid,
        students: changedStudents,
        allStudents: migratedStudents,
        settings: payload.settings,
        grades: payload.grades,
        attendance: payload.attendance,
        notifications: payload.notifications,
        semesters: payload.availableSemesters,
        semesterKkm: payload.semesterKkm,
        classKkm,
        materials: payload.availableMaterials,
      });

      await upsertPublicPortalSnapshots({
        ownerUid,
        settings: payload.settings,
        students: migratedStudents,
        grades: payload.grades,
        attendance: payload.attendance,
        materials: payload.availableMaterials,
        semesters: payload.availableSemesters,
        semesterKkm: payload.semesterKkm,
        classKkm,
      });
    }

    return {
      ...payload,
      students: migratedStudents,
      classKkm,
    };
  });
}

export async function syncFullDatabaseToCloud(
  payload: AdminDashboardPayload
): Promise<AdminDashboardPayload> {
  return enqueueCloudSync(() => syncFullDatabaseToCloudInternal(payload));
}

async function syncFullDatabaseToCloudInternal(
  payload: AdminDashboardPayload
): Promise<AdminDashboardPayload> {
  const user = auth.currentUser;
  if (!user || !isFirebaseAdminReady()) {
    throw new Error('Admin belum terautentikasi ke Firebase Cloud.');
  }
  const ownerUid = user.uid;

  // 1. Upload any dataUrl images (logo, hero banner, student photos, student QR images) to /media_assets
  const safeLogoUrl = await uploadMediaAssetIfDataUrl(
    payload.settings.logoUrl,
    'logo'
  );
  const safeHeroImageUrl = await uploadMediaAssetIfDataUrl(
    payload.settings.heroImageUrl,
    'hero'
  );
  const cleanSettings: SchoolSettings = {
    ...payload.settings,
    logoUrl: safeLogoUrl,
    heroImageUrl: safeHeroImageUrl,
    whatsappGatewayToken:
      payload.settings.whatsappGatewayToken === 'CONFIGURED'
        ? ''
        : payload.settings.whatsappGatewayToken || '',
  };

  const migratedStudents: AdminStudentSummary[] = [];
  for (const stu of payload.students) {
    const safePhoto = await uploadMediaAssetIfDataUrl(stu.photoUrl, 'photo');
    const safeQr = await uploadMediaAssetIfDataUrl(stu.qrImageUrl, 'qr');
    migratedStudents.push({
      ...stu,
      id: sanitizeFirestoreId(stu.id, 'stu'),
      photoUrl: safePhoto,
      qrImageUrl: safeQr,
    });
  }

  const classKkm = normalizeClassKkmMap(payload.classKkm);

  // 2. Write /app_config/main only if missing or changed
  const configRef = doc(db, 'app_config', 'main');
  const configSnap = await getDoc(configRef).catch((err) =>
    handleFirestoreError(err, OperationType.GET, 'app_config/main')
  );
  const configFields = {
    schoolName: cleanSettings.schoolName,
    teacherName: cleanSettings.teacherName,
    teacherNip: cleanSettings.teacherNip || '',
    schoolAddress: cleanSettings.schoolAddress || '',
    activeSemester: cleanSettings.activeSemester,
    logoUrl: cleanSettings.logoUrl || '',
    heroImageUrl: cleanSettings.heroImageUrl || '',
    whatsappGatewayUrl: cleanSettings.whatsappGatewayUrl || '',
    whatsappGatewayToken: cleanSettings.whatsappGatewayToken || '',
    socialLinks: cleanSettings.socialLinks,
    materials: payload.availableMaterials,
    semesters: payload.availableSemesters,
    semesterKkm: payload.semesterKkm,
    classKkm,
  };
  try {
    if (configSnap.exists()) {
      const existingCfg = configSnap.data();
      const changed = Object.entries(configFields).some(
        ([k, v]) => !stableEqual(existingCfg[k], v)
      );
      if (changed) {
        await updateDoc(configRef, {
          ...configFields,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      await setDoc(configRef, {
        id: 'main',
        ...configFields,
        ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'app_config/main');
  }

  // 3. Upsert /students FIRST in batches (only changed/new/deleted!)
  const existingStudentsSnap = await getDocs(
    query(collection(db, 'students'), where('ownerUid', '==', ownerUid))
  ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'students'));
  const existingStudentMap = new Map(
    existingStudentsSnap.docs.map((d) => [d.id, d.data()])
  );
  const targetStudentIds = new Set(migratedStudents.map((s) => s.id));

  let stuBatch = writeBatch(db);
  let stuOps = 0;
  const commitStuBatchIfNeeded = async (force = false) => {
    if (stuOps >= FIRESTORE_BATCH_LIMIT || (force && stuOps > 0)) {
      await withCloudRetry(() => stuBatch.commit(), 'full_students_batch');
      stuBatch = writeBatch(db);
      stuOps = 0;
    }
  };

  for (const stu of migratedStudents) {
    const ref = doc(db, 'students', stu.id);
    const safeNis = (String(stu.nis || stu.id).trim() || stu.id).slice(0, 32);
    const safeName = (
      String(stu.name || '').trim() || `Siswa ${safeNis}`
    ).slice(0, 120);
    const safeClass = (String(stu.className || '').trim() || 'VII A').slice(
      0,
      32
    );
    const stuFields = {
      nis: safeNis,
      name: safeName,
      className: safeClass,
      gender: stu.gender === 'P' ? 'P' : 'L',
      rfidUid: (stu.rfidUid || '').slice(0, 64),
      parentName: (stu.parentName || '').slice(0, 120),
      parentWhatsapp: (stu.parentWhatsapp || '').slice(0, 32),
      photoUrl: (stu.photoUrl || '').slice(0, 500),
      qrCodeValue: (stu.qrCodeValue || `SMPN2PJOK:${safeNis}`).slice(0, 200),
      qrImageUrl: (stu.qrImageUrl || '').slice(0, 500),
      primarySportInterest: (stu.primarySportInterest || 'Atletik').slice(
        0,
        80
      ),
      nonAcademicActivity: (stu.nonAcademicActivity || 'Pramuka Inti').slice(
        0,
        120
      ),
    };
    const existing = existingStudentMap.get(stu.id);
    if (existing) {
      const changed = Object.entries(stuFields).some(
        ([k, v]) => !stableEqual(existing[k], v)
      );
      if (changed) {
        stuBatch.update(ref, { ...stuFields, updatedAt: serverTimestamp() });
        stuOps += 1;
        await commitStuBatchIfNeeded();
      }
    } else {
      stuBatch.set(ref, {
        id: stu.id,
        ...stuFields,
        ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      stuOps += 1;
      await commitStuBatchIfNeeded();
    }
  }

  for (const oldId of existingStudentMap.keys()) {
    if (!targetStudentIds.has(oldId)) {
      stuBatch.delete(doc(db, 'students', oldId));
      stuOps += 1;
      await commitStuBatchIfNeeded();
    }
  }
  await commitStuBatchIfNeeded(true);

  // 4. Sync /grades (only changed/new/deleted!)
  const existingGradesSnap = await getDocs(
    query(collection(db, 'grades'), where('ownerUid', '==', ownerUid))
  ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'grades'));
  const existingGradeMap = new Map(
    existingGradesSnap.docs.map((d) => [d.id, d.data()])
  );
  const cleanGrades = payload.grades
    .map((g) => ({
      ...g,
      id: sanitizeFirestoreId(g.id, 'grd'),
      studentId: sanitizeFirestoreId(g.studentId, 'stu'),
    }))
    .filter((g) => targetStudentIds.has(g.studentId));
  const targetGradeIds = new Set(cleanGrades.map((g) => g.id));

  let batch = writeBatch(db);
  let ops = 0;
  const commitBatchIfNeeded = async (force = false) => {
    if (ops >= FIRESTORE_BATCH_LIMIT || (force && ops > 0)) {
      await withCloudRetry(() => batch.commit(), 'full_data_batch');
      batch = writeBatch(db);
      ops = 0;
    }
  };

  for (const g of cleanGrades) {
    const ref = doc(db, 'grades', g.id);
    const clampOptional = (val: number | null | undefined): number | null =>
      typeof val === 'number' && Number.isFinite(val)
        ? Math.max(0, Math.min(100, Math.round(val)))
        : null;
    const safeSemester = (
      String(g.semester || '').trim() ||
      cleanSettings.activeSemester ||
      'Ganjil 2026/2027'
    ).slice(0, 64);
    const safeMatCode = (
      String(g.materialCode || '').trim() || 'ATLETIK'
    ).slice(0, 64);
    const safeMatName = (
      String(g.materialName || '').trim() || safeMatCode
    ).slice(0, 120);
    const gradeFields = stripUndefined({
      semester: safeSemester,
      materialCode: safeMatCode,
      materialName: safeMatName,
      praktikScore: clampOptional(g.praktikScore),
      pengetahuanScore: clampOptional(g.pengetahuanScore),
      teacherNote: (g.teacherNote || '').slice(0, 495),
      remedialDetail: (g.remedialDetail || '').slice(0, 495),
      updatedAt: (g.updatedAt || new Date().toISOString()).slice(0, 64),
    });
    const existing = existingGradeMap.get(g.id);
    if (existing) {
      const changed = Object.entries(gradeFields).some(
        ([k, v]) => !stableEqual(existing[k], v)
      );
      if (changed) {
        batch.update(ref, {
          ...gradeFields,
          serverUpdatedAt: serverTimestamp(),
        });
        ops += 1;
        await commitBatchIfNeeded();
      }
    } else {
      batch.set(ref, {
        id: g.id,
        studentId: g.studentId,
        ...gradeFields,
        ownerUid,
        createdAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
      });
      ops += 1;
      await commitBatchIfNeeded();
    }
  }
  for (const oldId of existingGradeMap.keys()) {
    if (!targetGradeIds.has(oldId)) {
      batch.delete(doc(db, 'grades', oldId));
      ops += 1;
      await commitBatchIfNeeded();
    }
  }
  await commitBatchIfNeeded(true);

  // 5. Sync /attendance (only changed/new/deleted!)
  const existingAttSnap = await getDocs(
    query(collection(db, 'attendance'), where('ownerUid', '==', ownerUid))
  ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'attendance'));
  const existingAttMap = new Map(
    existingAttSnap.docs.map((d) => [d.id, d.data()])
  );
  const cleanAtt = payload.attendance
    .map((a) => ({
      ...a,
      id: sanitizeFirestoreId(a.id, 'att'),
      studentId: sanitizeFirestoreId(a.studentId, 'stu'),
    }))
    .filter((a) => targetStudentIds.has(a.studentId));
  const targetAttIds = new Set(cleanAtt.map((a) => a.id));

  for (const a of cleanAtt) {
    const ref = doc(db, 'attendance', a.id);
    const attFields = {
      date: a.date,
      time: a.time,
      status: a.status,
      method: a.method,
      whatsappNotified: Boolean(a.whatsappNotified),
      whatsappMessage: (a.whatsappMessage || '').slice(0, 780),
      whatsappUrl: (a.whatsappUrl || '').slice(0, 1180),
      notifiedAt: a.notifiedAt || '',
    };
    const existing = existingAttMap.get(a.id);
    if (existing) {
      const changed = Object.entries(attFields).some(
        ([k, v]) => !stableEqual(existing[k], v)
      );
      if (changed) {
        batch.update(ref, { ...attFields, updatedAt: serverTimestamp() });
        ops += 1;
        await commitBatchIfNeeded();
      }
    } else {
      batch.set(ref, {
        id: a.id,
        studentId: a.studentId,
        ...attFields,
        ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ops += 1;
      await commitBatchIfNeeded();
    }
  }
  for (const oldId of existingAttMap.keys()) {
    if (!targetAttIds.has(oldId)) {
      batch.delete(doc(db, 'attendance', oldId));
      ops += 1;
      await commitBatchIfNeeded();
    }
  }
  await commitBatchIfNeeded(true);

  // 6. Sync /notifications (only changed/new/deleted!)
  const existingNotifSnap = await getDocs(
    query(collection(db, 'notifications'), where('ownerUid', '==', ownerUid))
  ).catch((err) =>
    handleFirestoreError(err, OperationType.LIST, 'notifications')
  );
  const existingNotifMap = new Map(
    existingNotifSnap.docs.map((d) => [d.id, d.data()])
  );
  const cleanNotifs = payload.notifications
    .map((n) => ({
      ...n,
      id: sanitizeFirestoreId(n.id, 'notif'),
      studentId: sanitizeFirestoreId(n.studentId, 'stu'),
    }))
    .filter((n) => targetStudentIds.has(n.studentId));
  const targetNotifIds = new Set(cleanNotifs.map((n) => n.id));

  for (const n of cleanNotifs) {
    const ref = doc(db, 'notifications', n.id);
    const notifFields = {
      isRead: Boolean(n.isRead),
      whatsappSent: Boolean(n.whatsappSent),
    };
    const existing = existingNotifMap.get(n.id);
    if (existing) {
      if (
        Boolean(existing.isRead) !== notifFields.isRead ||
        Boolean(existing.whatsappSent) !== notifFields.whatsappSent
      ) {
        batch.update(ref, { ...notifFields, updatedAt: serverTimestamp() });
        ops += 1;
        await commitBatchIfNeeded();
      }
    } else {
      batch.set(ref, {
        id: n.id,
        studentId: n.studentId,
        targetRole: n.targetRole || 'all',
        type: n.type || 'GRADE_UPDATE',
        title: (n.title || 'Pembaruan').slice(0, 195),
        message: (n.message || '-').slice(0, 780),
        ...notifFields,
        whatsappUrl: (n.whatsappUrl || '').slice(0, 1180),
        clientCreatedAt: n.createdAt || new Date().toISOString(),
        ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ops += 1;
      await commitBatchIfNeeded();
    }
  }
  for (const oldId of existingNotifMap.keys()) {
    if (!targetNotifIds.has(oldId)) {
      batch.delete(doc(db, 'notifications', oldId));
      ops += 1;
      await commitBatchIfNeeded();
    }
  }
  await commitBatchIfNeeded(true);

  // 7. Update /student_reports/{nisHash} in batches (only changed/new/deleted!)
  await syncStudentReportsSubset({
    ownerUid,
    students: migratedStudents,
    allStudents: migratedStudents,
    settings: cleanSettings,
    grades: cleanGrades,
    attendance: cleanAtt,
    notifications: cleanNotifs,
    semesters: payload.availableSemesters,
    semesterKkm: payload.semesterKkm,
    classKkm,
    materials: payload.availableMaterials,
    pruneOrphans: true,
  });

  // 8. Update /public_portal snapshots for cross-device public dashboard (only changed/new/deleted!)
  await upsertPublicPortalSnapshots({
    ownerUid,
    settings: cleanSettings,
    students: migratedStudents,
    grades: cleanGrades,
    attendance: cleanAtt,
    materials: payload.availableMaterials,
    semesters: payload.availableSemesters,
    semesterKkm: payload.semesterKkm,
    classKkm,
  });

  return {
    ...payload,
    settings: cleanSettings,
    students: migratedStudents,
    grades: cleanGrades,
    attendance: cleanAtt,
    notifications: cleanNotifs,
    classKkm,
  };
}

export async function loadAdminDashboardFromCloud(
  fallbackPayload: AdminDashboardPayload | null
): Promise<AdminDashboardPayload | null> {
  await waitForPendingCloudSync();
  const user = auth.currentUser;
  if (!user || !isFirebaseAdminReady()) return fallbackPayload;
  const ownerUid = user.uid;

  let configSnap;
  try {
    configSnap = await getDoc(doc(db, 'app_config', 'main'));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'app_config/main');
  }

  // First-time cloud initialization: seed Cloud Firestore from server database
  if (!configSnap.exists()) {
    if (!fallbackPayload) return null;
    return await syncFullDatabaseToCloudInternal(fallbackPayload);
  }

  const cfg = configSnap.data();
  const [studentsSnap, gradesSnap, attSnap, notifSnap] = await Promise.all([
    getDocs(
      query(collection(db, 'students'), where('ownerUid', '==', ownerUid))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'students')),
    getDocs(
      query(collection(db, 'grades'), where('ownerUid', '==', ownerUid))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, 'grades')),
    getDocs(
      query(collection(db, 'attendance'), where('ownerUid', '==', ownerUid))
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, 'attendance')
    ),
    getDocs(
      query(collection(db, 'notifications'), where('ownerUid', '==', ownerUid))
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, 'notifications')
    ),
  ]);

  if (
    studentsSnap.empty &&
    fallbackPayload &&
    fallbackPayload.students.length > 0
  ) {
    try {
      return await syncFullDatabaseToCloud(fallbackPayload);
    } catch (syncErr) {
      console.warn('Initial cloud student seed failed, using local DB:', syncErr);
      return fallbackPayload;
    }
  }

  const rawTeacherNip = String(cfg.teacherNip ?? '');
  const settings: SchoolSettings = {
    schoolName: String(cfg.schoolName ?? 'SMPN 2 Ciamis'),
    teacherName: String(cfg.teacherName ?? 'Galih Cipta Setia, S.Pd.'),
    teacherNip: normalizeTeacherNip(rawTeacherNip),
    schoolAddress: String(cfg.schoolAddress ?? ''),
    activeSemester: String(cfg.activeSemester ?? DEFAULT_SEMESTERS[2]),
    logoUrl: String(cfg.logoUrl ?? ''),
    heroImageUrl: String(
      cfg.heroImageUrl ||
        '/src/assets/images/hero_sports_arena_1794923888842.jpg'
    ),
    whatsappGatewayUrl: String(cfg.whatsappGatewayUrl ?? ''),
    whatsappGatewayToken: String(cfg.whatsappGatewayToken ?? ''),
    socialLinks: (cfg.socialLinks as SchoolSettings['socialLinks']) ?? {
      instagram: '',
      youtube: '',
      facebook: '',
      tiktok: '',
    },
  };

  const rawMaterials: MaterialDefinition[] = Array.isArray(cfg.materials)
    ? (cfg.materials as MaterialDefinition[])
    : PJOK_MATERIALS.map((m) => ({ code: m.code, name: m.name }));

  const legacyMaterialsDetected = hasLegacyDefaultMaterials(rawMaterials);
  const previous7MaterialsDetected = isPrevious7DefaultMaterials(rawMaterials);
  const availableMaterials: MaterialDefinition[] =
    legacyMaterialsDetected || previous7MaterialsDetected
      ? PJOK_MATERIALS.map((m) => ({ code: m.code, name: m.name }))
      : rawMaterials;

  const availableSemesters: string[] = Array.isArray(cfg.semesters)
    ? (cfg.semesters as string[])
    : [...DEFAULT_SEMESTERS];

  const hasStoredClassKkm = Boolean(cfg.classKkm && typeof cfg.classKkm === 'object');
  const semesterKkm: Record<string, number> = {};
  const rawKkm = (cfg.semesterKkm as Record<string, number>) ?? {};
  availableSemesters.forEach((sem) => {
    const val = Number(rawKkm[sem]);
    const valid = Number.isFinite(val) && val >= 0 && val <= 100 ? Math.round(val) : DEFAULT_KKM;
    semesterKkm[sem] = !hasStoredClassKkm && valid === 75 ? DEFAULT_KKM : valid;
  });

  const classKkm = normalizeClassKkmMap(
    (cfg.classKkm as Record<string, number> | undefined) ?? DEFAULT_CLASS_KKM
  );

  const rawStudents: StudentRecord[] = studentsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: String(data.id ?? d.id),
      nis: String(data.nis ?? ''),
      name: String(data.name ?? ''),
      className: String(data.className ?? 'VII A'),
      gender: data.gender === 'P' ? 'P' : 'L',
      rfidUid: String(data.rfidUid ?? ''),
      parentName: String(data.parentName ?? ''),
      parentWhatsapp: String(data.parentWhatsapp ?? ''),
      photoUrl: String(data.photoUrl ?? ''),
      qrCodeValue: String(data.qrCodeValue ?? ''),
      qrImageUrl: String(data.qrImageUrl ?? ''),
      primarySportInterest: String(data.primarySportInterest ?? 'Atletik'),
      nonAcademicActivity: String(data.nonAcademicActivity ?? 'Pramuka Inti'),
    };
  });

  if (
    isLegacy18SeedStudents(rawStudents) &&
    isOutdatedDefaultMaterials(rawMaterials) &&
    fallbackPayload &&
    fallbackPayload.students.length === 224
  ) {
    return await syncFullDatabaseToCloud({
      ...fallbackPayload,
      settings: {
        ...fallbackPayload.settings,
        ...settings,
      },
      classKkm,
      semesterKkm,
    });
  }

  const grades: GradeRecord[] = gradesSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: String(data.id ?? d.id),
      studentId: String(data.studentId ?? ''),
      semester: String(data.semester ?? settings.activeSemester),
      materialCode: String(data.materialCode ?? ''),
      materialName: String(data.materialName ?? ''),
      praktikScore:
        typeof data.praktikScore === 'number' ? data.praktikScore : null,
      pengetahuanScore:
        typeof data.pengetahuanScore === 'number' ? data.pengetahuanScore : null,
      teacherNote: String(data.teacherNote ?? ''),
      remedialDetail: data.remedialDetail ? String(data.remedialDetail) : undefined,
      updatedAt: String(data.updatedAt ?? new Date().toISOString()),
    };
  });

  const attendance: AttendanceRecord[] = attSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        studentId: String(data.studentId ?? ''),
        date: String(data.date ?? ''),
        time: String(data.time ?? ''),
        status: data.status as AttendanceRecord['status'],
        method: data.method as AttendanceRecord['method'],
        whatsappNotified: Boolean(data.whatsappNotified),
        whatsappMessage: String(data.whatsappMessage ?? ''),
        whatsappUrl: data.whatsappUrl ? String(data.whatsappUrl) : undefined,
        notifiedAt: data.notifiedAt ? String(data.notifiedAt) : undefined,
      };
    })
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));

  const notifications: NotificationRecord[] = notifSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: String(data.id ?? d.id),
        studentId: String(data.studentId ?? ''),
        targetRole: (data.targetRole as NotificationRecord['targetRole']) ?? 'all',
        type: (data.type as NotificationRecord['type']) ?? 'GRADE_UPDATE',
        title: String(data.title ?? ''),
        message: String(data.message ?? ''),
        isRead: Boolean(data.isRead),
        whatsappSent: Boolean(data.whatsappSent),
        whatsappUrl: data.whatsappUrl ? String(data.whatsappUrl) : undefined,
        createdAt: String(data.clientCreatedAt ?? new Date().toISOString()),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (
    rawStudents.length === 0 &&
    fallbackPayload &&
    fallbackPayload.students.length > 0
  ) {
    return fallbackPayload;
  }

  const missingCloudGrades =
    grades.length === 0 &&
    Boolean(fallbackPayload && fallbackPayload.grades.length > 0);

  // Bidirectional timestamp-aware grade & attendance merge so stale Cloud data never overwrites fresher local server edits
  let mergedBaseGrades: GradeRecord[] = missingCloudGrades && fallbackPayload
    ? fallbackPayload.grades
    : grades;
  let localHasFresherData = false;

  if (fallbackPayload && !missingCloudGrades && fallbackPayload.grades.length > 0) {
    const parseTs = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);
    const cloudMaxTs = grades.reduce(
      (max, g) => Math.max(max, parseTs(g.updatedAt)),
      0
    );
    const localMaxTs = fallbackPayload.grades.reduce(
      (max, g) => Math.max(max, parseTs(g.updatedAt)),
      0
    );

    const mergedGradeMap = new Map<string, GradeRecord>();
    grades.forEach((g) => {
      mergedGradeMap.set(`${g.studentId}::${g.semester}::${g.materialCode}`, g);
    });

    for (const localG of fallbackPayload.grades) {
      const key = `${localG.studentId}::${localG.semester}::${localG.materialCode}`;
      const cloudG = mergedGradeMap.get(key);
      const localTs = parseTs(localG.updatedAt);
      const cloudTs = cloudG ? parseTs(cloudG.updatedAt) : 0;
      if (!cloudG) {
        if (localTs > cloudMaxTs || localMaxTs > cloudMaxTs + 2000) {
          mergedGradeMap.set(key, localG);
          localHasFresherData = true;
        }
      } else if (localTs > cloudTs + 1000) {
        mergedGradeMap.set(key, localG);
        localHasFresherData = true;
      }
    }

    if (localHasFresherData) {
      mergedBaseGrades = Array.from(mergedGradeMap.values());
    }
  }

  let effectiveBaseAttendance = attendance;
  if (fallbackPayload && fallbackPayload.attendance.length > 0) {
    const attMap = new Map<string, AttendanceRecord>();
    attendance.forEach((a) => attMap.set(`${a.studentId}::${a.date}`, a));
    let localAttAdded = false;
    for (const localA of fallbackPayload.attendance) {
      const key = `${localA.studentId}::${localA.date}`;
      const cloudA = attMap.get(key);
      if (
        !cloudA ||
        `${localA.date} ${localA.time}` > `${cloudA.date} ${cloudA.time}`
      ) {
        attMap.set(key, localA);
        localAttAdded = true;
      }
    }
    if (localAttAdded) {
      effectiveBaseAttendance = Array.from(attMap.values()).sort((a, b) =>
        `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
      );
      localHasFresherData = true;
    }
  }

  const migratedGrades = legacyMaterialsDetected
    ? migrateLegacyGrades(mergedBaseGrades)
    : mergedBaseGrades;
  const oldSeedGradesDetected = isOldDeterministicSeedGrades(migratedGrades);
  const baseGrades = oldSeedGradesDetected
    ? migratedGrades.map((g) => ({
        ...g,
        praktikScore: DEFAULT_SEED_SCORE,
        pengetahuanScore: DEFAULT_SEED_SCORE,
        teacherNote: buildAutoGradeDescription(
          DEFAULT_SEED_SCORE,
          DEFAULT_SEED_SCORE,
          g.materialName
        ),
        updatedAt: '2026-11-19T08:30:00.000Z',
      }))
    : migratedGrades;

  const reconciledCloudGrades = reconcileAllGradesConsistency({
    students: rawStudents,
    materials: availableMaterials,
    grades: baseGrades,
  });
  const effectiveGrades = reconciledCloudGrades.grades;

  const strippedCloudAtt = stripSeedDefaultAttendance(effectiveBaseAttendance);
  const effectiveAttendance = strippedCloudAtt.attendance;

  const students: AdminStudentSummary[] = rawStudents
    .map((stu) => {
      const sGrades = effectiveGrades.filter((g) => g.studentId === stu.id);
      const sAtt = effectiveAttendance.filter((a) => a.studentId === stu.id);
      const futStats = computeFutStats(
        stu,
        sGrades,
        sAtt,
        settings.activeSemester,
        availableMaterials
      );
      const activeSemGrades = sGrades.filter(
        (g) => g.semester === settings.activeSemester
      );
      const talent = analyzeTalent(stu, activeSemGrades, sAtt, futStats);
      return {
        ...stu,
        futStats,
        talent,
        latestAttendance: sAtt[0],
        gradesCount: sGrades.length,
      };
    })
    .sort((a, b) =>
      a.className === b.className
        ? a.name.localeCompare(b.name)
        : a.className.localeCompare(b.className)
    );

  const loadedPayload: AdminDashboardPayload = {
    settings,
    students,
    grades: effectiveGrades,
    attendance: effectiveAttendance,
    notifications,
    availableClasses: extractActiveClasses(students),
    availableSemesters,
    semesterKkm,
    classKkm,
    availableMaterials,
    defaultSnapshotInfo: fallbackPayload?.defaultSnapshotInfo,
  };

  if (
    rawTeacherNip === LEGACY_TEACHER_NIP ||
    legacyMaterialsDetected ||
    previous7MaterialsDetected ||
    oldSeedGradesDetected ||
    missingCloudGrades ||
    localHasFresherData ||
    reconciledCloudGrades.changed ||
    strippedCloudAtt.removedCount > 0 ||
    !hasStoredClassKkm
  ) {
    try {
      return await syncFullDatabaseToCloud(loadedPayload);
    } catch (syncErr) {
      console.warn('Cloud migration sync skipped, returning loaded data:', syncErr);
      return loadedPayload;
    }
  }

  return loadedPayload;
}
