import {
  ArrowUpRight,
  Award,
  BarChart3,
  Lock,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PublicOverviewResponse } from '../types.ts';
import {
  formatKkmSummaryLabel,
  resolveEffectiveKkm,
} from '../utils/athleteAnalytics.ts';
import { useResolvedMediaUrl } from './CloudImage.tsx';

const DEFAULT_HERO_IMAGE_URL =
  '/src/assets/images/hero_sports_arena_1794923888842.jpg';

interface PublicDashboardProps {
  data: PublicOverviewResponse | null;
  loading: boolean;
  selectedClass: string;
  selectedSemester: string;
  onChangeClass: (cls: string) => void;
  onChangeSemester: (sem: string) => void;
  onOpenLogin: (initialTab?: 'student' | 'admin') => void;
}

export function PublicDashboard({
  data,
  loading,
  selectedClass,
  selectedSemester,
  onChangeClass,
  onChangeSemester,
  onOpenLogin,
}: PublicDashboardProps) {
  const [heroImgError, setHeroImgError] = useState(false);
  const [topMaterialFilter, setTopMaterialFilter] = useState<string>('ALL');
  const rawHeroImageUrl =
    data?.settings.heroImageUrl?.trim() || DEFAULT_HERO_IMAGE_URL;
  const resolvedHeroImageUrl = useResolvedMediaUrl(rawHeroImageUrl);

  useEffect(() => {
    setHeroImgError(false);
  }, [resolvedHeroImageUrl]);

  if (loading && !data) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white"
            />
          ))}
        </div>
        <div className="mt-8 h-80 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </main>
    );
  }

  if (!data) return null;

  const {
    settings,
    availableClasses,
    availableSemesters,
    summary,
    semesterHistory,
    classComparison,
    materialBreakdown,
    top5ByMaterial,
  } = data;

  const activeClassComparison = classComparison.filter(
    (c) => c.studentCount > 0
  );
  const activeClasses =
    classComparison.length > 0
      ? activeClassComparison.map((c) => c.className)
      : availableClasses;

  const kkmSummaryLabel = formatKkmSummaryLabel({
    classFilter: selectedClass,
    semester: selectedSemester,
    semesterKkm: data.semesterKkm,
    classKkm: data.classKkm,
  });
  const effectiveTopMaterial =
    topMaterialFilter === 'ALL' ||
    data.availableMaterials.some((m) => m.code === topMaterialFilter)
      ? topMaterialFilter
      : 'ALL';
  const top5List = top5ByMaterial?.[effectiveTopMaterial] ?? [];
  const top5ChartData = top5List.map((item) => ({
    ...item,
    Praktik: item.avgPraktik ?? 0,
    Pengetahuan: item.avgPengetahuan ?? 0,
  }));

  return (
    <main id="top" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero Section: 2-Column Balanced Split */}
      <section
        id="ringkasan"
        className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch"
      >
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 lg:col-span-7">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {settings.schoolName} · Guru Pengajar: {settings.teacherName}
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl [text-wrap:balance]">
              Portal Informasi Nilai & Evaluasi Performa PJOK
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
              Pantau grafik capaian akademik, perkembangan nilai praktik dan
              pengetahuan per semester, serta evaluasi kelas secara transparan.
              Demi privasi akademik, detail nilai per siswa hanya dapat diakses
              setelah masuk menggunakan Nomor Induk Siswa Nasional (NISN).
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => onOpenLogin('student')}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 whitespace-nowrap shrink-0"
            >
              <span>Masuk dengan NISN Siswa</span>
              <ArrowUpRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onOpenLogin('admin')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 whitespace-nowrap shrink-0"
            >
              <span>Portal Guru PJOK</span>
            </button>
          </div>
        </div>

        <div className="relative min-h-[260px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 lg:col-span-5">
          {!heroImgError && resolvedHeroImageUrl ? (
            <img
              src={resolvedHeroImageUrl}
              alt="Lapangan olahraga dan lintasan lari sekolah"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgError(true)}
              className="h-full w-full object-cover lg:h-full"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-400">
              <BarChart3 className="h-12 w-12" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6 text-white">
            <p className="text-xs font-medium text-emerald-300">
              Semester Aktif · {settings.activeSemester}
            </p>
            <p className="mt-1 font-display text-lg font-semibold">
              Evaluasi Terpadu Praktik, Pengetahuan & Kedisiplinan
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Mencakup {data.availableMaterials.length} materi inti PJOK ·{' '}
              {kkmSummaryLabel}.
            </p>
          </div>
        </div>
      </section>

      {/* Filter Bar per Kelas & Semester */}
      <section className="mt-8 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Filter Evaluasi Kelas & Semester
          </h2>
          <p className="text-xs text-slate-500 tabular-nums">
            Menampilkan statistik agregat {selectedClass} · {selectedSemester} ·{' '}
            {kkmSummaryLabel} ({summary.totalStudents} siswa)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {['Semua Kelas', ...activeClasses].map((cls) => (
              <button
                key={cls}
                type="button"
                onClick={() => onChangeClass(cls)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  selectedClass === cls
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cls}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <span className="sr-only">Pilih Semester</span>
            <select
              value={selectedSemester}
              onChange={(e) => onChangeSemester(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-emerald-600 focus:outline-none"
            >
              {availableSemesters.map((sem) => (
                <option key={sem} value={sem}>
                  {sem}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* Full-Width 4-Column KPI Strip */}
      <section
        aria-label="Ringkasan Nilai Kelas"
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Nilai Tertinggi</span>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
            {summary.highestScore}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Capaian puncak gabungan ({selectedClass})
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Nilai Terendah</span>
            <TrendingDown className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
            {summary.lowestScore}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Acuan program pendampingan belajar
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Rata-Rata Nilai</span>
            <Award className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
            {summary.averageScore}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Praktik {summary.averagePraktik} · Pengetahuan {summary.averagePengetahuan}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Tingkat Kehadiran</span>
            <Users className="h-4 w-4 text-slate-700" />
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-slate-900 tabular-nums">
            {summary.attendanceRate}%
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Tercatat dari {summary.totalStudents} siswa aktif
          </p>
        </div>
      </section>

      {/* Charts Grid: Semester History & Class Performance */}
      <section
        id="grafik-semester"
        className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12"
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-6">
          <div className="mb-4">
            <h2 className="font-display text-lg font-bold text-slate-900">
              Riwayat Nilai Antar Semester
            </h2>
            <p className="text-xs text-slate-500">
              Tren perkembangan rata-rata Nilai Praktik dan Pengetahuan ({selectedClass})
            </p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={semesterHistory}
                margin={{ top: 10, right: 12, left: -16, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradPraktik" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradPengetahuan" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f172a" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#0f172a" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="semester"
                  tick={{ fontSize: 11, fill: '#475569' }}
                />
                <YAxis
                  domain={[60, 100]}
                  tick={{ fontSize: 11, fill: '#475569' }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area
                  type="monotone"
                  dataKey="avgPraktik"
                  name="Nilai Praktik"
                  stroke="#059669"
                  strokeWidth={2.5}
                  fill="url(#gradPraktik)"
                />
                <Area
                  type="monotone"
                  dataKey="avgPengetahuan"
                  name="Nilai Pengetahuan"
                  stroke="#0f172a"
                  strokeWidth={2.5}
                  fill="url(#gradPengetahuan)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div
          id="evaluasi-kelas"
          className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-6"
        >
          <div className="mb-4">
            <h2 className="font-display text-lg font-bold text-slate-900">
              Performa Akademik Per Kelas
            </h2>
            <p className="text-xs text-slate-500">
              Perbandingan rata-rata Praktik vs Pengetahuan pada {selectedSemester}
            </p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={activeClassComparison}
                margin={{ top: 10, right: 12, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="className"
                  tick={{ fontSize: 11, fill: '#475569' }}
                />
                <YAxis
                  domain={[60, 100]}
                  tick={{ fontSize: 11, fill: '#475569' }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar
                  dataKey="avgPraktik"
                  name="Rata2 Praktik"
                  fill="#059669"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="avgPengetahuan"
                  name="Rata2 Pengetahuan"
                  fill="#0f172a"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Class Summary Table & Material Breakdown */}
      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-7">
          <h2 className="font-display text-lg font-bold text-slate-900">
            Rekap Evaluasi Rentang Nilai Kelas
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Menampilkan nilai tertinggi, terendah, dan rata-rata setiap rombongan belajar ({selectedSemester}).
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Kelas</th>
                  <th className="py-2.5 px-3 text-right">Siswa</th>
                  <th className="py-2.5 px-3 text-right">Praktik</th>
                  <th className="py-2.5 px-3 text-right">Pengetahuan</th>
                  <th className="py-2.5 px-3 text-right">Tertinggi</th>
                  <th className="py-2.5 pl-3 text-right">Terendah</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeClassComparison.map((row) => (
                  <tr
                    key={row.className}
                    className={`transition-colors hover:bg-slate-50 ${
                      selectedClass === row.className ? 'bg-emerald-50/50 font-medium' : ''
                    }`}
                  >
                    <td className="py-2.5 pr-4 font-semibold text-slate-900">
                      {row.className}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                      {row.studentCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {row.avgPraktik}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                      {row.avgPengetahuan}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                      {row.highest}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-amber-700">
                      {row.lowest}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-5">
          <h2 className="font-display text-lg font-bold text-slate-900">
            Capaian Per Materi Inti PJOK
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Pemisahan kompetensi Praktik lapangan & Pengetahuan teori ({selectedClass}).
          </p>

          <div className="mt-5 space-y-4">
            {materialBreakdown.map((mat) => (
              <div key={mat.materialCode} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">
                    {mat.materialName}
                  </span>
                  <span className="font-mono text-slate-600 tabular-nums">
                    P: {mat.avgPraktik} · K: {mat.avgPengetahuan}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${mat.avgPraktik}%` }}
                    />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-800"
                      style={{ width: `${mat.avgPengetahuan}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pemetaan Rata-Rata Nilai 5 Siswa Terbaik pada Materi Inti */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <BarChart3 className="h-4 w-4" />
              <span>
                Pemetaan Rata-Rata Nilai Materi Inti · {selectedClass} ·{' '}
                {selectedSemester}
              </span>
            </div>
            <h2 className="mt-1 font-display text-lg font-bold text-slate-900">
              5 Siswa Terbaik (Pengetahuan & Praktik/Keterampilan)
            </h2>
          </div>

          <select
            value={effectiveTopMaterial}
            onChange={(e) => setTopMaterialFilter(e.target.value)}
            aria-label="Filter Materi Inti 5 Siswa Terbaik"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-emerald-600 focus:outline-none"
          >
            <option value="ALL">Semua Materi Inti</option>
            {data.availableMaterials.map((mat) => (
              <option key={mat.code} value={mat.code}>
                {mat.name}
              </option>
            ))}
          </select>
        </div>

        {top5List.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-xs text-slate-500">
            Belum ada data nilai materi inti pada filter kelas dan semester ini.
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center">
            <div className="h-60 w-full lg:col-span-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={top5ChartData}
                  margin={{ top: 10, right: 12, left: -16, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="shortName"
                    tick={{ fontSize: 11, fill: '#475569' }}
                  />
                  <YAxis
                    domain={[60, 100]}
                    tick={{ fontSize: 11, fill: '#475569' }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar
                    dataKey="Praktik"
                    name="Praktik / Keterampilan"
                    fill="#059669"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="Pengetahuan"
                    name="Pengetahuan"
                    fill="#0f172a"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto lg:col-span-6">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 font-semibold text-slate-500">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-3">Siswa</th>
                    <th className="py-2 px-2">Kelas</th>
                    <th className="py-2 px-2 text-right">Praktik</th>
                    <th className="py-2 px-2 text-right">Pengetahuan</th>
                    <th className="py-2 pl-2 text-right">Rata-Rata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {top5List.map((item, idx) => {
                    const rowKkm = resolveEffectiveKkm({
                      className: item.className,
                      semester: selectedSemester,
                      semesterKkm: data.semesterKkm,
                      classKkm: data.classKkm,
                    });
                    const pBelow =
                      item.avgPraktik !== null && item.avgPraktik < rowKkm;
                    const kBelow =
                      item.avgPengetahuan !== null &&
                      item.avgPengetahuan < rowKkm;
                    const avgBelow = item.avgCombined < rowKkm;
                    return (
                      <tr key={`${item.className}-${item.name}-${idx}`} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-2 font-mono font-bold text-slate-500 tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 pr-3 font-semibold text-slate-900">
                          {item.name}
                          <div className="text-[10px] font-normal text-slate-400 truncate max-w-[180px]">
                            {effectiveTopMaterial === 'ALL'
                              ? `Unggul: ${item.bestMaterialName}`
                              : data.availableMaterials.find(
                                  (m) => m.code === effectiveTopMaterial
                                )?.name}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-slate-700">
                          {item.className}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-mono font-semibold tabular-nums ${
                            item.avgPraktik === null
                              ? 'text-slate-400'
                              : pBelow
                                ? 'text-red-600'
                                : 'text-emerald-700'
                          }`}
                        >
                          {item.avgPraktik !== null ? item.avgPraktik : '-'}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-mono font-semibold tabular-nums ${
                            item.avgPengetahuan === null
                              ? 'text-slate-400'
                              : kBelow
                                ? 'text-red-600'
                                : 'text-slate-900'
                          }`}
                        >
                          {item.avgPengetahuan !== null
                            ? item.avgPengetahuan
                            : '-'}
                        </td>
                        <td
                          className={`py-2.5 pl-2 text-right font-mono font-bold tabular-nums ${
                            avgBelow ? 'text-red-600' : 'text-slate-900'
                          }`}
                        >
                          {item.avgCombined}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Protected Individual Student Access CTA */}
      <section
        id="akses-nisn"
        className="mt-8 flex flex-col items-start justify-between gap-6 rounded-2xl border border-slate-200 bg-slate-900 p-6 text-white sm:flex-row sm:items-center sm:p-8"
      >
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
            <Lock className="h-4 w-4" />
            <span>Akses Privasi Siswa Terlindungi NISN</span>
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
            Lihat Rapor Nilai Spesifik, Kartu Profil Siswa (FUT), & Rekomendasi Bakat
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Untuk menjaga kerahasiaan data pribadi siswa, rincian nilai materi
            praktik & pengetahuan per individu, riwayat kehadiran QR/RFID, serta
            notifikasi pembaruan nilai dari Bapak {settings.teacherName} hanya
            ditampilkan setelah login menggunakan Nomor Induk Siswa Nasional (NISN).
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenLogin('student')}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 whitespace-nowrap shrink-0"
        >
          <span>Login Siswa (NISN)</span>
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </section>
    </main>
  );
}
