import logger from '@overleaf/logger'

logger.debug({}, 'Enable the diagram editor module (SVG canvas, in-bundle)')

/**
 * Nothing to configure on the server side: the editor renders on
 * @svgedit/svgcanvas (MIT, zero dependencies) which is part of Overleaf's
 * own JavaScript bundle — no iframe, no external origin, hence no
 * Content-Security-Policy additions required.
 */
const DiagramModule = {}
export default DiagramModule
