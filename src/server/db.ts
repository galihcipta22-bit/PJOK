import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AttendanceMethod,
  AttendanceRecord,
  AttendanceStatus,
  GradeRecord,
  MaterialCode,
  MaterialDefinition,
  NotificationRecord,
  SchoolSettings,
  StudentRecord,
} from '../types.ts';
import {
  DEFAULT_CLASSES,
  DEFAULT_CLASS_KKM,
  DEFAULT_SEED_SCORE,
  DEFAULT_SEMESTERS,
  PJOK_MATERIALS,
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

export interface StoredStudent extends StudentRecord {
  pinHash: string;
}

export interface DatabaseState {
  settings: SchoolSettings;
  adminCredentials: {
    username: string;
    passwordHash: string;
    displayName: string;
    nip: string;
  };
  materials?: MaterialDefinition[];
  semesters?: string[];
  semesterKkm?: Record<string, number>;
  classKkm?: Record<string, number>;
  students: StoredStudent[];
  grades: GradeRecord[];
  attendance: AttendanceRecord[];
  notifications: NotificationRecord[];
}

export const DEFAULT_KKM = 78;
export const DEFAULT_STUDENT_COUNT = 224;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'pjok-db.json');

export function hashSecret(value: string): string {
  return crypto
    .createHash('sha256')
    .update(`smpn2ciamis_pjok_${value}`)
    .digest('hex');
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith('8')) {
    return `62${digits}`;
  }
  return digits || '6281200000000';
}

