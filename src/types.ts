export type Gender = 'L' | 'P';

export type AttendanceStatus = 'Hadir' | 'Terlambat' | 'Izin' | 'Sakit' | 'Alpa';

export type AttendanceMethod = 'QR_SCAN' | 'RFID_TAP' | 'NFC_TAP' | 'MANUAL';

export type MaterialCode = string;

export interface MaterialDefinition {
  code: string;
  name: string;
}

export interface SchoolSettings {
  schoolName: string;
  teacherName: string;
  teacherNip: string;
  schoolAddress: string;
  activeSemester: string;
  logoUrl: string;
  heroImageUrl?: string;
  whatsappGatewayUrl: string;
  whatsappGatewayToken: string;
  socialLinks: {
    instagram: string;
    youtube: string;
    facebook: string;
    tiktok: string;
  };
}

export interface StudentRecord {
  id: string;
  nis: string;
  name: string;
  className: string;
  gender: Gender;
  rfidUid: string;
  parentName: string;
  parentWhatsapp: string;
  photoUrl: string;
  qrCodeValue?: string;
  qrImageUrl?: string;
  primarySportInterest: string;
  nonAcademicActivity: string;
  pin?: string;
}

export interface GradeRecord {
  id: string;
  studentId: string;
  semester: string;
  materialCode: MaterialCode;
  materialName: string;
  praktikScore: number | null;
  pengetahuanScore: number | null;
  teacherNote: string;
  remedialDetail?: string;
  updatedAt: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  date: string;
  time: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  whatsappNotified: boolean;
  whatsappMessage: string;
  whatsappUrl?: string;
  notifiedAt?: string;
}

export interface NotificationRecord {
  id: string;
  studentId: string;
  targetRole: 'student' | 'parent' | 'all';
  type: 'GRADE_UPDATE' | 'PARENT_PROGRESS' | 'ATTENDANCE_ALERT';
  title: string;
  message: string;
  isRead: boolean;
  whatsappSent: boolean;
  whatsappUrl?: string;
  createdAt: string;
}

export interface FutMaterialScoreItem {
  code: string;
  abbr: string;
  name: string;
  score: number | null;
  praktikScore?: number | null;
  pengetahuanScore?: number | null;
  avgScore?: number | null;
  scoreSource?: 'praktik' | 'pengetahuan' | null;
}

export interface FutCardStats {
  ovr: number;
  tier: 'GOLD' | 'SILVER' | 'BRONZE';
  tierLabel: string;
  positionCode: string;
  positionLabel: string;
  kec: number; // Kecepatan (Atletik & Sprint)
  ket: number; // Ketahanan (Kebugaran & Konsistensi)
  tek: number; // Teknik (Nilai Praktik)
  tak: number; // Taktik (Nilai Pengetahuan)
  dis: number; // Disiplin (Kedisiplinan Kehadiran)
  spo: number; // Sportivitas (Sikap & Olahraga Tim)
  attendanceRate: number;
  avgPraktik: number;
  avgPengetahuan: number;
  avgTotal: number;
  bestMaterialName?: string;
  bestMaterialScore?: number | null;
  materialScores?: FutMaterialScoreItem[];
}

export interface TalentRecommendation {
  primaryTrack: 'Bidang Olahraga' | 'Bidang Akademik Olahraga' | 'Bidang Non-Akademik & Kepemimpinan';
  sportScore: number;
  academicScore: number;
  nonAcademicScore: number;
  recommendedBranch: string;
  summary: string;
  actionPlan: string[];
}

export interface PublicOverviewResponse {
  settings: SchoolSettings;
  availableClasses: string[];
  availableSemesters: string[];
  semesterKkm: Record<string, number>;
  classKkm?: Record<string, number>;
  availableMaterials: { code: MaterialCode; name: string }[];
  selectedClass: string;
  selectedSemester: string;
  summary: {
    totalStudents: number;
    highestScore: number;
    lowestScore: number;
    averageScore: number;
    averagePraktik: number;
    averagePengetahuan: number;
    attendanceRate: number;
  };
  semesterHistory: {
    semester: string;
    avgPraktik: number;
    avgPengetahuan: number;
    avgTotal: number;
  }[];
  classComparison: {
    className: string;
    avgPraktik: number;
    avgPengetahuan: number;
    highest: number;
    lowest: number;
    studentCount: number;
  }[];
  materialBreakdown: {
    materialCode: string;
    materialName: string;
    avgPraktik: number;
    avgPengetahuan: number;
  }[];
  top5ByMaterial: Record<string, TopStudentOverviewItem[]>;
}

export interface TopStudentOverviewItem {
  name: string;
  shortName: string;
  className: string;
  avgPraktik: number | null;
  avgPengetahuan: number | null;
  avgCombined: number;
  bestMaterialName: string;
}

export interface StudentPortalPayload {
  student: StudentRecord;
  settings: SchoolSettings;
  grades: GradeRecord[];
  attendance: AttendanceRecord[];
  notifications: NotificationRecord[];
  availableSemesters: string[];
  semesterKkm: Record<string, number>;
  classKkm?: Record<string, number>;
  availableMaterials: { code: MaterialCode; name: string }[];
  futStats: FutCardStats;
  talent: TalentRecommendation;
}

export interface AdminStudentSummary extends StudentRecord {
  futStats: FutCardStats;
  talent: TalentRecommendation;
  latestAttendance?: AttendanceRecord;
  gradesCount: number;
}

export interface AdminDashboardPayload {
  settings: SchoolSettings;
  students: AdminStudentSummary[];
  grades: GradeRecord[];
  attendance: AttendanceRecord[];
  notifications: NotificationRecord[];
  availableClasses: string[];
  availableSemesters: string[];
  semesterKkm: Record<string, number>;
  classKkm?: Record<string, number>;
  availableMaterials: { code: MaterialCode; name: string }[];
}
