import { motion, AnimatePresence } from 'motion/react';
import { Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useResolvedMediaUrl } from './CloudImage.tsx';

interface WelcomeSplashProps {
  logoUrl: string;
  schoolName: string;
  teacherName: string;
  onComplete: () => void;
  visible: boolean;
}

export function WelcomeSplash({
  logoUrl,
  schoolName,
  teacherName,
  onComplete,
  visible,
}: WelcomeSplashProps) {
  const resolvedLogoUrl = useResolvedMediaUrl(logoUrl);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [resolvedLogoUrl]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      onComplete();
    }, 1700);
    return () => window.clearTimeout(timer);
  }, [visible, onComplete]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 px-6 text-white"
          role="dialog"
          aria-label="Layar selamat datang Portal PJOK"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="flex max-w-md flex-col items-center text-center"
          >
            <div className="mb-6 flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
              {!imgError && resolvedLogoUrl ? (
                <img
                  src={resolvedLogoUrl}
                  alt={`Logo ${schoolName}`}
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Shield className="h-10 w-10 text-emerald-400" />
              )}
            </div>

            <p className="text-xs font-medium tracking-wide text-emerald-400">
              Pendidikan Jasmani, Olahraga, dan Kesehatan
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {schoolName}
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Guru Pengajar: <span className="font-semibold text-white">{teacherName}</span>
            </p>

            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
              className="mt-7 h-0.5 w-48 origin-left rounded-full bg-emerald-500"
            />

            <button
              type="button"
              onClick={onComplete}
              className="mt-6 rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              Masuk ke Portal
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
