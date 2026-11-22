import { MapPin, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SchoolSettings } from '../types.ts';
import { useResolvedMediaUrl } from './CloudImage.tsx';

interface FooterProps {
  settings: SchoolSettings;
}

export function Footer({ settings }: FooterProps) {
  const resolvedLogoUrl = useResolvedMediaUrl(settings.logoUrl);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [resolvedLogoUrl]);

  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-950 text-slate-300">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:items-start">
          {/* School Identity & Address */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
                {!imgError && resolvedLogoUrl ? (
                  <img
                    src={resolvedLogoUrl}
                    alt={`Logo ${settings.schoolName}`}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Shield className="h-5 w-5 text-emerald-400" />
                )}
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-white">
                  {settings.schoolName}
                </h2>
                <p className="text-xs text-slate-400">
                  Portal Informasi Akademik & Evaluasi PJOK · Guru Pengajar: {settings.teacherName}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 text-sm text-slate-300">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <p className="max-w-xl leading-relaxed">{settings.schoolAddress}</p>
            </div>
          </div>

          {/* Monochrome Silhouette Social Media Links */}
          <div className="space-y-3 md:text-right">
            <h3 className="text-sm font-semibold text-white">
              Kanal Resmi & Media Sosial
            </h3>
            <p className="text-xs text-slate-400">
              Ikuti dokumentasi kegiatan olahraga dan prestasi siswa {settings.schoolName}.
            </p>
            <div className="flex items-center gap-3 pt-1 md:justify-end">
              {/* Instagram Silhouette */}
              <a
                href={settings.socialLinks.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram SMPN 2 Ciamis"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                  <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2zm0 2A3.75 3.75 0 0 0 4 7.75v8.5A3.75 3.75 0 0 0 7.75 20h8.5A3.75 3.75 0 0 0 20 16.25v-8.5A3.75 3.75 0 0 0 16.25 4h-8.5zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.25-3.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z" />
                </svg>
              </a>

              {/* YouTube Silhouette */}
              <a
                href={settings.socialLinks.youtube}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="YouTube SMPN 2 Ciamis"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                  <path d="M23.498 6.186a2.996 2.996 0 0 0-2.108-2.12C19.527 3.56 12 3.56 12 3.56s-7.527 0-9.39.506A2.996 2.996 0 0 0 .502 6.186C0 8.06 0 12 0 12s0 3.94.502 5.814a2.996 2.996 0 0 0 2.108 2.12c1.863.506 9.39.506 9.39.506s7.527 0 9.39-.506a2.996 2.996 0 0 0 2.108-2.12C24 15.94 24 12 24 12s0-3.94-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </a>

              {/* Facebook Silhouette */}
              <a
                href={settings.socialLinks.facebook}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook SMPN 2 Ciamis"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                  <path d="M13.5 22v-8.2h2.75l.41-3.2H13.5V8.56c0-.93.26-1.56 1.59-1.56h1.7V4.14c-.3-.04-1.31-.13-2.49-.13-2.46 0-4.15 1.5-4.15 4.26v2.33H7.37v3.2h2.78V22h3.35z" />
                </svg>
              </a>

              {/* TikTok Silhouette */}
              <a
                href={settings.socialLinks.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TikTok SMPN 2 Ciamis"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.87a8.16 8.16 0 0 0 4.76 1.52v-3.4a4.85 4.85 0 0 1-1-.3z" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-slate-800 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {settings.schoolName}. Sistem Informasi Akademik PJOK.</p>
          <p>Semester Aktif: {settings.activeSemester}</p>
        </div>
      </div>
    </footer>
  );
}
