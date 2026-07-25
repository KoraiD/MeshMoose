import { StreamLanguage } from '@codemirror/language'
import { KCL_KEYWORDS } from './highlight'

/** Lightweight KCL stream highlighter for the Live Engine editor. */
export const kclLanguage = StreamLanguage.define({
  name: 'kcl',
  languageData: {
    commentTokens: { line: '//' },
  },
  token(stream) {
    if (stream.match(/\/\/.*/)) return 'comment'
    if (stream.match(/"(?:\\.|[^"\\])*"/) || stream.match(/'(?:\\.|[^'\\])*'/)) {
      return 'string'
    }
    if (stream.match(/\d+(?:\.\d+)?/)) return 'number'
    if (stream.match(/[A-Za-z_][\w]*/)) {
      const word = stream.current()
      if (KCL_KEYWORDS.has(word)) return 'keyword'
      return 'variableName'
    }
    if (stream.match(/[{}()[\],.:;=+\-*/%<>!&|]+/)) return 'operator'
    stream.next()
    return null
  },
})
