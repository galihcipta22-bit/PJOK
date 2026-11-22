import { KeyRound, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
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
  const [error, setError] = useState('');

  if (!open) return null;

  async function handleStudentSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const cleanNis = nis.trim();
    try {
      const res = await fetch('/api/auth/student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nis: cleanNis }),
      });
      const json = (await res.json()) as { token?: string; error?: string };
      if (res.ok && json.token) {
        onStudentSuccess(json.token, cleanNis);
        onClose();
        return;
      }

      // Cross-device published fallback: verify student report in Cloud Firestore by hashed NIS
      const cloudReport = await getStudentReportFromCloudByNis(cleanNis);
      if (cloudReport) {
        onStudentSuccess(`cloud-student:${cleanNis}`, cleanNis);
        onClose();
        return;
      }

      setError(json.error || 'Nomor Induk Siswa (NIS) tidak ditemukan.');
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
    try {
      const res = await fetch('/api/auth/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId }),
      });
      const json = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !json.token) {
        setError(json.error || 'ID Admin Guru PJOK tidak valid.');
        setLoading(false);
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
          const isWrongAccount = msg.includes('bukan admin guru PJOK terdaftar');
          if (isWrongAccount) {
            setError(msg);
            setLoading(false);
            return;
          }
          // Allow entry so teacher can click "Hubungkan Cloud Google" directly in the header
          console.warn('Google Cloud popup skipped during login:', msg);
        }
      }

      onAdminSuccess(json.token);
      onClose();
    } catch {
      setError('Tidak dapat terhubung ke server otentikasi.');
    } finally {
      setLoading(false);
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
              SMPN 2 Ciamis · Masuk dengan NIS Siswa atau ID Guru
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
              <span>Siswa (NIS)</span>
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
                  Nomor Induk Siswa (NIS)
                </label>
                <input
                  id="student-nis"
                  type="text"
                  required
                  autoFocus
                  value={nis}
                  onChange={(e) => setNis(e.target.value)}
                  placeholder="Masukkan NIS Anda (contoh: 242507001)"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
              >
                {loading ? 'Memeriksa NIS...' : 'Masuk ke Rapor & Kartu Atlet'}
              </button>
            </form>
          ) : (
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
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
              >
                <KeyRound className="h-4 w-4" />
                <span>{loading ? 'Memverifikasi ID...' : 'Masuk Dashboard Guru PJOK'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
