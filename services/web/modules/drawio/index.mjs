import logger from '@overleaf/logger'

logger.debug({}, 'Enable the diagram editor module (maxGraph canvas, in-bundle)')

/**
 * Nothing to configure on the server side: the editor renders on a
 * maxGraph canvas that is part of Overleaf's own JavaScript bundle
 * (`@maxgraph/core`, npm, Apache-2.0) — no iframe, no external origin,
 * hence no Content-Security-Policy additions required.
 */
const DrawioModule = {}
export default DrawioModule
