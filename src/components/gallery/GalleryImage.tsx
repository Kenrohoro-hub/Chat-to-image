import { useEffect, useState } from 'react'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../../lib/imageCache'

export default function GalleryImage({ id, alt }: { id: string; alt: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let cancelled = false
    setSrc('')
    const unsubscribe = subscribeImageThumbnail(id, (thumbnail) => {
      if (!cancelled) setSrc(thumbnail.dataUrl)
    })
    void ensureImageThumbnailCached(id).then((thumbnail) => {
      if (!cancelled && thumbnail) setSrc(thumbnail.dataUrl)
    }).catch(() => { if (!cancelled) setSrc('') })
    return () => { cancelled = true; unsubscribe() }
  }, [id])
  return src ? <img src={src} alt={alt} loading="lazy" /> : <span className="gallery-image-placeholder">正在读取图片…</span>
}
