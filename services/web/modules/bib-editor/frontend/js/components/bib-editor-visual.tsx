/**
 * Lazy-loaded entry point for the bib-editor visual component.
 * Imported via React.lazy in bib-editor-visual-provider.ts so the component
 * is only bundled/loaded when a .bib file is opened in visual mode.
 */
export { default } from './bib-editor-panel'
