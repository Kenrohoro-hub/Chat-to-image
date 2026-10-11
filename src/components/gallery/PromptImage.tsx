import { useEffect, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { getCachedPromptImage, getPromptImageRevision, subscribePromptImages } from '../../lib/promptLibrary'

export default function PromptImage({ src, ...props }: ComponentProps<'img'> & { src: string }) {
  const revision = useSyncExternalStore(subscribePromptImages, getPromptImageRevision)
  const [resolved, setResolved] = useState<{ original: string; url: string }>()
  useEffect(() => {
    let active = true
    let objectUrl: string | undefined
    getCachedPromptImage(src).then((blob) => {
      if (!active) return
      objectUrl = blob ? URL.createObjectURL(blob) : undefined
      setResolved({ original: src, url: objectUrl || src })
    }).catch((err) => { console.warn('Prompt image cache read failed', err); if (active) setResolved({ original: src, url: src }) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src, revision])
  return <img {...props} src={resolved?.original === src ? resolved.url : undefined} />
}
