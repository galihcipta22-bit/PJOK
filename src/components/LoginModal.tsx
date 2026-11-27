import { KeyRound, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { tryJsonApiFetch } from '../lib/cloudAdminOperations.ts';
import {
  AUTHORIZED_ADMIN_EMAIL,
  CLOUD_ADMIN_TOKEN,
  getStudentReportFromCloudByNis,
  isFirebaseAdminReady,
  signInAdminWithGoogle,
} from '../lib/cloudStore.ts';

interface LoginModalProps {
  open: boolean;
  initialTab: 'student' | 'admin';
  onClose: () => void;
  onStudentSuccess: (token: string, nis: string) => void;
  onAdminSuccess: (token: string) => void;
}

export function LoginModal({
  open,
  initialTab,
  onClose,
  onStudentSuccess,
  onAdminSuccess,
}: LoginModalProps) {
  const [tab, setTab] = useState<'student' | 'admin'>(initialTab);
  const [nis, setNis] = useState('');
  const [adminId, setAdminId] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  async function handleStudentSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const cleanNis = nis.trim();
    try {
      const apiRes = await tryJsonApiFetch<{ token?: string; error?: string }>(
        '/api/auth/student',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nis: cleanNis }),
        }
      );

      if (apiRes.reachable && apiRes.ok && apiRes.data.token) {
        onStudentSuccess(apiRes.data.token, cleanNis);
        onClose();
        return;
      }

      // Cross-device fallback: verify student report in Cloud Firestore by hashed NISN
      const cloudReport = await getStudentReportFromCloudByNis(cleanNis);
      if (cloudReport) {
        onStudentSuccess(`cloud-student:${cleanNis}`, cleanNis);
        onClose();
        return;
      }

      setError(
        (apiRes.reachable ? apiRes.data.error : '') ||
          'Nomor Induk Siswa Nasional (NISN) tidak ditemukan.'
      );
    } catch {
      const cloudReport = await getStudentReportFromCloudByNis(cleanNis);
      if (cloudReport) {
        onStudentSuccess(`cloud-student:${cleanNis}`, cleanNis);
        onClose();
        return;
      }
      setError('Tidak dapat terhubung ke server otentikasi.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const cleanAdminId = adminId.trim();
    try {
      const apiRes = await tryJsonApiFetch<{ token?: string; error?: string }>(
        '/api/auth/admin',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminId: cleanAdminId }),
        }
      );

      if (apiRes.reachable) {
        if (!apiRes.ok || !apiRes.data.token) {
          setError(apiRes.data.error || 'ID Admin Guru PJOK tidak valid.');
          return;
        }

        if (!isFirebaseAdminReady()) {
          try {
            await signInAdminWithGoogle('Galih Cipta Setia, S.Pd.');
          } catch (cloudErr) {
            const msg =
              cloudErr instanceof Error
                ? cloudErr.message
                : 'Login Google Cloud gagal.';
            const isWrongAccount = msg.includes(
              'bukan admin guru PJOK terdaftar'
            );
            if (isWrongAccount) {
              setError(msg);
              return;
            }
            // Allow entry so teacher can click "Hubungkan Cloud Google" directly in the header
            console.warn('Google Cloud popup skipped during login:', msg);
          }
        }

        onAdminSuccess(apiRes.data.token);
        onClose();
        return;
      }

      // Cross-device Cloud-only fallback when /api/auth/admin is unreachable (other devices/browsers)
      if (cleanAdminId !== 'galihpjok26') {
        setError('ID Admin Guru PJOK tidak valid.');
        return;
      }

      if (!isFirebaseAdminReady()) {
        try {
          await signInAdminWithGoogle('Galih Cipta Setia, S.Pd.');
        } catch (cloudErr) {
          const msg =
            cloudErr instanceof Error
              ? cloudErr.message
              : 'Verifikasi akun Google Admin gagal.';
          if (/popup|jendela/i.test(msg)) {
            setError(
              `${msg} Gunakan tombol "Masuk via Google Admin" di bawah agar popup langsung diizinkan oleh browser perangkat ini.`
            );
          } else {
            setError(msg);
          }
          return;
        }
      }

      onAdminSuccess(CLOUD_ADMIN_TOKEN);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Gagal memverifikasi akses Admin Guru PJOK.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleAdminLogin() {
    setError('');
    setGoogleLoading(true);
    try {
      // Trigger Google sign-in synchronously from user click so mobile/strict browsers allow popup
      if (!isFirebaseAdminReady()) {
        await signInAdminWithGoogle('Galih Cipta Setia, S.Pd.');
      }

      // Check if local backend is also reachable so hybrid sync can run if available
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2500);
      try {
        const apiRes = await tryJsonApiFetch<{ token?: string }>(
          '/api/auth/admin',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminId: 'galihpjok26' }),
            signal: controller.signal,
          }
        );
        if (apiRes.reachable && apiRes.ok && apiRes.data.token) {
          onAdminSuccess(apiRes.data.token);
          onClose();
          return;
        }
      } finally {
        window.clearTimeout(timeoutId);
      }

      onAdminSuccess(CLOUD_ADMIN_TOKEN);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Gagal masuk dengan akun Google Admin (${AUTHORIZED_ADMIN_EMAIL}).`
      );
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2
              id="login-modal-title"
              className="font-display text-lg font-bold text-slate-900"
            >
              Akses Akun Portal PJOK
            </h2>
            <p className="text-xs text-slate-500">
              SMPN 2 Ciamis · Masuk dengan NISN Siswa atau ID Guru
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup jendela masuk"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-6 pt-5">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setTab('student');
                setError('');
              }}
              className={`flex items-center justify-center gap-2 rounded-md py-2 text-xs font-semibold transition-colors ${
                tab === 'student'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserCheck className="h-4 w-4" />
              <span>Siswa (NISN)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('admin');
                setError('');
              }}
              className={`flex items-center justify-center gap-2 rounded-md py-2 text-xs font-semibold transition-colors ${
                tab === 'admin'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>Admin Guru PJOK</span>
            </button>
          </div>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          {tab === 'student' ? (
            <form onSubmit={handleStudentSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="student-nis"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Nomor Induk Siswa Nasional (NISN)
                </label>
                <input
                  id="student-nis"
                  type="text"
                  required
                  autoFocus
                  value={nis}
                  onChange={(e) => setNis(e.target.value)}
                  placeholder="Masukkan NISN Anda (contoh: 0123456789)"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
              >
                {loading ? 'Memeriksa NISN...' : 'Masuk ke Rapor & Kartu Atlet'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="admin-id"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    ID Admin Guru PJOK
                  </label>
                  <input
                    id="admin-id"
                    type="text"
                    required
                    autoFocus
                    value={adminId}
                    onChange={(e) => setAdminId(e.target.value)}
                    placeholder="Masukkan ID Admin Guru PJOK"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                >
                  <KeyRound className="h-4 w-4" />
                  <span>
                    {loading ? 'Memverifikasi ID...' : 'Masuk Dashboard Guru PJOK'}
                  </span>
                </button>
              </form>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-[11px] uppercase">
                  <span className="bg-white px-2 text-slate-400">
                    atau login lintas perangkat
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleGoogleAdminLogin()}
                disabled={loading || googleLoading}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                <span>
                  {googleLoading
                    ? 'Membuka Login Google Admin...'
                    : `Masuk via Google Admin (${AUTHORIZED_ADMIN_EMAIL})`}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
