import { onAuthStateChanged } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminDashboard,
  type AdminRefreshScope,
} from './components/AdminDashboard.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { Footer } from './components/Footer.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import { Navbar } from './components/Navbar.tsx';
import { PublicDashboard } from './components/PublicDashboard.tsx';
import { StudentPortal } from './components/StudentPortal.tsx';
import { WelcomeSplash } from './components/WelcomeSplash.tsx';
import {
  getPublicOverviewFromCloud,
  getStudentReportFromCloudByNis,
  isFirebaseAdminReady,
  loadAdminDashboardFromCloud,
  signInAdminWithGoogle,
  signOutFirebase,
  subscribePublicOverviewFromCloud,
  subscribeStudentReportFromCloudByNis,
  syncAttendanceDeltaToCloud,
  syncConfigAndOverviewToCloud,
  syncFullDatabaseToCloud,
  syncGradeDeltaToCloud,
  syncStudentsDeltaToCloud,
} from './lib/cloudStore.ts';
import { auth } from './lib/firebase.ts';
import type {
  AdminDashboardPayload,
  AdminStudentSummary,
  GradeRecord,
  NotificationRecord,
  PublicOverviewResponse,
  SchoolSettings,
  StudentPortalPayload,
} from './types.ts';
import { analyzeTalent, computeFutStats } from './utils/athleteAnalytics.ts';

