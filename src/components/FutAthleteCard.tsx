import { Shield, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import type { FutCardStats, StudentRecord } from '../types.ts';
import {
  getPraktikDescription,
  getScorePredicateInfo,
} from '../utils/gradeDescription.ts';
import { useResolvedMediaUrl } from './CloudImage.tsx';

interface FutAthleteCardProps {
  student: StudentRecord;
  futStats: FutCardStats;
  logoUrl: string;
}

export function FutAthleteCard({
  student,
  futStats,
  logoUrl,
}: FutAthleteCardProps) {
  const resolvedPhotoUrl = useResolvedMediaUrl(student.photoUrl);
  const resolvedLogoUrl = useResolvedMediaUrl(logoUrl);
  const [photoErr, setPhotoErr] = useState(false);
  const [logoErr, setLogoErr] = useState(false);
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null
  );

  useEffect(() => {
    setPhotoErr(false);
  }, [resolvedPhotoUrl]);

  useEffect(() => {
    setLogoErr(false);
  }, [resolvedLogoUrl]);

  const tierTheme =
    futStats.tier === 'GOLD'
      ? {
          shell:
            'from-amber-200 via-yellow-400 to-amber-600 text-slate-950 border-amber-300',
          inner: 'bg-slate-950/10 border-amber-950/20',
          divider: 'bg-amber-950/25',
          subtext: 'text-amber-950/80',
        }
      : futStats.tier === 'SILVER'
        ? {
            shell:
              'from-slate-100 via-slate-300 to-slate-500 text-slate-950 border-slate-200',
            inner: 'bg-slate-950/10 border-slate-900/20',
            divider: 'bg-slate-900/20',
            subtext: 'text-slate-800',
          }
        : {
            shell:
              'from-orange-200 via-amber-700 to-stone-800 text-white border-orange-300/60',
            inner: 'bg-black/20 border-white/15',
            divider: 'bg-white/25',
            subtext: 'text-orange-100',
          };

  const initials = student.name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  const materialScoresList =
    futStats.materialScores && futStats.materialScores.length > 0
      ? futStats.materialScores
      : [
          { code: 'ATLETIK', abbr: 'ATL', name: 'Atletik & Lari Sprint', score: null },
          { code: 'BOLA_BASKET', abbr: 'PBB', name: 'Permainan Bola Basket', score: null },
          { code: 'BOLA_VOLI', abbr: 'PBV', name: 'Permainan Bola Voli', score: null },
          { code: 'SEPAK_BOLA_FUTSAL', abbr: 'PBS', name: 'Permainan Bola Sepak', score: null },
          { code: 'KEBUGARAN_TKJ', abbr: 'TKJ', name: 'Kebugaran Jasmani', score: null },
          { code: 'SENAM_IRAMA', abbr: 'SNI', name: 'Senam Irama', score: null },
          { code: 'BULU_TANGKIS', abbr: 'BLT', name: 'Bulu Tangkis', score: null },
          { code: 'AKTIFITAS_AKUATIK', abbr: 'RNG', name: 'Aktifitas Aquatik', score: null },
        ];

  const avrgPredicate = getScorePredicateInfo(futStats.avgTotal);
  const hoveredMaterial = materialScoresList.find(
    (m) => m.abbr === hoveredTarget
  );

  function handlePointerMove(e: MouseEvent<HTMLDivElement>) {
    setCursorPos({ x: e.clientX, y: e.clientY });
  }

  function handleTargetTap(
    target: string,
    e: MouseEvent<HTMLElement>
  ) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setCursorPos({
      x: rect.left + rect.width / 2,
      y: rect.bottom,
    });
    setHoveredTarget((prev) => (prev === target ? null : target));
  }

  const tooltipLeft =
    cursorPos && typeof window !== 'undefined'
      ? Math.max(140, Math.min(cursorPos.x, window.innerWidth - 140))
      : cursorPos?.x ?? 0;
  const tooltipTop =
    cursorPos && typeof window !== 'undefined'
      ? Math.min(cursorPos.y + 14, window.innerHeight - 110)
      : (cursorPos?.y ?? 0) + 14;

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseMove={handlePointerMove}
      onMouseLeave={() => {
        setHoveredTarget(null);
        setCursorPos(null);
      }}
    >
      <div
        className={`relative w-full max-w-[300px] overflow-hidden rounded-[24px] border-2 bg-gradient-to-br p-5 shadow-xl ${tierTheme.shell}`}
      >
        {/* Top Row: AVRG + Crest + Photo */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col items-center pt-1">
            <div
              onMouseEnter={() => setHoveredTarget('AVRG')}
              onMouseLeave={() => setHoveredTarget(null)}
              onClick={(e) => handleTargetTap('AVRG', e)}
              className="flex cursor-pointer flex-col items-center rounded-lg px-1.5 py-0.5 transition-colors hover:bg-black/10"
            >
              <span className="font-display text-5xl font-extrabold leading-none tracking-tight tabular-nums">
                {futStats.avgTotal}
              </span>
              <span className="mt-1 font-mono text-xs font-bold tracking-wider">
                AVRG
              </span>
            </div>
            <div className={`my-2 h-px w-8 ${tierTheme.divider}`} />
            <div
              onMouseEnter={() => setHoveredTarget('LOGO')}
              onMouseLeave={() => setHoveredTarget(null)}
              onClick={(e) => handleTargetTap('LOGO', e)}
              className="flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-black/15 bg-slate-900"
            >
              {!logoErr && resolvedLogoUrl ? (
                <img
                  src={resolvedLogoUrl}
                  alt="Logo SMPN 2 Ciamis"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoErr(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Shield className="h-4 w-4 text-emerald-400" />
              )}
            </div>
          </div>

          <div
            onMouseEnter={() => setHoveredTarget('PROFILE')}
            onMouseLeave={() => setHoveredTarget(null)}
            onClick={(e) => handleTargetTap('PROFILE', e)}
            className={`relative h-40 w-40 shrink-0 cursor-pointer overflow-hidden rounded-2xl border ${tierTheme.inner}`}
          >
            {!photoErr && resolvedPhotoUrl ? (
              <img
                src={resolvedPhotoUrl}
                alt={`Foto ${student.name}`}
                referrerPolicy="no-referrer"
                onError={() => setPhotoErr(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 text-slate-200">
                <User className="h-10 w-10 text-emerald-400" />
                <span className="mt-1 font-display text-xl font-bold">
                  {initials}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Name & Class */}
        <div
          onMouseEnter={() => setHoveredTarget('PROFILE')}
          onMouseLeave={() => setHoveredTarget(null)}
          onClick={(e) => handleTargetTap('PROFILE', e)}
          className="mt-4 cursor-pointer text-center"
        >
          <h3 className="truncate font-display text-xl font-extrabold tracking-tight">
            {student.name}
          </h3>
          <p className={`mt-0.5 text-xs font-medium ${tierTheme.subtext}`}>
            Kelas {student.className} · NIS {student.nis}
          </p>
          <div className={`mx-auto mt-3 h-px w-full ${tierTheme.divider}`} />
        </div>

        {/* Core Material Scores Grid */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 px-2">
          {materialScoresList.map((stat) => {
            const pVal =
              typeof stat.praktikScore === 'number'
                ? stat.praktikScore
                : stat.score;
            const kVal =
              typeof stat.pengetahuanScore === 'number'
                ? stat.pengetahuanScore
                : null;
            const displayVal = pVal !== null ? pVal : kVal;
            const isKnowledgeOnly = pVal === null && kVal !== null;
            return (
              <div
                key={stat.code || stat.abbr}
                onMouseEnter={() => setHoveredTarget(stat.abbr)}
                onMouseLeave={() => setHoveredTarget(null)}
                onClick={(e) => handleTargetTap(stat.abbr, e)}
                className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-bold transition-colors hover:bg-black/10"
              >
                <span className="font-mono text-base tabular-nums">
                  {displayVal !== null ? displayVal : '--'}
                </span>
                <span className={`font-mono text-xs ${tierTheme.subtext}`}>-</span>
                <span className={`font-display text-xs tracking-wider ${tierTheme.subtext}`}>
                  {stat.abbr}
                  {isKnowledgeOnly ? '*' : ''}
                </span>
              </div>
            );
          })}
        </div>

        {/* Direct Praktik, Pengetahuan & Kehadiran Strip */}
        <div
          className={`mt-3 grid grid-cols-3 gap-1.5 rounded-xl border px-2 py-2 text-center ${tierTheme.inner}`}
        >
          <div>
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${tierTheme.subtext}`}>
              Praktik
            </p>
            <p className="font-mono text-sm font-extrabold tabular-nums">
              {futStats.avgPraktik}
            </p>
          </div>
          <div className="border-x border-current/15 px-1">
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${tierTheme.subtext}`}>
              Pengetahuan
            </p>
            <p className="font-mono text-sm font-extrabold tabular-nums">
              {futStats.avgPengetahuan}
            </p>
          </div>
          <div>
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${tierTheme.subtext}`}>
              Hadir
            </p>
            <p className="font-mono text-sm font-extrabold tabular-nums">
              {futStats.attendanceRate}%
            </p>
          </div>
        </div>

        {/* Footer Identifier */}
        <div
          onMouseEnter={() => setHoveredTarget('BEST')}
          onMouseLeave={() => setHoveredTarget(null)}
          onClick={(e) => handleTargetTap('BEST', e)}
          className={`mt-3 cursor-pointer border-t pt-2.5 text-center font-mono text-[11px] font-semibold leading-snug tabular-nums ${tierTheme.subtext} border-current/15`}
        >
          {futStats.bestMaterialName
            ? `Materi Terbaik: ${futStats.bestMaterialName}${
                typeof futStats.bestMaterialScore === 'number'
                  ? ` (${futStats.bestMaterialScore})`
                  : ''
              }`
            : 'Materi Terbaik: Belum ada nilai'}
        </div>
      </div>

      {/* Contextual Tooltip Directly Under Cursor */}
      {hoveredTarget && cursorPos && (
        <div
          role="tooltip"
          style={{ left: `${tooltipLeft}px`, top: `${tooltipTop}px` }}
          className="pointer-events-none fixed z-50 w-64 -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2.5 text-left text-xs text-slate-100 shadow-2xl backdrop-blur-md"
        >
          {hoveredTarget === 'AVRG' && (
            <>
              <p className="font-semibold text-emerald-400">
                AVRG ({futStats.avgTotal}) — Rata-Rata Nilai PJOK
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-200">
                Rata-rata Praktik ({futStats.avgPraktik}) &amp; Pengetahuan ({futStats.avgPengetahuan}) · Predikat {avrgPredicate.label}.
              </p>
            </>
          )}

          {hoveredTarget === 'LOGO' && (
            <>
              <p className="font-semibold text-emerald-400">
                SMPN 2 Ciamis
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-200">
                Kartu Profil Siswa (FUT) resmi mata pelajaran PJOK.
              </p>
            </>
          )}

          {hoveredTarget === 'PROFILE' && (
            <>
              <p className="font-semibold text-emerald-400 truncate">
                {student.name}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-200">
                Kelas {student.className} · NIS {student.nis} · Kehadiran {futStats.attendanceRate}%.
              </p>
            </>
          )}

          {hoveredMaterial && (() => {
            const pVal =
              typeof hoveredMaterial.praktikScore === 'number'
                ? hoveredMaterial.praktikScore
                : hoveredMaterial.score;
            const kVal =
              typeof hoveredMaterial.pengetahuanScore === 'number'
                ? hoveredMaterial.pengetahuanScore
                : null;
            return (
              <>
                <p className="font-semibold text-emerald-400">
                  {hoveredMaterial.abbr} — {hoveredMaterial.name}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-200">
                  {pVal !== null || kVal !== null ? (
                    <>
                      Praktik:{' '}
                      <strong className="font-mono text-white">
                        {pVal !== null ? pVal : 'Kosong'}
                      </strong>{' '}
                      · Pengetahuan:{' '}
                      <strong className="font-mono text-white">
                        {kVal !== null ? kVal : 'Kosong'}
                      </strong>
                      {pVal !== null && (
                        <>
                          {' '}
                          · {getScorePredicateInfo(pVal).label} (
                          {getPraktikDescription(pVal, hoveredMaterial.name)}).
                        </>
                      )}
                    </>
                  ) : (
                    'Belum ada nilai yang diinput untuk materi inti ini.'
                  )}
                </p>
              </>
            );
          })()}

          {hoveredTarget === 'BEST' && (
            <>
              <p className="font-semibold text-amber-400">
                Materi Terbaik
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-200">
                {futStats.bestMaterialName
                  ? `${futStats.bestMaterialName} dengan nilai tertinggi (${futStats.bestMaterialScore ?? '-'}).`
                  : 'Belum ada nilai materi inti pada semester ini.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
