/**
 * Pure export logic for the LaTeX equation editor: wraps the equation in the
 * chosen LaTeX container. Keeping this free of DOM/React makes it unit
 * testable.
 */

export const EXPORT_WRAPPERS = [
  'plain',
  'equation',
  'eqnarray',
  'inline',
  'display',
]

/**
 * Wrap an equation's LaTeX in the given container.
 *
 * @param {string} latex - LaTeX of the equation body
 * @param {string} wrapper - one of EXPORT_WRAPPERS; anything else returns the
 *   body unchanged
 * @returns {string} the wrapped LaTeX
 */
export function wrapLatex(latex, wrapper = 'plain') {
  const body = typeof latex === 'string' ? latex : ''
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
