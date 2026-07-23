/** Authenticated Zoo agent snapshot with lightbox + download. */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MouseEvent } from 'react'
import { getApiToken, jobFileUrl } from './api'

type Props = {
  jobId: string
  path: string
  name: string
  alt: string
}

export function AuthImage({ jobId, path, name, alt }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void fetch(jobFileUrl(jobId, path), {
      headers: { Authorization: `Bearer ${getApiToken()}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.blob()
      })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [jobId, path])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function download(e?: MouseEvent) {
    e?.preventDefault()
    e?.stopPropagation()
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = name
    a.click()
  }

  if (!src) {
    return <div className="snap-placeholder">Loading…</div>
  }

  const lightbox =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="snap-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false)
            }}
          >
            <div className="snap-lightbox-inner">
              <div className="snap-lightbox-actions">
                <button type="button" onClick={download}>
                  Download
                </button>
                <button type="button" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
              <img src={src} alt={alt} />
              <p className="muted">{name}</p>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        type="button"
        className="snap-thumb"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge ${alt}`}
      >
        <img className="snap" src={src} alt={alt} />
      </button>
      {lightbox}
    </>
  )
}