const FALLBACK_SETTINGS: SchoolSettings = {
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

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [role, setRole] = useState<'public' | 'student' | 'admin'>(() => {
    const savedRole = sessionStorage.getItem('pjok_role');
    if (savedRole === 'student' || savedRole === 'admin') return savedRole;
    return 'public';
  });
  const [token, setToken] = useState<string>(
    () => sessionStorage.getItem('pjok_token') || ''
  );
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [cloudAdminConnected, setCloudAdminConnected] = useState(() =>
    isFirebaseAdminReady()
  );

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginTab, setLoginTab] = useState<'student' | 'admin'>('student');

  const [selectedClass, setSelectedClass] = useState('Semua Kelas');
  const [selectedSemester, setSelectedSemester] = useState('Ganjil 2026/2027');
  const [publicData, setPublicData] = useState<PublicOverviewResponse | null>(
    null
  );
  const [publicLoading, setPublicLoading] = useState(true);

  const [studentData, setStudentData] = useState<StudentPortalPayload | null>(
    null
  );
  const [adminData, setAdminData] = useState<AdminDashboardPayload | null>(
    null
  );
  const [authLoading, setAuthLoading] = useState(false);
  const [adminLoadError, setAdminLoadError] = useState<string | null>(null);
  const [adminCloudWarning, setAdminCloudWarning] = useState<string | null>(
    null
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, () => {
      setCloudAdminConnected(isFirebaseAdminReady());
      setFirebaseReady(true);
    });
    return () => unsub();
  }, []);

  const hydrateServerFromCloud = useCallback(
    async (authToken: string, payload: AdminDashboardPayload) => {
      try {
        await fetch('/api/admin/hydrate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.warn('Server hydrate skipped:', err);
      }
    },
    []
  );

  const fetchPublicOverview = useCallback(
    async (cls: string, sem: string) => {
      setPublicLoading(true);
      try {
        const cloudOverview = await getPublicOverviewFromCloud(cls, sem);
        if (cloudOverview) {
          setPublicData(cloudOverview);
          if (cloudOverview.selectedClass && cloudOverview.selectedClass !== cls) {
            setSelectedClass(cloudOverview.selectedClass);
          }
          if (
            cloudOverview.selectedSemester &&
            cloudOverview.selectedSemester !== sem
          ) {
            setSelectedSemester(cloudOverview.selectedSemester);
          }
          return;
        }

        const params = new URLSearchParams({
          className: cls,
          semester: sem,
        });
        const res = await fetch(`/api/public/overview?${params.toString()}`);
        if (res.ok) {
          const json = (await res.json()) as PublicOverviewResponse;
          setPublicData(json);
          if (json.selectedClass && json.selectedClass !== cls) {
            setSelectedClass(json.selectedClass);
          }
          if (json.selectedSemester && json.selectedSemester !== sem) {
            setSelectedSemester(json.selectedSemester);
          }
        }
      } catch (err) {
        console.warn('Public overview fetch failed:', err);
      } finally {
        setPublicLoading(false);
      }
    },
    []
  );

  const getStudentPayloadFreshness = useCallback(
    (payload: StudentPortalPayload | null): number => {
      if (!payload) return 0;
      let maxTs = 0;
      payload.grades.forEach((g) => {
        const ts = g.updatedAt ? Date.parse(g.updatedAt) || 0 : 0;
        if (ts > maxTs) maxTs = ts;
      });
      payload.notifications.forEach((n) => {
        const ts = n.createdAt ? Date.parse(n.createdAt) || 0 : 0;
        if (ts > maxTs) maxTs = ts;
      });
      return maxTs;
    },
    []
  );

  const fetchStudentPortal = useCallback(
    async (authToken: string) => {
      setAuthLoading(true);
      try {
        const savedNis = sessionStorage.getItem('pjok_student_nis') || '';
        const isCloudOnlyToken = authToken.startsWith('cloud-student:');

        const cloudPromise = savedNis
          ? getStudentReportFromCloudByNis(savedNis)
          : Promise.resolve(null);

        if (isCloudOnlyToken) {
          const cloudReport = await cloudPromise;
          if (cloudReport) {
            setStudentData(cloudReport);
            return;
          }
          sessionStorage.removeItem('pjok_role');
          sessionStorage.removeItem('pjok_token');
          sessionStorage.removeItem('pjok_student_nis');
          setRole('public');
          setToken('');
          return;
        }

        const [serverRes, cloudReport] = await Promise.all([
          fetch('/api/student/me', {
            headers: { Authorization: `Bearer ${authToken}` },
          }).catch(() => null),
          cloudPromise,
        ]);

        if (serverRes && serverRes.ok) {
          const serverReport = (await serverRes.json()) as StudentPortalPayload;
          if (!cloudReport) {
            setStudentData(serverReport);
            return;
          }
          const serverTs = getStudentPayloadFreshness(serverReport);
          const cloudTs = getStudentPayloadFreshness(cloudReport);
          const serverDiffers =
            serverReport.grades.length !== cloudReport.grades.length;
          // Prefer whichever snapshot has newer edits; tie-break toward live server data
          if (cloudTs > serverTs && !serverDiffers) {
            setStudentData(cloudReport);
          } else if (cloudTs > serverTs + 5000) {
            setStudentData(cloudReport);
          } else {
            setStudentData(serverReport);
          }
          return;
        }

        if (cloudReport) {
          setStudentData(cloudReport);
          return;
        }

        sessionStorage.removeItem('pjok_role');
        sessionStorage.removeItem('pjok_token');
        sessionStorage.removeItem('pjok_student_nis');
        setRole('public');
        setToken('');
      } catch (err) {
        console.warn('Student portal fetch failed:', err);
      } finally {
        setAuthLoading(false);
      }
    },
    [getStudentPayloadFreshness]
  );

  const fetchAdminDashboard = useCallback(
    async (
      authToken: string,
      syncScope: false | AdminRefreshScope = false
    ) => {
      setAuthLoading(true);
      setAdminLoadError(null);
      setAdminCloudWarning(null);
      try {
        const res = await fetch('/api/admin/dashboard', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) {
          if (res.status === 401) {
            sessionStorage.removeItem('pjok_role');
            sessionStorage.removeItem('pjok_token');
            setRole('public');
            setToken('');
            setLoginTab('admin');
            setLoginOpen(true);
            return;
          }
          setAdminLoadError(
            'Gagal memuat data dashboard dari server. Silakan coba muat ulang.'
          );
          return;
        }
        const serverPayload = (await res.json()) as AdminDashboardPayload;
        // Immediately show local server data so admin never sees a blank dashboard
        setAdminData(serverPayload);

        if (isFirebaseAdminReady()) {
          try {
            if (syncScope && syncScope !== 'pull') {
              let synced: AdminDashboardPayload;
              if (syncScope === 'config') {
                synced = await syncConfigAndOverviewToCloud(serverPayload);
              } else if (syncScope === 'attendance') {
                synced = await syncAttendanceDeltaToCloud(serverPayload);
              } else if (syncScope === 'students') {
                synced = await syncStudentsDeltaToCloud(serverPayload);
              } else {
                synced = await syncFullDatabaseToCloud(serverPayload);
              }
              if (synced && synced.students.length > 0) {
                await hydrateServerFromCloud(authToken, synced);
                setAdminData(synced);
              }
            } else {
              const cloudPayload =
                await loadAdminDashboardFromCloud(serverPayload);
              if (cloudPayload && cloudPayload.students.length > 0) {
                const safePayload: AdminDashboardPayload =
                  cloudPayload.grades.length === 0 &&
                  serverPayload.grades.length > 0
                    ? { ...cloudPayload, grades: serverPayload.grades }
                    : cloudPayload;
                await hydrateServerFromCloud(authToken, safePayload);
                setAdminData(safePayload);
                void fetchPublicOverview(selectedClass, selectedSemester);
              }
            }
          } catch (cloudErr) {
            const rawMsg =
              cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
            console.warn('Cloud Firestore admin sync fallback:', rawMsg);
            const isQuota = /quota|resource-exhausted/i.test(rawMsg);
            setAdminCloudWarning(
              isQuota
                ? 'Batas kuota harian Cloud Firestore tercapai, sehingga data ditampilkan dari database server lokal. Semua data siswa & nilai tetap aman.'
                : 'Sinkronisasi Cloud Firestore sementara tertunda. Data ditampilkan dari database server lokal.'
            );
          }
        }
      } catch (err) {
        console.warn('Admin dashboard fetch failed:', err);
        setAdminLoadError(
          'Tidak dapat terhubung ke server dashboard. Periksa koneksi lalu coba muat ulang.'
        );
      } finally {
        setAuthLoading(false);
      }
    },
    [hydrateServerFromCloud, fetchPublicOverview, selectedClass, selectedSemester]
  );

  useEffect(() => {
    void fetchPublicOverview(selectedClass, selectedSemester);
  }, [fetchPublicOverview, selectedClass, selectedSemester]);

  useEffect(() => {
    if (role !== 'public') return;
    return subscribePublicOverviewFromCloud(
      selectedClass,
      selectedSemester,
      (overview) => {
        setPublicData(overview);
        setPublicLoading(false);
      }
    );
  }, [role, selectedClass, selectedSemester]);

  useEffect(() => {
    if (!firebaseReady) return;
    if (role === 'student' && token) {
      void fetchStudentPortal(token);
      const savedNis = sessionStorage.getItem('pjok_student_nis') || '';
      if (savedNis) {
        return subscribeStudentReportFromCloudByNis(savedNis, (report) => {
          setStudentData((prev) => {
            if (!prev || token.startsWith('cloud-student:')) return report;
            const prevTs = getStudentPayloadFreshness(prev);
            const nextTs = getStudentPayloadFreshness(report);
            if (nextTs > prevTs) return report;
            if (nextTs === prevTs && report.grades.length >= prev.grades.length) {
              return report;
            }
            return prev;
          });
          setAuthLoading(false);
        });
      }
    } else if (role === 'admin' && token) {
      void fetchAdminDashboard(token, false);
    }
  }, [
    firebaseReady,
    role,
    token,
    fetchStudentPortal,
    fetchAdminDashboard,
    getStudentPayloadFreshness,
  ]);

  function handleStudentLoginSuccess(newToken: string, nis: string) {
    sessionStorage.setItem('pjok_role', 'student');
    sessionStorage.setItem('pjok_token', newToken);
    sessionStorage.setItem('pjok_student_nis', nis);
    setToken(newToken);
    setRole('student');
  }

  const handleApplyGradeMutations = useCallback(
    (mutation: {
      savedGrades: GradeRecord[];
      createdStudents?: AdminStudentSummary[];
      createdNotifications?: NotificationRecord[];
      availableSemesters?: string[];
      replaceAllGrades?: boolean;
      removedGradeIds?: string[];
    }) => {
      let nextSnapshot: AdminDashboardPayload | null = null;
      let semestersChanged = false;

      setAdminData((prev) => {
        if (!prev) return prev;
        const {
          savedGrades,
          createdStudents = [],
          createdNotifications = [],
          availableSemesters,
          replaceAllGrades = false,
          removedGradeIds = [],
        } = mutation;

        let nextGrades: GradeRecord[];
        if (replaceAllGrades) {
          nextGrades = [...savedGrades];
        } else {
          const removedSet = new Set(removedGradeIds);
          const mergedMap = new Map<string, GradeRecord>();
          prev.grades.forEach((g) => {
            if (!removedSet.has(g.id)) {
              mergedMap.set(
                `${g.studentId}::${g.semester}::${g.materialCode}`,
                g
              );
            }
          });
          savedGrades.forEach((g) => {
            mergedMap.set(
              `${g.studentId}::${g.semester}::${g.materialCode}`,
              g
            );
          });
          nextGrades = Array.from(mergedMap.values());
        }

        const existingStudentIds = new Set(prev.students.map((s) => s.id));
        const mergedStudentsBase = [
          ...prev.students,
          ...createdStudents.filter((s) => !existingStudentIds.has(s.id)),
        ];

        const affectedStudentIds = new Set<string>([
          ...savedGrades.map((g) => g.studentId),
          ...createdStudents.map((s) => s.id),
        ]);
        if (removedGradeIds.length > 0) {
          prev.grades.forEach((g) => {
            if (removedGradeIds.includes(g.id)) {
              affectedStudentIds.add(g.studentId);
            }
          });
        }

        const nextStudents = mergedStudentsBase.map((stu) => {
          if (!replaceAllGrades && !affectedStudentIds.has(stu.id)) {
            return stu;
          }
          const sGrades = nextGrades.filter((g) => g.studentId === stu.id);
          const sAtt = prev.attendance.filter((a) => a.studentId === stu.id);
          const futStats = computeFutStats(
            stu,
            sGrades,
            sAtt,
            prev.settings.activeSemester,
            prev.availableMaterials
          );
          const talent = analyzeTalent(stu, sGrades, sAtt, futStats);
          return { ...stu, futStats, talent };
        });

        const nextSemesters =
          availableSemesters && availableSemesters.length > 0
            ? availableSemesters
            : prev.availableSemesters;
        semestersChanged =
          nextSemesters.length !== prev.availableSemesters.length ||
          nextSemesters.some((s, i) => s !== prev.availableSemesters[i]);

        const existingNotifIds = new Set(prev.notifications.map((n) => n.id));
        const nextNotifications = [
          ...createdNotifications.filter((n) => !existingNotifIds.has(n.id)),
          ...prev.notifications,
        ];

        nextSnapshot = {
          ...prev,
          students: nextStudents,
          grades: nextGrades,
          notifications: nextNotifications,
          availableSemesters: nextSemesters,
        };
        return nextSnapshot;
      });

      if (nextSnapshot && isFirebaseAdminReady()) {
        const snapshotToSync = nextSnapshot;
        const onSyncOk = () => {
          setAdminCloudWarning(null);
          void fetchPublicOverview(selectedClass, selectedSemester);
        };
        const onSyncErr = (err: unknown) => {
          const rawMsg = err instanceof Error ? err.message : String(err);
          console.warn('Background cloud sync error:', rawMsg);
          const isQuota = /quota|resource-exhausted/i.test(rawMsg);
          setAdminCloudWarning(
            isQuota
              ? 'Batas kuota harian Cloud Firestore tercapai saat menyinkronkan nilai. Data tetap aman tersimpan di server lokal.'
              : 'Sinkronisasi nilai ke Cloud Firestore tertunda. Klik "Cloud Tersinkron" untuk mencoba menyinkronkan ulang.'
          );
        };
        if (mutation.replaceAllGrades || (mutation.removedGradeIds?.length ?? 0) > 0) {
          void syncFullDatabaseToCloud(snapshotToSync)
            .then(onSyncOk)
            .catch(onSyncErr);
        } else {
          void syncGradeDeltaToCloud({
            payload: snapshotToSync,
            savedGrades: mutation.savedGrades,
            createdStudents: mutation.createdStudents,
            createdNotifications: mutation.createdNotifications,
            semestersChanged,
          })
            .then(onSyncOk)
            .catch(onSyncErr);
        }
      }
    },
    [fetchPublicOverview, selectedClass, selectedSemester]
  );

  function handleAdminLoginSuccess(newToken: string) {
    sessionStorage.setItem('pjok_role', 'admin');
    sessionStorage.setItem('pjok_token', newToken);
    setCloudAdminConnected(isFirebaseAdminReady());
    setToken(newToken);
    setRole('admin');
  }

  function handleLogout() {
    sessionStorage.removeItem('pjok_role');
    sessionStorage.removeItem('pjok_token');
    sessionStorage.removeItem('pjok_student_nis');
    setRole('public');
    setToken('');
    setStudentData(null);
    setAdminData(null);
    void signOutFirebase();
    void fetchPublicOverview(selectedClass, selectedSemester);
  }

  async function handleConnectCloud(): Promise<void> {
    await signInAdminWithGoogle('Galih Cipta Setia, S.Pd.');
    setCloudAdminConnected(isFirebaseAdminReady());
    if (token) {
      await fetchAdminDashboard(token, false);
      await fetchPublicOverview(selectedClass, selectedSemester);
    }
  }

  function handleNavigateSection(sectionId: string) {
    if (sectionId === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const activeSettings =
    (role === 'admin' && adminData?.settings) ||
    (role === 'student' && studentData?.settings) ||
    publicData?.settings ||
    FALLBACK_SETTINGS;

  const activeUserName =
    role === 'admin'
      ? activeSettings.teacherName
      : role === 'student'
        ? studentData?.student.name
        : undefined;

  return (
    <ErrorBoundary>
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
        <WelcomeSplash
          visible={showSplash}
          logoUrl={activeSettings.logoUrl}
          schoolName={activeSettings.schoolName}
          teacherName={activeSettings.teacherName}
          onComplete={() => setShowSplash(false)}
        />

        <Navbar
          logoUrl={activeSettings.logoUrl}
          schoolName={activeSettings.schoolName}
          role={role}
          userName={activeUserName}
          onOpenLogin={() => {
            setLoginTab('student');
            setLoginOpen(true);
          }}
          onLogout={handleLogout}
          onNavigateSection={handleNavigateSection}
        />

        <div className="flex-1">
          {role === 'public' && (
            <PublicDashboard
              data={publicData}
              loading={publicLoading}
              selectedClass={selectedClass}
              selectedSemester={selectedSemester}
              onChangeClass={setSelectedClass}
              onChangeSemester={setSelectedSemester}
              onOpenLogin={(tab = 'student') => {
                setLoginTab(tab);
                setLoginOpen(true);
              }}
            />
          )}

          {role === 'student' && (
            <>
              {authLoading && !studentData ? (
                <div className="mx-auto max-w-7xl px-4 py-16 text-center text-sm text-slate-500">
                  Memuat data rapor siswa...
                </div>
              ) : (
                studentData && (
                  <StudentPortal
                    token={token}
                    payload={studentData}
                    onRefresh={() => fetchStudentPortal(token)}
                  />
                )
              )}
            </>
          )}

          {role === 'admin' && (
            <>
              {adminData ? (
                <AdminDashboard
                  token={token}
                  payload={adminData}
                  cloudConnected={cloudAdminConnected}
                  cloudWarning={adminCloudWarning}
                  onDismissCloudWarning={() => setAdminCloudWarning(null)}
                  onConnectCloud={handleConnectCloud}
                  onApplyGradeMutations={handleApplyGradeMutations}
                  onRefresh={async (scope = 'full') => {
                    await fetchAdminDashboard(token, scope);
                    await fetchPublicOverview(
                      selectedClass,
                      selectedSemester
                    );
                  }}
                />
              ) : authLoading ? (
                <div className="mx-auto max-w-7xl px-4 py-16 text-center text-sm text-slate-500">
                  Memuat dashboard guru PJOK...
                </div>
              ) : (
                <div className="mx-auto max-w-md px-4 py-16 text-center">
                  <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
                    <p className="text-sm font-semibold text-slate-900">
                      Data Dashboard Belum Termuat
                    </p>
                    <p className="mt-2 text-xs text-slate-600">
                      {adminLoadError ||
                        'Terjadi kendala saat mengambil data dashboard guru.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void fetchAdminDashboard(token, false)}
                      className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Muat Ulang Data Dashboard
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <Footer settings={activeSettings} />

        <LoginModal
          key={loginTab}
          open={loginOpen}
          initialTab={loginTab}
          onClose={() => setLoginOpen(false)}
          onStudentSuccess={handleStudentLoginSuccess}
          onAdminSuccess={handleAdminLoginSuccess}
        />
      </div>
    </ErrorBoundary>
  );
}

