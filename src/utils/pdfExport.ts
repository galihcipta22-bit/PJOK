import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  AdminStudentSummary,
  AttendanceRecord,
  GradeRecord,
  SchoolSettings,
} from '../types.ts';
import {
  formatKkmSummaryLabel,
  resolveEffectiveKkm,
} from './athleteAnalytics.ts';
import {
  getPengetahuanDescription,
  getPraktikDescription,
  resolveUnifiedPengetahuanScore,
} from './gradeDescription.ts';

export function generateMonthlyPdfReport(params: {
  settings: SchoolSettings;
  students: AdminStudentSummary[];
  grades: GradeRecord[];
  attendance: AttendanceRecord[];
  monthLabel: string; // e.g., "2026-11"
  classFilter: string;
  semesterFilter: string;
  kkm?: number;
  semesterKkm?: Record<string, number>;
  classKkm?: Record<string, number>;
}) {
  const {
    settings,
    students,
    grades,
    attendance,
    monthLabel,
    classFilter,
    semesterFilter,
    kkm,
    semesterKkm,
    classKkm,
  } = params;

  const kkmLabel =
    classKkm || semesterKkm
      ? formatKkmSummaryLabel({
          classFilter,
          semester: semesterFilter,
          semesterKkm,
          classKkm,
        })
      : `KKM ${kkm ?? resolveEffectiveKkm({ className: classFilter, semester: semesterFilter })}`;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const scopedStudents =
    classFilter === 'Semua Kelas'
      ? students
      : students.filter((s) => s.className === classFilter);

  // Header Kop Sekolah
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 297, 34, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('PEMERINTAH KABUPATEN CIAMIS - DINAS PENDIDIKAN', 14, 12);
  doc.setFontSize(16);
  doc.text(settings.schoolName.toUpperCase(), 14, 19);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(settings.schoolAddress, 14, 25);
  doc.text(
    `Laporan Bulanan Administrasi Mata Pelajaran PJOK · Periode: ${monthLabel}`,
    14,
    30
  );

  // Metadata Box
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('REKAPITULASI CAPAIAN NILAI, DESKRIPSI OTOMATIS & KEHADIRAN SISWA', 14, 44);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Guru Pengajar : ${settings.teacherName}`, 14, 51);
  doc.text(`NIP           : ${settings.teacherNip}`, 14, 56);
  doc.text(`Kelas         : ${classFilter}`, 160, 51);
  doc.text(`Semester      : ${semesterFilter} (${kkmLabel})`, 160, 56);

  // Aggregate summary
  const scores = scopedStudents.map((s) => s.futStats.avgTotal);
  const highest = scores.length ? Math.max(...scores) : 0;
  const lowest = scores.length ? Math.min(...scores) : 0;
  const avgAll = scores.length
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
    : '0';

  doc.setFillColor(241, 245, 249);
  doc.rect(14, 61, 269, 14, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`Total Siswa: ${scopedStudents.length}`, 18, 69);
  doc.text(`Nilai Tertinggi: ${highest}`, 82, 69);
  doc.text(`Nilai Terendah: ${lowest}`, 152, 69);
  doc.text(`Rata-rata Kelas: ${avgAll}`, 222, 69);

  // Student table
  const tableBody = scopedStudents.map((stu, idx) => {
    const semGrades = grades.filter(
      (g) => g.studentId === stu.id && g.semester === semesterFilter
    );
    const pVals = semGrades
      .map((g) => g.praktikScore)
      .filter((v): v is number => typeof v === 'number');
    const kVals = semGrades
      .map((g) => g.pengetahuanScore)
      .filter((v): v is number => typeof v === 'number');
    const avgP = pVals.length
      ? Math.round(pVals.reduce((a, b) => a + b, 0) / pVals.length)
      : stu.futStats.avgPraktik;
    const avgK =
      resolveUnifiedPengetahuanScore(semGrades) ??
      (kVals.length
        ? Math.round(kVals.reduce((a, b) => a + b, 0) / kVals.length)
        : stu.futStats.avgPengetahuan);
    const avgTot = Math.round((avgP + avgK) / 2);

    const bestPraktikGrade = [...semGrades]
      .filter((g) => typeof g.praktikScore === 'number')
      .sort((a, b) => (b.praktikScore ?? 0) - (a.praktikScore ?? 0))[0];
    const praktikMatLabel = bestPraktikGrade?.materialName || 'materi inti PJOK';
    const praktikDesc = getPraktikDescription(avgP, praktikMatLabel);
    const pengetahuanDesc = getPengetahuanDescription(avgK);
    const autoDesc = `Praktik: ${praktikDesc}\nPengetahuan: ${pengetahuanDesc}`;

    const monthAtt = attendance.filter(
      (a) => a.studentId === stu.id && a.date.startsWith(monthLabel)
    );
    const hadir = monthAtt.filter(
      (a) => a.status === 'Hadir' || a.status === 'Terlambat'
    ).length;
    const izinSakit = monthAtt.filter(
      (a) => a.status === 'Izin' || a.status === 'Sakit'
    ).length;
    const alpa = monthAtt.filter((a) => a.status === 'Alpa').length;

    return [
      String(idx + 1),
      stu.nis,
      stu.name,
      stu.className,
      String(avgP),
      String(avgK),
      String(avgTot),
      `${hadir}H / ${izinSakit}I / ${alpa}A`,
      autoDesc,
    ];
  });

  autoTable(doc, {
    startY: 80,
    head: [
      [
        'No',
        'NISN',
        'Nama Siswa',
        'Kelas',
        'Praktik',
        'Pengetahuan',
        'Rata2',
        'Kehadiran',
        'Deskripsi Otomatis (Praktik & Pengetahuan)',
      ],
    ],
    body: tableBody,
    styles: {
      fontSize: 7.5,
      cellPadding: 2.2,
      textColor: [15, 23, 42],
      valign: 'middle',
    },
    headStyles: {
      fillColor: [5, 150, 105],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 9 },
      1: { cellWidth: 22 },
      2: { cellWidth: 42 },
      3: { halign: 'center', cellWidth: 14 },
      4: { halign: 'center', cellWidth: 15 },
      5: { halign: 'center', cellWidth: 21 },
      6: { halign: 'center', cellWidth: 14 },
      7: { halign: 'center', cellWidth: 24 },
      8: { cellWidth: 'auto' },
    },
  });

  // Signature block
  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY ?? 150;
  let drawSigY = finalY + 12;
  if (drawSigY > 170) {
    doc.addPage();
    drawSigY = 24;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Ciamis, ${new Date().toLocaleDateString('id-ID', { dateStyle: 'long' })}`, 205, drawSigY);
  doc.text('Guru Mata Pelajaran PJOK,', 205, drawSigY + 5);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.teacherName, 205, drawSigY + 23);
  doc.setFont('helvetica', 'normal');
  doc.text(`NIP. ${settings.teacherNip}`, 205, drawSigY + 28);

  const safeClass = classFilter.replace(/\s+/g, '_');
  doc.save(`Laporan_Bulanan_PJOK_SMPN2Ciamis_${monthLabel}_${safeClass}.pdf`);
}