export function buildWhatsappUrl(phone: string, message: string): string {
  const clean = normalizePhone(phone);
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

function createSeedDatabase(): DatabaseState {
  const settings: SchoolSettings = {
    schoolName: 'SMPN 2 Ciamis',
    teacherName: 'Galih Cipta Setia, S.Pd.',
    teacherNip: '19890526 202221 1 006',
    schoolAddress:
      'Jl. Jend. Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215',
    activeSemester: 'Ganjil 2026/2027',
    logoUrl: '/src/assets/images/school_crest_logo_1794923887594.jpg',
    heroImageUrl: '/src/assets/images/hero_sports_arena_1794923888842.jpg',
    whatsappGatewayUrl: '',
    whatsappGatewayToken: '',
    socialLinks: {
      instagram: 'https://instagram.com/smpn2ciamis.official',
      youtube: 'https://youtube.com/@smpn2ciamis',
      facebook: 'https://facebook.com/smpn2ciamis',
      tiktok: 'https://tiktok.com/@smpn2ciamis',
    },
  };

  const rawStudents: Array<
    Omit<StoredStudent, 'id' | 'pinHash'> & { pin?: string }
  > = [
    {
      nis: '242507001',
      name: 'Raka Pratama Nugraha',
      className: 'VII A',
      gender: 'L',
      rfidUid: 'RF-2425-001',
      parentName: 'Bpk. Dedi Nugraha',
      parentWhatsapp: '6281223456701',
      photoUrl: '/src/assets/images/athlete_avatar_1_1794923888923.jpg',
      primarySportInterest: 'Sepak Bola',
      nonAcademicActivity: 'Tim Futsal Sekolah',
    },
    {
      nis: '242507002',
      name: 'Nadia Putri Ramadhani',
      className: 'VII A',
      gender: 'P',
      rfidUid: 'RF-2425-002',
      parentName: 'Ibu Siti Rahmawati',
      parentWhatsapp: '6281223456702',
      photoUrl: '/src/assets/images/athlete_female_clean_1794923905174.jpg',
      primarySportInterest: 'Bulutangkis',
      nonAcademicActivity: 'PMR & UKS',
    },
    {
      nis: '242507003',
      name: 'Fajar Maulana Sidik',
      className: 'VII A',
      gender: 'L',
      rfidUid: 'RF-2425-003',
      parentName: 'Bpk. Hendra Sidik',
      parentWhatsapp: '6281223456703',
      photoUrl: '',
      primarySportInterest: 'Atletik',
      nonAcademicActivity: 'Pramuka Inti',
    },
    {
      nis: '242507004',
      name: 'Alya Zahra Fauziah',
      className: 'VII B',
      gender: 'P',
      rfidUid: 'RF-2425-004',
      parentName: 'Ibu Yanti Fauziah',
      parentWhatsapp: '6281223456704',
      photoUrl: '/src/assets/images/athlete_female_clean_1794923905174.jpg',
      primarySportInterest: 'Bola Basket',
      nonAcademicActivity: 'OSIS Sekbid Olahraga',
    },
    {
      nis: '242507005',
      name: 'Dimas Alfarizi',
      className: 'VII B',
      gender: 'L',
      rfidUid: 'RF-2425-005',
      parentName: 'Bpk. Agus Permana',
      parentWhatsapp: '6281223456705',
      photoUrl: '',
      primarySportInterest: 'Pencak Silat',
      nonAcademicActivity: 'Paskibra',
    },
    {
      nis: '242507006',
      name: 'Keyla Salsabila',
      className: 'VII B',
      gender: 'P',
      rfidUid: 'RF-2425-006',
      parentName: 'Ibu Rina Marlina',
      parentWhatsapp: '6281223456706',
      photoUrl: '',
      primarySportInterest: 'Bola Voli',
      nonAcademicActivity: 'Pramuka Inti',
    },
    {
      nis: '232408001',
      name: 'Bagas Aditya Kusuma',
      className: 'VIII A',
      gender: 'L',
      rfidUid: 'RF-2324-101',
      parentName: 'Bpk. Taufik Kusuma',
      parentWhatsapp: '6281223456801',
      photoUrl: '/src/assets/images/athlete_avatar_1_1794923888923.jpg',
      primarySportInterest: 'Sepak Bola',
      nonAcademicActivity: 'OSIS Sekbid Olahraga',
    },
    {
      nis: '232408002',
      name: 'Salma Khoirunnisa',
      className: 'VIII A',
      gender: 'P',
      rfidUid: 'RF-2324-102',
      parentName: 'Ibu Dewi Lestari',
      parentWhatsapp: '6281223456802',
      photoUrl: '/src/assets/images/athlete_female_clean_1794923905174.jpg',
      primarySportInterest: 'Atletik',
      nonAcademicActivity: 'PMR & UKS',
    },
    {
      nis: '232408003',
      name: 'Ilham Ramadhan',
      className: 'VIII A',
      gender: 'L',
      rfidUid: 'RF-2324-103',
      parentName: 'Bpk. Asep Hidayat',
      parentWhatsapp: '6281223456803',
      photoUrl: '',
      primarySportInterest: 'Bola Basket',
      nonAcademicActivity: 'Paskibra',
    },
    {
      nis: '232408004',
      name: 'Tiara Ayu Wandira',
      className: 'VIII B',
      gender: 'P',
      rfidUid: 'RF-2324-104',
      parentName: 'Ibu Nani Suryani',
      parentWhatsapp: '6281223456804',
      photoUrl: '',
      primarySportInterest: 'Bulutangkis',
      nonAcademicActivity: 'Pramuka Inti',
    },
    {
      nis: '232408005',
      name: 'Reza Pahlevi',
      className: 'VIII B',
      gender: 'L',
      rfidUid: 'RF-2324-105',
      parentName: 'Bpk. Budi Santoso',
      parentWhatsapp: '6281223456805',
      photoUrl: '',
      primarySportInterest: 'Bola Voli',
      nonAcademicActivity: 'Tim Voli Sekolah',
    },
    {
      nis: '232408006',
      name: 'Mutiara Azahra',
      className: 'VIII B',
      gender: 'P',
      rfidUid: 'RF-2324-106',
      parentName: 'Ibu Euis Kartika',
      parentWhatsapp: '6281223456806',
      photoUrl: '',
      primarySportInterest: 'Renang',
      nonAcademicActivity: 'PMR & UKS',
    },
    {
      nis: '222309001',
      name: 'M. Rizky Firmansyah',
      className: 'IX A',
      gender: 'L',
      rfidUid: 'RF-2223-201',
      parentName: 'Bpk. Iman Firmansyah',
      parentWhatsapp: '6281223456901',
      photoUrl: '/src/assets/images/athlete_avatar_1_1794923888923.jpg',
      primarySportInterest: 'Atletik',
      nonAcademicActivity: 'Paskibra',
    },
    {
      nis: '222309002',
      name: 'Syifa Nur Azizah',
      className: 'IX A',
      gender: 'P',
      rfidUid: 'RF-2223-202',
      parentName: 'Ibu Lilis Kurnia',
      parentWhatsapp: '6281223456902',
      photoUrl: '/src/assets/images/athlete_female_clean_1794923905174.jpg',
      primarySportInterest: 'Bulutangkis',
      nonAcademicActivity: 'OSIS Sekbid Olahraga',
    },
    {
      nis: '222309003',
      name: 'Galang Yudhistira',
      className: 'IX A',
      gender: 'L',
      rfidUid: 'RF-2223-203',
      parentName: 'Bpk. Wahyu Hidayat',
      parentWhatsapp: '6281223456903',
      photoUrl: '',
      primarySportInterest: 'Bola Basket',
      nonAcademicActivity: 'Tim Basket Putra',
    },
    {
      nis: '222309004',
      name: 'Putri Melati Sundari',
      className: 'IX B',
      gender: 'P',
      rfidUid: 'RF-2223-204',
      parentName: 'Ibu Sri Mulyani',
      parentWhatsapp: '6281223456904',
      photoUrl: '',
      primarySportInterest: 'Pencak Silat',
      nonAcademicActivity: 'Paskibra',
    },
    {
      nis: '222309005',
      name: 'Aldi Kurniawan',
      className: 'IX B',
      gender: 'L',
      rfidUid: 'RF-2223-205',
      parentName: 'Bpk. Ujang Rohman',
      parentWhatsapp: '6281223456905',
      photoUrl: '',
      primarySportInterest: 'Sepak Bola',
      nonAcademicActivity: 'Tim Futsal Sekolah',
    },
    {
      nis: '222309006',
      name: 'Zahra Aulia Putri',
      className: 'IX B',
      gender: 'P',
      rfidUid: 'RF-2223-206',
      parentName: 'Ibu Eni Rohaeni',
      parentWhatsapp: '6281223456906',
      photoUrl: '',
      primarySportInterest: 'Bola Voli',
      nonAcademicActivity: 'PMR & UKS',
    },
  ];

  // Expand deterministically to 224 default students across 9 classes (VII A..IX C)
  const maleFirstNames = [
    'Aditya', 'Ahmad', 'Akbar', 'Alif', 'Andika', 'Angga', 'Ardian', 'Arif',
    'Arya', 'Azzam', 'Bima', 'Bayu', 'Bintang', 'Daffa', 'Danang', 'Dava',
    'Dika', 'Eka', 'Fadlan', 'Fahri', 'Fajar', 'Farhan', 'Fikri', 'Gilang',
    'Hafiz', 'Haikal', 'Hanif', 'Irfan', 'Kaisar', 'Kevin', 'Lutfi', 'Maulana',
    'Nabil', 'Naufal', 'Pasha', 'Pratama', 'Raditya', 'Rafi', 'Raihan', 'Rama',
    'Rangga', 'Rasya', 'Rayhan', 'Rendi', 'Ridwan', 'Rifki', 'Rizki', 'Satria',
    'Sultan', 'Tegar', 'Vino', 'Wildan', 'Yusuf', 'Zaki', 'Zidan',
  ];
  const femaleFirstNames = [
    'Adelia', 'Aisyah', 'Alika', 'Amira', 'Anindya', 'Anisa', 'Aqila', 'Aulia',
    'Aurel', 'Azka', 'Bilqis', 'Cahaya', 'Cantika', 'Citra', 'Dara', 'Dinda',
    'Dita', 'Eka', 'Elisa', 'Elsa', 'Fara', 'Fatimah', 'Fauzia', 'Gita',
    'Hana', 'Intan', 'Jasmine', 'Kamila', 'Kayla', 'Keisha', 'Khalisa', 'Kirana',
    'Laras', 'Lestari', 'Maheswari', 'Mawar', 'Meisya', 'Melati', 'Nabila', 'Nadia',
    'Nadine', 'Nayla', 'Nazwa', 'Putri', 'Qisya', 'Raisa', 'Rania', 'Rara',
    'Ratna', 'Sabila', 'Safira', 'Salwa', 'Sekar', 'Shafa', 'Syakira', 'Tari',
    'Vania', 'Yasmin', 'Zahira', 'Zaskia',
  ];
  const lastNames = [
    'Nugraha', 'Ramadhani', 'Hidayat', 'Permana', 'Santoso', 'Kurniawan', 'Saputra', 'Lestari',
    'Pratama', 'Wijaya', 'Kusuma', 'Mahendra', 'Suryani', 'Hartono', 'Puspita', 'Fauzi',
    'Setiawan', 'Rahmawati', 'Hermawan', 'Salsabila', 'Utami', 'Prabowo', 'Wulandari', 'Hakim',
    'Nurfadilah', 'Firmansyah', 'Anggraini', 'Rohman', 'Cahyadi', 'Kartika', 'Marlina', 'Zulkarnain',
  ];
  const parentMalePrefixes = ['Bpk. Dedi', 'Bpk. Hendra', 'Bpk. Agus', 'Bpk. Taufik', 'Bpk. Asep', 'Bpk. Budi', 'Bpk. Iman', 'Bpk. Wahyu', 'Bpk. Ujang', 'Bpk. Rudi', 'Bpk. Yudi', 'Bpk. Arif'];
  const parentFemalePrefixes = ['Ibu Siti', 'Ibu Yanti', 'Ibu Rina', 'Ibu Dewi', 'Ibu Nani', 'Ibu Euis', 'Ibu Lilis', 'Ibu Sri', 'Ibu Eni', 'Ibu Tuti', 'Ibu Wati', 'Ibu Yani'];
  const sportsPool = [
    'Sepak Bola',
    'Atletik',
    'Bulutangkis',
    'Bola Basket',
    'Bola Voli',
    'Pencak Silat',
    'Aktifitas Aquatik',
  ];
  const activitiesPool = [
    'Tim Futsal Sekolah',
    'PMR & UKS',
    'Pramuka Inti',
    'OSIS Sekbid Olahraga',
    'Paskibra',
    'Tim Voli Sekolah',
    'Tim Basket Putra',
    'Klub Aquatik SMPN 2',
  ];

  const classTargets: Array<{
    className: string;
    level: '7' | '8' | '9';
    targetCount: number;
  }> = [
    { className: 'VII A', level: '7', targetCount: 25 },
    { className: 'VII B', level: '7', targetCount: 25 },
    { className: 'VII C', level: '7', targetCount: 25 },
    { className: 'VIII A', level: '8', targetCount: 25 },
    { className: 'VIII B', level: '8', targetCount: 25 },
    { className: 'VIII C', level: '8', targetCount: 25 },
    { className: 'IX A', level: '9', targetCount: 25 },
    { className: 'IX B', level: '9', targetCount: 25 },
    { className: 'IX C', level: '9', targetCount: 24 },
  ];

  const levelCounters: Record<'7' | '8' | '9', number> = {
    '7': 6,
    '8': 6,
    '9': 6,
  };
  const usedNames = new Set(rawStudents.map((s) => s.name));
  let genIdx = 0;

  for (const cfg of classTargets) {
    const existingInClass = rawStudents.filter(
      (s) => s.className === cfg.className
    ).length;
    const needed = Math.max(0, cfg.targetCount - existingInClass);
    for (let k = 0; k < needed; k++) {
      levelCounters[cfg.level] += 1;
      const seq = levelCounters[cfg.level];
      const gender: 'L' | 'P' = genIdx % 2 === 0 ? 'L' : 'P';
      const firstPool = gender === 'L' ? maleFirstNames : femaleFirstNames;
      let fullName = '';
      for (let attempt = 0; attempt < 200; attempt++) {
        const first =
          firstPool[(genIdx * 7 + attempt * 3) % firstPool.length];
        const middle =
          lastNames[(genIdx * 11 + attempt * 5 + 3) % lastNames.length];
        const last =
          lastNames[(genIdx * 13 + attempt * 7 + 9) % lastNames.length];
        const candidate =
          attempt === 0
            ? `${first} ${middle}`
            : middle !== last
              ? `${first} ${middle} ${last}`
              : `${first} ${middle} ${seq}`;
        if (!usedNames.has(candidate)) {
          fullName = candidate;
          usedNames.add(candidate);
          break;
        }
      }
      if (!fullName) {
        fullName = `${firstPool[genIdx % firstPool.length]} ${lastNames[genIdx % lastNames.length]} ${seq}`;
      }

      const nisPrefix =
        cfg.level === '7' ? '242507' : cfg.level === '8' ? '232408' : '222309';
      const nis = `${nisPrefix}${String(seq).padStart(3, '0')}`;
      const rfidPrefix =
        cfg.level === '7'
          ? 'RF-2425-'
          : cfg.level === '8'
            ? 'RF-2324-'
            : 'RF-2223-';
      const rfidNum =
        cfg.level === '7' ? seq : cfg.level === '8' ? 100 + seq : 200 + seq;
      const rfidUid = `${rfidPrefix}${String(rfidNum).padStart(3, '0')}`;

      const parentPrefix =
        genIdx % 2 === 0
          ? parentMalePrefixes[genIdx % parentMalePrefixes.length]
          : parentFemalePrefixes[genIdx % parentFemalePrefixes.length];
      const nameParts = fullName.split(' ');
      const familySuffix = nameParts[nameParts.length - 1];
      const parentName = `${parentPrefix} ${familySuffix}`;
      const waSuffix = String(700 + genIdx + 10).padStart(4, '0');
      const parentWhatsapp = `62812234${waSuffix}`;

      rawStudents.push({
        nis,
        name: fullName,
        className: cfg.className,
        gender,
        rfidUid,
        parentName,
        parentWhatsapp,
        photoUrl: '',
        primarySportInterest: sportsPool[genIdx % sportsPool.length],
        nonAcademicActivity: activitiesPool[genIdx % activitiesPool.length],
      });
      genIdx += 1;
    }
  }

  const defaultPinHash = hashSecret('123456');
  const students: StoredStudent[] = rawStudents.map((s, idx) => ({
    ...s,
    id: `stu-${idx + 1}`,
    pinHash: defaultPinHash,
  }));

  const grades: GradeRecord[] = [];
  const attendance: AttendanceRecord[] = [];
  const notifications: NotificationRecord[] = [];

  // Default initial score 75 for all default students across 3 semesters & 8 materials
  students.forEach((student, sIdx) => {
    DEFAULT_SEMESTERS.forEach((semester, semIdx) => {
      PJOK_MATERIALS.forEach((mat) => {
        const praktikScore = DEFAULT_SEED_SCORE;
        const pengetahuanScore = DEFAULT_SEED_SCORE;
        const teacherNote = buildAutoGradeDescription(
          praktikScore,
          pengetahuanScore,
          mat.name
        );

        grades.push({
          id: `grd-${student.id}-${semIdx}-${mat.code}`,
          studentId: student.id,
          semester,
          materialCode: mat.code as MaterialCode,
          materialName: mat.name,
          praktikScore,
          pengetahuanScore,
          teacherNote,
          updatedAt: '2026-11-19T08:30:00.000Z',
        });
      });
    });

    // Default attendance starts empty (0%) until teacher records QR/RFID/manual attendance

    // Seed automatic grade update & parent progress notifications
    notifications.push({
      id: `notif-grd-${student.id}`,
      studentId: student.id,
      targetRole: 'all',
      type: 'GRADE_UPDATE',
      title: 'Pembaruan Nilai PJOK Semester Ganjil 2026/2027',
      message: `Galih Cipta Setia, S.Pd. telah memperbarui nilai Praktik dan Pengetahuan materi Atletik & Kebugaran Jasmani untuk ${student.name}.`,
      isRead: sIdx > 2,
      whatsappSent: true,
      whatsappUrl: buildWhatsappUrl(
        student.parentWhatsapp,
        `[SMPN 2 Ciamis - Progres PJOK] Yth. ${student.parentName}, nilai terbaru PJOK ananda ${student.name} (${student.className}) Semester Ganjil 2026/2027 telah diperbarui oleh Galih Cipta Setia, S.Pd. Silakan pantau melalui Portal PJOK menggunakan NIS ${student.nis}.`
      ),
      createdAt: '2026-11-16T09:15:00.000Z',
    });
  });

  return {
    settings,
    adminCredentials: {
      username: 'galihpjok26',
      passwordHash: hashSecret('galihpjok26'),
      displayName: 'Galih Cipta Setia, S.Pd.',
      nip: '19890526 202221 1 006',
    },
    materials: PJOK_MATERIALS.map((m) => ({ code: m.code, name: m.name })),
    semesters: [...DEFAULT_SEMESTERS],
    semesterKkm: Object.fromEntries(
      DEFAULT_SEMESTERS.map((s) => [s, DEFAULT_KKM])
    ),
    classKkm: { ...DEFAULT_CLASS_KKM },
    students,
    grades,
    attendance,
    notifications,
  };
}

let cachedDb: DatabaseState | null = null;

export function getDb(): DatabaseState {
  if (cachedDb) return cachedDb;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      cachedDb = JSON.parse(raw) as DatabaseState;
      let needsMigration = false;
      if (
        isLegacy18SeedStudents(cachedDb.students) &&
        isOutdatedDefaultMaterials(cachedDb.materials)
      ) {
        const fresh = createSeedDatabase();
        fresh.adminCredentials = cachedDb.adminCredentials;
        if (cachedDb.settings) {
          fresh.settings = {
            ...fresh.settings,
            ...cachedDb.settings,
          };
        }
        cachedDb = fresh;
        saveDb(cachedDb);
        return cachedDb;
      }
      if (hasLegacyDefaultMaterials(cachedDb.materials)) {
        cachedDb.materials = PJOK_MATERIALS.map((m) => ({
          code: m.code,
          name: m.name,
        }));
        cachedDb.grades = migrateLegacyGrades(cachedDb.grades);
        needsMigration = true;
      } else if (isPrevious7DefaultMaterials(cachedDb.materials)) {
        cachedDb.materials = PJOK_MATERIALS.map((m) => ({
          code: m.code,
          name: m.name,
        }));
        needsMigration = true;
      }
      if (isOldDeterministicSeedGrades(cachedDb.grades)) {
        cachedDb.grades = cachedDb.grades.map((g) => ({
          ...g,
          praktikScore: DEFAULT_SEED_SCORE,
          pengetahuanScore: DEFAULT_SEED_SCORE,
          teacherNote: buildAutoGradeDescription(
            DEFAULT_SEED_SCORE,
            DEFAULT_SEED_SCORE,
            g.materialName
          ),
          updatedAt: '2026-11-19T08:30:00.000Z',
        }));
        needsMigration = true;
      }
      if (cachedDb.settings && !cachedDb.settings.heroImageUrl) {
        cachedDb.settings.heroImageUrl =
          '/src/assets/images/hero_sports_arena_1794923888842.jpg';
        needsMigration = true;
      }
      if (!Array.isArray(cachedDb.semesters) || cachedDb.semesters.length === 0) {
        const semSet = new Set<string>(DEFAULT_SEMESTERS);
        cachedDb.grades.forEach((g) => {
          if (g.semester) semSet.add(g.semester);
        });
        if (cachedDb.settings?.activeSemester) {
          semSet.add(cachedDb.settings.activeSemester);
        }
        cachedDb.semesters = Array.from(semSet);
        needsMigration = true;
      }
      if (!cachedDb.semesterKkm || typeof cachedDb.semesterKkm !== 'object') {
        cachedDb.semesterKkm = {};
        needsMigration = true;
      }
      for (const sem of cachedDb.semesters) {
        if (typeof cachedDb.semesterKkm[sem] !== 'number') {
          cachedDb.semesterKkm[sem] = DEFAULT_KKM;
          needsMigration = true;
        }
      }
      if (!cachedDb.classKkm || typeof cachedDb.classKkm !== 'object') {
        cachedDb.classKkm = { ...DEFAULT_CLASS_KKM };
        for (const sem of cachedDb.semesters) {
          if (cachedDb.semesterKkm[sem] === 75) {
            cachedDb.semesterKkm[sem] = DEFAULT_KKM;
          }
        }
        needsMigration = true;
      } else {
        const normalizedClassKkm = normalizeClassKkmMap(cachedDb.classKkm);
        if (
          cachedDb.classKkm['7'] === undefined ||
          cachedDb.classKkm['8'] === undefined ||
          cachedDb.classKkm['9'] === undefined
        ) {
          cachedDb.classKkm = normalizedClassKkm;
          needsMigration = true;
        }
      }
      const reconciled = reconcileAllGradesConsistency({
        students: cachedDb.students,
        materials: getAvailableMaterials(cachedDb),
        grades: cachedDb.grades,
      });
      if (reconciled.changed) {
        cachedDb.grades = reconciled.grades;
        needsMigration = true;
      }
      const strippedAttendance = stripSeedDefaultAttendance(
        cachedDb.attendance ?? []
      );
      if (strippedAttendance.removedCount > 0) {
        cachedDb.attendance = strippedAttendance.attendance;
        needsMigration = true;
      }
      if (needsMigration) {
        saveDb(cachedDb);
      }
      return cachedDb;
    } catch {
      cachedDb = createSeedDatabase();
      saveDb(cachedDb);
      return cachedDb;
    }
  }
  cachedDb = createSeedDatabase();
  saveDb(cachedDb);
  return cachedDb;
}

