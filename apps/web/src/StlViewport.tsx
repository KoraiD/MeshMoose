import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { getApiToken } from './api'
import { resolveTheme } from './theme'

type DownloadAction = {
  label: string
  onClick: () => void
  disabled?: boolean
}

type Props = {
  /** blob: URL, or /api/... path that needs Bearer auth */
  url: string | null
  label: string
  accent?: string
  downloads?: DownloadAction[]
  /** Optional ghost / overlay mesh (same scene). */
  overlayUrl?: string | null
  overlayAccent?: string
  /** Primary mesh opacity 0–1 */
  primaryOpacity?: number
  /** Overlay mesh opacity 0–1 */
  overlayOpacity?: number
  compact?: boolean
  /** 4x4 row-major transform applied to the primary mesh (ICP alignment). */
  alignTransform?: number[] | null
  /** Per-vertex deviation (mm) + indices for heatmap coloring of the primary mesh. */
  heatmap?: { vertexIndices: number[]; distances: number[] } | null
  /** Manual nudge applied to the primary mesh, on top of alignTransform. */
  nudge?: { translate: [number, number, number]; rotateDeg: [number, number, number]; scale: number } | null
}

function needsAuth(url: string): boolean {
  return url.startsWith('/api/') || url.includes('/jobs/')
}

function cssColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function resolveAccent(accent: string | undefined, fallbackVar: string, fallbackHex: string): string {
  if (accent?.startsWith('var(')) {
    const name = accent.slice(4, -1).trim()
    return cssColor(name, cssColor(fallbackVar, fallbackHex))
  }
  if (accent) return accent
  return cssColor(fallbackVar, fallbackHex)
}

function sceneColors() {
  const dark = resolveTheme() === 'dark'
  return {
    background: dark ? '#0b1016' : '#e8edf3',
    gridMajor: dark ? 0x3a4558 : 0x9aa8bc,
    gridMinor: dark ? 0x252c3a : 0xcbd5e1,
  }
}

