import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from './MarkdownView'

function renderMd(text: string): HTMLElement {
  const { container } = render(<MarkdownView text={text} />)
  const el = container.querySelector('.md-body')
  if (!el) throw new Error('expected .md-body to render')
  return el as HTMLElement
}

describe('MarkdownView sanitization', () => {
  it('renders safe markdown', () => {
    const el = renderMd('# Title\n\nSome **bold** text with a [link](https://zoo.dev).')
    expect(el.querySelector('h1')?.textContent).toBe('Title')
    expect(el.querySelector('strong')?.textContent).toBe('bold')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://zoo.dev')
  })

  it('strips script tags', () => {
    const el = renderMd('hello <script>window.pwned = true</script> world')
    expect(el.querySelector('script')).toBeNull()
    expect(el.innerHTML).not.toContain('window.pwned')
  })

  it('strips event handlers with unquoted attributes', () => {
    const el = renderMd('<img src=x onerror=alert(1)>')
    const img = el.querySelector('img')
    expect(img?.getAttribute('onerror')).toBeNull()
    expect(el.innerHTML).not.toContain('onerror')
  })

  it('strips svg onload handlers', () => {
    const el = renderMd('<svg onload=alert(1)></svg>')
    expect(el.innerHTML).not.toContain('onload')
  })

  it('strips javascript: URLs', () => {
    const el = renderMd('[click](javascript:alert(1))')
    const a = el.querySelector('a')
    expect(a?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('strips iframe embeds', () => {
    const el = renderMd('before <iframe src="https://evil.example"></iframe> after')
    expect(el.querySelector('iframe')).toBeNull()
    expect(el.textContent).toContain('before')
  })

  it('shows empty placeholder for blank input', () => {
    const { container } = render(<MarkdownView text="  " empty="(nothing yet)" />)
    expect(container.textContent).toContain('(nothing yet)')
  })
})
