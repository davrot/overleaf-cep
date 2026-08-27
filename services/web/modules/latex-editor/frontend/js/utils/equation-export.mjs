/**
 * Wraps a LaTeX equation body with an environment / math fence for
 * insertion into the Overleaf document. `latex` is the content of the
 * editor (MathLive or raw textarea), `wrapper` selects the export form.
 *
 * Leading/trailing whitespace and trailing text-space tokens produced
 * by MathLive (e.g. a cursor space rendered as `\text{ }`) are trimmed
 * before wrapping, so the exported equation is clean both sides.
 */
export const EXPORT_WRAPPERS = ['plain', 'equation', 'eqnarray', 'inline', 'display']

// MathLive renders a typed space as a text-space token
const LATEX_SPACE_TOKEN = '\\text{ }'

function trimLatex(latex) {
  let body = String(latex).trim()
  while (body.startsWith(LATEX_SPACE_TOKEN)) {
    body = body.slice(LATEX_SPACE_TOKEN.length).trimStart()
  }
  while (body.endsWith(LATEX_SPACE_TOKEN)) {
    body = body.slice(0, -LATEX_SPACE_TOKEN.length).trimEnd()
  }
  return body
}

export function wrapLatex(latex, wrapper) {
  const body = trimLatex(latex)
  switch (wrapper) {
    case 'equation':
      return `\\begin{equation}\n${body}\n\\end{equation}`
    case 'eqnarray':
      return `\\begin{eqnarray}\n${body}\n\\end{eqnarray}`
    case 'inline':
      return `$${body}$`
    case 'display':
      return `\\[${body}\\]`
    case 'plain':
    default:
      return body
  }
}
