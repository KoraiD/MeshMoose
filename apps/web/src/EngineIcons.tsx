/** Compact stroke icons for Live Engine (currentColor → theme accent/ink). */

import type { ReactNode } from 'react'

type IconProps = { className?: string; title?: string }

function Svg({
  children,
  className,
  title,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export function IconPlay(p: IconProps) {
  return (
    <Svg {...p}>
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
    </Svg>
  )
}
export function IconStop(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}
export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-2.6-6.2" />
      <polyline points="21 3 21 9 15 9" />
    </Svg>
  )
}
export function IconExpand(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </Svg>
  )
}
export function IconFit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 9V5h4" />
      <path d="M20 9V5h-4" />
      <path d="M4 15v4h4" />
      <path d="M20 15v4h-4" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </Svg>
  )
}
export function IconZoomIn(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
    </Svg>
  )
}
export function IconZoomOut(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
    </Svg>
  )
}
export function IconPan(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="12 3 15 6 9 6 12 3" />
      <polyline points="12 21 15 18 9 18 12 21" />
      <polyline points="3 12 6 9 6 15 3 12" />
      <polyline points="21 12 18 9 18 15 21 12" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  )
}
export function IconRotate(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
      <polyline points="21 3 21 9 15 9" />
    </Svg>
  )
}
export function IconScaleUp(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="8 3 3 3 3 8" />
      <polyline points="16 21 21 21 21 16" />
      <line x1="3" y1="3" x2="10" y2="10" />
      <line x1="21" y1="21" x2="14" y2="14" />
      <rect x="9" y="9" width="6" height="6" rx="0.5" />
    </Svg>
  )
}
export function IconScaleDown(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="3 8 3 3 8 3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="3" y1="3" x2="9" y2="9" />
      <line x1="21" y1="21" x2="15" y2="15" />
      <rect x="9" y="9" width="6" height="6" rx="0.5" />
    </Svg>
  )
}
export function IconEdges(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 18 L12 4 L20 18 Z" />
      <path d="M7.5 14h9" />
    </Svg>
  )
}
export function IconXray(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8" opacity="0.35" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Svg>
  )
}
export function IconExport(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3v12" />
      <polyline points="7 10 12 15 17 10" />
      <path d="M5 19h14" />
    </Svg>
  )
}
export function IconCamera(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  )
}
export function IconCopy(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15V5h10" />
    </Svg>
  )
}
export function IconCode(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="8 7 3 12 8 17" />
      <polyline points="16 7 21 12 16 17" />
    </Svg>
  )
}
export function IconValues(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 5h14" />
      <path d="M5 12h10" />
      <path d="M5 19h7" />
      <circle cx="18" cy="19" r="2" />
    </Svg>
  )
}
export function IconErrors(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 L22 20 H2 Z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
    </Svg>
  )
}
export function IconExplode(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Svg>
  )
}