export function saveDb(nextDb: DatabaseState): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  cachedDb = nextDb;
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(nextDb, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

export function resetDatabaseToSeed(): DatabaseState {
  const existing = getDb();
  const fresh = createSeedDatabase();
  fresh.adminCredentials = existing.adminCredentials;
  saveDb(fresh);
  return fresh;
}

export function sanitizeStudent(s: StoredStudent): StudentRecord {
  const { pinHash: _ignored, ...rest } = s;
  return rest;
}

export function getAvailableClasses(db: DatabaseState): string[] {
  return extractActiveClasses(db.students);
}

export function getAvailableMaterials(db: DatabaseState): MaterialDefinition[] {
  if (Array.isArray(db.materials) && db.materials.length > 0) {
    return db.materials;
  }
  return PJOK_MATERIALS.map((m) => ({ code: m.code, name: m.name }));
}

export function getAvailableSemesters(db: DatabaseState): string[] {
  if (Array.isArray(db.semesters) && db.semesters.length > 0) {
    const set = new Set<string>(db.semesters);
    if (db.settings?.activeSemester) {
      set.add(db.settings.activeSemester);
    }
    return Array.from(set);
  }
  const set = new Set<string>(DEFAULT_SEMESTERS);
  db.grades.forEach((g) => {
    if (g.semester) set.add(g.semester);
  });
  if (db.settings?.activeSemester) {
    set.add(db.settings.activeSemester);
  }
  return Array.from(set);
}

export function getSemesterKkmMap(db: DatabaseState): Record<string, number> {
  const semesters = getAvailableSemesters(db);
  const stored = db.semesterKkm ?? {};
  const map: Record<string, number> = {};
  for (const sem of semesters) {
    const val = stored[sem];
    map[sem] =
      typeof val === 'number' && !Number.isNaN(val)
        ? Math.max(0, Math.min(100, Math.round(val)))
        : DEFAULT_KKM;
  }
  return map;
}

export function getClassKkmMap(db: DatabaseState): Record<string, number> {
  return normalizeClassKkmMap(db.classKkm);
}

export async function dispatchWhatsappGateway(
  settings: SchoolSettings,
  targetPhone: string,
  message: string
): Promise<boolean> {
  if (!settings.whatsappGatewayUrl || !settings.whatsappGatewayToken) {
    return false;
  }
  try {
    const response = await fetch(settings.whatsappGatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: settings.whatsappGatewayToken,
      },
      body: JSON.stringify({
        target: normalizePhone(targetPhone),
        message,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