async function fetchStlObjectUrl(url: string): Promise<string> {
  if (!needsAuth(url)) return url
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getApiToken()}` },
  })
  if (!res.ok) throw new Error(`STL fetch ${res.status}`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

function loadGeometry(src: string): Promise<THREE.BufferGeometry> {
  const loader = new STLLoader()
  return new Promise((resolve, reject) => {
    loader.load(src, resolve, undefined, () => reject(new Error('Failed to parse STL')))
  })
}

// Cache parsed geometry by source URL so toggling Compare/overlay doesn't
// re-fetch and re-parse the same STL on every render. Keyed by the resolved
// (blob or direct) URL; entries are bounded and disposed on eviction.
const GEOMETRY_CACHE_LIMIT = 12
const geometryCache = new Map<string, THREE.BufferGeometry>()

async function getCachedGeometry(src: string): Promise<THREE.BufferGeometry> {
  const hit = geometryCache.get(src)
  if (hit) return hit.clone()
  const geometry = await loadGeometry(src)
  if (geometryCache.size >= GEOMETRY_CACHE_LIMIT) {
    const oldest = geometryCache.keys().next().value
    if (oldest !== undefined) {
      geometryCache.get(oldest)?.dispose()
      geometryCache.delete(oldest)
    }
  }
  geometryCache.set(src, geometry)
  return geometry.clone()
}

export function StlViewport({
  url,
  label,
  accent,
  downloads,
  overlayUrl = null,
  overlayAccent,
  primaryOpacity = 1,
  overlayOpacity = 0.35,
  compact = false,
  alignTransform = null,
  heatmap = null,
  nudge = null,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const groupRef = useRef<THREE.Group | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const overlayRef = useRef<THREE.Mesh | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const fitRef = useRef<(() => void) | null>(null)
  const downloadMenuRef = useRef<HTMLDivElement | null>(null)
  const showGridRef = useRef(true)
  const spinRef = useRef(false)
  const wireRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [spin, setSpin] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [themeTick, setThemeTick] = useState(0)
  const [downloadOpen, setDownloadOpen] = useState(false)

  useEffect(() => {
    if (!downloadOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const root = downloadMenuRef.current
      if (root && !root.contains(e.target as Node)) {
        setDownloadOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDownloadOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [downloadOpen])

  const meshAccent = resolveAccent(accent, '--mesh-gen', '#0d9488')
  const ghostAccent = resolveAccent(overlayAccent, '--mesh-ref', '#2563eb')
  spinRef.current = spin
  wireRef.current = wireframe
  showGridRef.current = showGrid

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1))
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    for (const mesh of [meshRef.current, overlayRef.current]) {
      if (!mesh) continue
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial) {
          m.wireframe = wireframe
          m.needsUpdate = true
        }
      }
    }
  }, [wireframe])

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid
  }, [showGrid])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.opacity = primaryOpacity
        m.transparent = primaryOpacity < 0.999
        m.depthWrite = primaryOpacity >= 0.999
        m.needsUpdate = true
      }
    }
  }, [primaryOpacity])

  useEffect(() => {
    const mesh = overlayRef.current
    if (!mesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.opacity = overlayOpacity
        m.transparent = true
        m.depthWrite = overlayOpacity >= 0.95
        m.needsUpdate = true
      }
    }
  }, [overlayOpacity])

  // Apply ICP transform + manual nudge to the primary mesh. Nudge composes on
  // top of alignment so users can fine-tune after auto-align.
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const base = new THREE.Matrix4()
    if (alignTransform && alignTransform.length === 16) {
      base.fromArray(alignTransform)
    }
    mesh.matrixAutoUpdate = false
    mesh.matrix.copy(base)
    if (nudge) {
      const t = new THREE.Matrix4().makeTranslation(...nudge.translate)
      const r = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(
          (nudge.rotateDeg[0] * Math.PI) / 180,
          (nudge.rotateDeg[1] * Math.PI) / 180,
          (nudge.rotateDeg[2] * Math.PI) / 180,
        ),
      )
      const s = new THREE.Matrix4().makeScale(nudge.scale, nudge.scale, nudge.scale)
      mesh.matrix.multiply(t).multiply(r).multiply(s)
    }
    mesh.matrixWorldNeedsUpdate = true
  }, [alignTransform, nudge, themeTick])

  // Heatmap: color the primary mesh by per-vertex deviation (blue → red).
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const geometry = mesh.geometry
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const mat = mats[0]
    if (!(mat instanceof THREE.MeshStandardMaterial)) return

    if (!heatmap || heatmap.distances.length === 0) {
      geometry.deleteAttribute('color')
      mat.vertexColors = false
      mat.color.set(meshAccent)
      mat.needsUpdate = true
      return
    }

    const max = Math.max(...heatmap.distances, 1e-6)
    const colors = new Float32Array(geometry.attributes.position.count * 3)
    const cLow = new THREE.Color('#2563eb')
    const cMid = new THREE.Color('#facc15')
    const cHigh = new THREE.Color('#dc2626')
    const tmp = new THREE.Color()
    for (let i = 0; i < heatmap.vertexIndices.length; i++) {
      const vi = heatmap.vertexIndices[i]
      const d = Math.min(heatmap.distances[i] / max, 1)
      if (d < 0.5) {
        tmp.lerpColors(cLow, cMid, d * 2)
      } else {
        tmp.lerpColors(cMid, cHigh, (d - 0.5) * 2)
      }
      colors[vi * 3] = tmp.r
      colors[vi * 3 + 1] = tmp.g
      colors[vi * 3 + 2] = tmp.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    mat.vertexColors = true
    mat.color.set('#ffffff')
    mat.needsUpdate = true
  }, [heatmap])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !url) return

    let disposed = false
    const revoke: string[] = []
    let frame = 0
    setError(null)
    setLoading(true)

    const colors = sceneColors()
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(colors.background)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000)
    camera.position.set(2, 2, 2)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const dir = new THREE.DirectionalLight(0xffffff, 0.95)
    dir.position.set(3, 5, 2)
    scene.add(dir)

    const grid = new THREE.GridHelper(4, 16, colors.gridMajor, colors.gridMinor)
    grid.visible = showGridRef.current
    gridRef.current = grid
    scene.add(grid)

    const group = new THREE.Group()
    groupRef.current = group
    scene.add(group)

    const fitCamera = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z, 0.001)
      const dist = maxDim * 2.2
      camera.near = Math.max(dist / 100, 0.01)
      camera.far = dist * 100
      camera.updateProjectionMatrix()
      camera.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist)
      controls.target.copy(center)
      controls.update()
      if (gridRef.current) scene.remove(gridRef.current)
      const next = new THREE.GridHelper(
        Math.max(maxDim * 2.5, 1),
        16,
        colors.gridMajor,
        colors.gridMinor,
      )
      next.position.y = box.min.y
      next.visible = showGridRef.current
      gridRef.current = next
      scene.add(next)
    }

    fitRef.current = () => {
      if (groupRef.current) {
        groupRef.current.rotation.set(0, 0, 0)
        fitCamera(groupRef.current)
      }
    }

    const resize = () => {
      const w = mount.clientWidth || 320
      const h = mount.clientHeight || 280
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    const animate = () => {
      frame = requestAnimationFrame(animate)
      if (spinRef.current && groupRef.current) {
        groupRef.current.rotation.y += 0.008
      }
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onFail = (msg: string) => {
      if (!disposed) {
        setError(msg)
        setLoading(false)
      }
    }

    void (async () => {
      try {
        const primarySrc = await fetchStlObjectUrl(url)
        if (primarySrc !== url) revoke.push(primarySrc)
        if (disposed) return
        const geometry = await getCachedGeometry(primarySrc)
        if (disposed) {
          geometry.dispose()
          return
        }
        geometry.computeVertexNormals()
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(meshAccent),
          metalness: 0.15,
          roughness: 0.55,
          wireframe: wireRef.current,
          transparent: primaryOpacity < 0.999,
          opacity: primaryOpacity,
          depthWrite: primaryOpacity >= 0.999,
        })
        const mesh = new THREE.Mesh(geometry, material)
        meshRef.current = mesh
        group.add(mesh)

        if (overlayUrl) {
          try {
            const overlaySrc = await fetchStlObjectUrl(overlayUrl)
            if (overlaySrc !== overlayUrl) revoke.push(overlaySrc)
            if (!disposed) {
              const og = await getCachedGeometry(overlaySrc)
              if (!disposed) {
                og.computeVertexNormals()
                const om = new THREE.MeshStandardMaterial({
                  color: new THREE.Color(ghostAccent),
                  metalness: 0.1,
                  roughness: 0.65,
                  wireframe: wireRef.current,
                  transparent: true,
                  opacity: overlayOpacity,
                  depthWrite: false,
                })
                const overlayMesh = new THREE.Mesh(og, om)
                overlayRef.current = overlayMesh
                group.add(overlayMesh)
              } else {
                og.dispose()
              }
            }
          } catch {
            /* overlay is optional */
          }
        }

        fitCamera(group)
        setLoading(false)
      } catch (e) {
        onFail((e as Error).message || 'Failed to load STL')
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      ro.disconnect()
      controls.dispose()
      fitRef.current = null
      meshRef.current = null
      overlayRef.current = null
      groupRef.current = null
      gridRef.current = null
      renderer.dispose()
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement)
      }
      for (const u of revoke) URL.revokeObjectURL(u)
    }
  }, [url, overlayUrl, meshAccent, ghostAccent, themeTick])

  return (
    <div className={`viewport-shell${compact ? ' compact' : ''}`}>
      <div className="viewport-toolbar">
        <span className="viewport-label">{label}</span>
        <div className="viewport-actions">
          <button
            type="button"
            className="viewport-btn"
            disabled={!url}
            onClick={() => fitRef.current?.()}
            title="Reset camera"
          >
            Reset
          </button>
          <button
            type="button"
            className={`viewport-btn${wireframe ? ' active' : ''}`}
            disabled={!url}
            onClick={() => setWireframe((v) => !v)}
            title="Toggle wireframe"
          >
            Wire
          </button>
          <button
            type="button"
            className={`viewport-btn${spin ? ' active' : ''}`}
            disabled={!url}
            onClick={() => setSpin((v) => !v)}
            title="Auto-rotate"
          >
            Spin
          </button>
          <button
            type="button"
            className={`viewport-btn${showGrid ? ' active' : ''}`}
            disabled={!url}
            onClick={() => setShowGrid((v) => !v)}
            title="Toggle grid"
          >
            Grid
          </button>
          {downloads && downloads.length > 0 ? (
            <div className="viewport-download" ref={downloadMenuRef}>
              <button
                type="button"
                className={`viewport-btn${downloadOpen ? ' active' : ''}`}
                disabled={downloads.every((d) => d.disabled)}
                aria-haspopup="menu"
                aria-expanded={downloadOpen}
                onClick={() => setDownloadOpen((v) => !v)}
                title="Download mesh"
              >
                Download ▾
              </button>
              {downloadOpen ? (
                <div className="viewport-download-menu" role="menu">
                  {downloads.map((d) => (
                    <button
                      key={d.label}
                      type="button"
                      role="menuitem"
                      disabled={d.disabled}
                      onClick={() => {
                        d.onClick()
                        setDownloadOpen(false)
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="viewport" ref={mountRef}>
        {!url && <div className="viewport-empty">No mesh yet</div>}
        {url && loading && <div className="viewport-empty">Loading…</div>}
        {error && <div className="viewport-empty">{error}</div>}
      </div>
      {!compact ? (
        <p className="hint viewport-hint">Drag to orbit · scroll to zoom · right-drag to pan</p>
      ) : null}
    </div>
  )
}
