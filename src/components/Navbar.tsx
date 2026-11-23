import { LogIn, LogOut, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useResolvedMediaUrl } from './CloudImage.tsx';

interface NavbarProps {
  logoUrl: string;
  schoolName: string;
  role: 'public' | 'student' | 'admin';
  userName?: string;
  onOpenLogin: () => void;
  onLogout: () => void;
  onNavigateSection: (sectionId: string) => void;
}

export function Navbar({
  logoUrl,
  schoolName,
  role,
  userName,
  onOpenLogin,
  onLogout,
  onNavigateSection,
}: NavbarProps) {
  const resolvedLogoUrl = useResolvedMediaUrl(logoUrl);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [resolvedLogoUrl]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3 sm:px-6 lg:px-8">
        {/* Zone 1: Brand mark */}
        <button
          type="button"
          onClick={() => onNavigateSection('top')}
          className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded-lg"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
            {!imgError && resolvedLogoUrl ? (
              <img
                src={resolvedLogoUrl}
                alt={`Logo ${schoolName}`}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <Shield className="h-5 w-5 text-emerald-400" />
            )}
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 sm:text-lg">
            PJOK · {schoolName}
          </span>
        </button>

        {/* Zone 2: Concise single-line nav links */}
        {role === 'public' ? (
          <nav
            aria-label="Navigasi Utama"
            className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex"
          >
            <button
              type="button"
              onClick={() => onNavigateSection('ringkasan')}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 hover:underline underline-offset-4"
            >
              Ringkasan
            </button>
            <button
              type="button"
              onClick={() => onNavigateSection('grafik-semester')}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 hover:underline underline-offset-4"
            >
              Grafik Semester
            </button>
            <button
              type="button"
              onClick={() => onNavigateSection('evaluasi-kelas')}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 hover:underline underline-offset-4"
            >
              Evaluasi Kelas
            </button>
            <button
              type="button"
              onClick={() => onNavigateSection('akses-nisn')}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 hover:underline underline-offset-4"
            >
              Portal NISN
            </button>
          </nav>
        ) : (
          <div className="hidden items-center gap-2 text-sm text-slate-600 md:flex">
            <span className="font-medium text-slate-900 truncate max-w-[220px]">
              {userName}
            </span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span className="whitespace-nowrap shrink-0">
              {role === 'admin' ? 'Guru Mapel PJOK' : 'Akun Siswa'}
            </span>
          </div>
        )}

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          {role === 'public' ? (
            <button
              type="button"
              onClick={onOpenLogin}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 whitespace-nowrap shrink-0 sm:text-sm"
            >
              <LogIn className="h-4 w-4" />
              <span>Masuk NISN / Guru</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 whitespace-nowrap shrink-0 sm:text-sm"
            >
              <LogOut className="h-4 w-4" />
              <span>Keluar</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
