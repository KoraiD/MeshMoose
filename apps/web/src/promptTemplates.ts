export type PromptTemplate = {
  id: string
  title: string
  prompt: string
  builtin?: boolean
}

const STORAGE_KEY = 'meshmoose.promptTemplates'

export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: 'builtin-washer',
    title: 'Washer',
    builtin: true,
    prompt:
      'Recreate this flat washer as clean parametric KCL (no STL import). ' +
      'Match outer diameter, inner hole, and thickness from the photo and scan. ' +
      'Keep faces flat and the hole centered.',
  },
  {
    id: 'builtin-bracket',
    title: 'Bracket',
    builtin: true,
    prompt:
      'Recreate this mounting bracket as fully parametric KCL. ' +
      'Capture overall envelope, plate thickness, bend/fillets, and hole positions from the references. ' +
      'Prefer simple extrudes and holes over organic surfaces.',
  },
  {
    id: 'builtin-coin',
    title: 'Coin / token',
    builtin: true,
    prompt:
      'Recreate this coin or shopping-cart token as parametric KCL. ' +
      'Match diameter, thickness, and any tab/keyring feature from the photo and mesh. ' +
      'Keep the coin head circular and dimensions editable.',
  },
]

function readCustom(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PromptTemplate[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (t) =>
          t &&
          typeof t.id === 'string' &&
          typeof t.title === 'string' &&
          typeof t.prompt === 'string',
      )
      .map((t) => ({
        id: t.id,
        title: t.title.trim().slice(0, 80),
        prompt: t.prompt.trim().slice(0, 8000),
        builtin: false,
      }))
      .filter((t) => t.title && t.prompt)
  } catch {
    return []
  }
}

function writeCustom(list: PromptTemplate[]): void {
  const custom = list
    .filter((t) => !t.builtin)
    .map(({ id, title, prompt }) => ({ id, title, prompt }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))
}

export function listPromptTemplates(): PromptTemplate[] {
  return [...BUILTIN_TEMPLATES, ...readCustom()]
}

export function savePromptTemplate(input: {
  id?: string
  title: string
  prompt: string
}): PromptTemplate {
  const title = input.title.trim().slice(0, 80)
  const prompt = input.prompt.trim().slice(0, 8000)
  if (!title || !prompt) {
    throw new Error('Title and prompt are required')
  }
  const custom = readCustom()
  if (input.id?.startsWith('builtin-')) {
    throw new Error('Built-in templates cannot be overwritten')
  }
  const id = input.id || `custom-${crypto.randomUUID().slice(0, 8)}`
  const next: PromptTemplate = { id, title, prompt, builtin: false }
  const idx = custom.findIndex((t) => t.id === id)
  if (idx >= 0) custom[idx] = next
  else custom.push(next)
  writeCustom(custom)
  return next
}

export function deletePromptTemplate(id: string): void {
  if (id.startsWith('builtin-')) {
    throw new Error('Built-in templates cannot be deleted')
  }
  writeCustom(readCustom().filter((t) => t.id !== id))
}
