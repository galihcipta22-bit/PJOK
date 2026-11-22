import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { db } from '../lib/firebase.ts';

const mediaCache = new Map<string, string>();

export function isCloudMediaRef(src?: string): boolean {
  return Boolean(src && src.startsWith('firestore-media://'));
}

export function cacheResolvedMedia(mediaRef: string, dataUrl: string): void {
  mediaCache.set(mediaRef, dataUrl);
}

export async function resolveCloudMediaUrl(src?: string): Promise<string> {
  if (!src) return '';
  if (!src.startsWith('firestore-media://')) return src;
  const cached = mediaCache.get(src);
  if (cached) return cached;

  const assetId = src.replace('firestore-media://', '').trim();
  if (!assetId) return '';

  try {
    const snap = await getDoc(doc(db, 'media_assets', assetId));
    if (snap.exists()) {
      const dataUrl = String(snap.data().dataUrl ?? '');
      if (dataUrl) {
        mediaCache.set(src, dataUrl);
        return dataUrl;
      }
    }
  } catch (err) {
    console.warn('Gagal memuat media cloud:', assetId, err);
  }
  return '';
}

export function useResolvedMediaUrl(src?: string): string {
  const [resolved, setResolved] = useState<string>(() => {
    if (!src) return '';
    if (!src.startsWith('firestore-media://')) return src;
    return mediaCache.get(src) || '';
  });

  useEffect(() => {
    let active = true;
    if (!src) {
      setResolved('');
      return () => {
        active = false;
      };
    }
    if (!src.startsWith('firestore-media://')) {
      setResolved(src);
      return () => {
        active = false;
      };
    }
    const cached = mediaCache.get(src);
    if (cached) {
      setResolved(cached);
      return () => {
        active = false;
      };
    }
    resolveCloudMediaUrl(src).then((url) => {
      if (active) setResolved(url);
    });
    return () => {
      active = false;
    };
  }, [src]);

  return resolved;
}

export function CloudImage({
  src,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement>) {
  const resolved = useResolvedMediaUrl(src);
  if (!resolved) return null;
  return <img src={resolved} {...rest} />;
}
