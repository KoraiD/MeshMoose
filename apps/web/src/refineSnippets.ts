/** Built-in + custom refine snippets (text + optional photo/mesh attachments). */

export const REFINE_PROMPT_MAX = 2000
export const REFINE_TITLE_MAX = 80
export const REFINE_SNIPPET_MAX_PHOTOS = 4
export const REFINE_SNIPPET_MAX_MESHES = 2
export const REFINE_SNIPPET_MAX_FILE_BYTES = 32 * 1024 * 1024

export type RefineSnippetAttach = {
  demoId: string
  photos?: string[]
  meshes?: string[]
}

export type RefineSnippet = {
  id: string
  title: string
  prompt: string
  builtin?: boolean
  /** Built-in package: load assets from a bundled demo. */
  attach?: RefineSnippetAttach
  /** Custom snippet: has stored File blobs in IndexedDB. */
  hasFiles?: boolean
  photoCount?: number
  meshCount?: number
}

type StoredFile = {
  name: string
  type: string
  data: ArrayBuffer
}

type StoredCustomSnippet = {
  id: string
  title: string
  prompt: string
  photos: StoredFile[]
  meshes: StoredFile[]
}

const DB_NAME = 'meshmoose'
const DB_VERSION = 1
const STORE = 'refineSnippets'

export const BUILTIN_REFINE_SNIPPETS: RefineSnippet[] = [
  {
    id: 'thicken-walls',
    title: 'Thicken walls',
    builtin: true,
    prompt:
      'Increase all wall thicknesses to at least 2 mm so the part prints reliably in PLA. ' +
      'Keep outer dimensions and mounting features unchanged.',
  },
  {
    id: 'chamfer-edges',
    title: 'Chamfer outer edges',
    builtin: true,
    prompt:
      'Add a 0.5 mm chamfer on all exposed outer edges for safety and easier printing. ' +
      'Do not change holes, recesses, or mating surfaces.',
  },
  {
    id: 'split-for-printing',
    title: 'Split for support-free printing',
    builtin: true,
    prompt:
      'Split this model into the minimum number of parts that each print without supports. ' +
      'Add alignment features (dowel holes or keys) so the parts re-assemble accurately.',
  },
  {
    id: 'add-fillets',
    title: 'Fillet sharp interior corners',
    builtin: true,
    prompt:
      'Add generous fillets (2–3 mm) to sharp interior corners to reduce stress concentration. ' +
      'Preserve the overall envelope and all functional dimensions.',
  },
  {
    id: 'brick-texture',
    title: 'Brick wall texture',
    builtin: true,
    prompt:
      'Use the attached brick reference mesh and photo to recreate a realistic brick wall ' +
      'surface pattern on this model. Project raised brick courses and recessed mortar joints ' +
      'onto the main exterior faces as real parametric geometry (not just a color). ' +
      'Keep brick dimensions consistent with the reference; maintain the part\'s structural ' +
      'dimensions and any mounting features.',
    attach: {
      demoId: 'brick-wall',
      photos: ['brick_photo.jpg'],
      meshes: ['brick_segment.stl'],
    },
  },
]

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function idbAll(): Promise<StoredCustomSnippet[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as StoredCustomSnippet[]) || [])
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
  })
}

async function idbPut(row: StoredCustomSnippet): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
  })
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
  })
}

async function idbGet(id: string): Promise<StoredCustomSnippet | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result as StoredCustomSnippet | undefined)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
  })
}

async function fileToStored(file: File): Promise<StoredFile> {
  if (file.size > REFINE_SNIPPET_MAX_FILE_BYTES) {
    throw new Error(`File “${file.name}” exceeds 32 MB`)
  }
  const data = await file.arrayBuffer()
  return { name: file.name, type: file.type || 'application/octet-stream', data }
}

function storedToFile(s: StoredFile): File {
  return new File([s.data], s.name, { type: s.type || 'application/octet-stream' })
}

export async function listRefineSnippets(): Promise<RefineSnippet[]> {
  const custom = await idbAll()
  const mapped: RefineSnippet[] = custom.map((c) => ({
    id: c.id,
    title: c.title,
    prompt: c.prompt,
    builtin: false,
    hasFiles: c.photos.length + c.meshes.length > 0,
    photoCount: c.photos.length,
    meshCount: c.meshes.length,
  }))
  return [...BUILTIN_REFINE_SNIPPETS, ...mapped]
}

/** Back-compat sync list of builtins only (tests / early render). */
export const REFINE_SNIPPETS = BUILTIN_REFINE_SNIPPETS

export async function saveRefineSnippet(input: {
  id?: string
  title: string
  prompt: string
  photos?: File[]
  meshes?: File[]
  /** When editing, keep previous files if new lists are omitted. */
  keepExistingFiles?: boolean
}): Promise<RefineSnippet> {
  const title = input.title.trim().slice(0, REFINE_TITLE_MAX)
  const prompt = input.prompt.trim().slice(0, REFINE_PROMPT_MAX)
  if (!title || !prompt) throw new Error('Title and instruction are required')
  if (input.id?.startsWith('builtin-') || BUILTIN_REFINE_SNIPPETS.some((b) => b.id === input.id)) {
    throw new Error('Built-in snippets cannot be overwritten')
  }

  const photosIn = input.photos ?? []
  const meshesIn = input.meshes ?? []
  if (photosIn.length > REFINE_SNIPPET_MAX_PHOTOS) {
    throw new Error(`At most ${REFINE_SNIPPET_MAX_PHOTOS} photos per snippet`)
  }
  if (meshesIn.length > REFINE_SNIPPET_MAX_MESHES) {
    throw new Error(`At most ${REFINE_SNIPPET_MAX_MESHES} meshes per snippet`)
  }

  const id = input.id || `custom-${crypto.randomUUID().slice(0, 8)}`
  let photos: StoredFile[] = []
  let meshes: StoredFile[] = []
  if (input.keepExistingFiles && input.id) {
    const prev = await idbGet(input.id)
    photos = prev?.photos ?? []
    meshes = prev?.meshes ?? []
  }
  if (input.photos) {
    photos = await Promise.all(photosIn.map(fileToStored))
  }
  if (input.meshes) {
    meshes = await Promise.all(meshesIn.map(fileToStored))
  }

  await idbPut({ id, title, prompt, photos, meshes })
  return {
    id,
    title,
    prompt,
    builtin: false,
    hasFiles: photos.length + meshes.length > 0,
    photoCount: photos.length,
    meshCount: meshes.length,
  }
}

export async function deleteRefineSnippet(id: string): Promise<void> {
  if (BUILTIN_REFINE_SNIPPETS.some((b) => b.id === id)) {
    throw new Error('Built-in snippets cannot be deleted')
  }
  await idbDelete(id)
}

export async function loadCustomSnippetFiles(
  id: string,
): Promise<{ photos: File[]; meshes: File[] }> {
  const row = await idbGet(id)
  if (!row) return { photos: [], meshes: [] }
  return {
    photos: row.photos.map(storedToFile),
    meshes: row.meshes.map(storedToFile),
  }
}
