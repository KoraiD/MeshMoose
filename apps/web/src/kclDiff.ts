/** Line-based diff (LCS) for comparing KCL revisions — initial vs current. */

export type DiffLine = {
  kind: 'same' | 'add' | 'del'
  text: string
}

function splitLines(text: string): string[] {
  // ''.split('\n') yields [''], a spurious empty line; normalize empty → [].
  if (text === '') return []
  return text.split('\n')
}

/** Compute a compact line diff between two texts (old → new). */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const n = a.length
  const m = b.length

  // LCS dynamic programming over lines.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] })
      i++
    } else {
      out.push({ kind: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] })
  while (j < m) out.push({ kind: 'add', text: b[j++] })
  return out
}

/** Collapse long runs of unchanged lines for readability. */
export function collapseSame(lines: DiffLine[], context = 2): (DiffLine | { kind: 'gap'; count: number })[] {
  const out: (DiffLine | { kind: 'gap'; count: number })[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind !== 'same') {
      out.push(lines[i])
      i++
      continue
    }
    let j = i
    while (j < lines.length && lines[j].kind === 'same') j++
    const run = j - i
    if (run <= context * 2 + 1) {
      for (let k = i; k < j; k++) out.push(lines[k])
    } else {
      for (let k = i; k < i + context; k++) out.push(lines[k])
      out.push({ kind: 'gap', count: run - context * 2 })
      for (let k = j - context; k < j; k++) out.push(lines[k])
    }
    i = j
  }
  return out
}
