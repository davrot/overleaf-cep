/**
 * /library root (page auto-entry; template-gallery precedent).
 * The context owns the Library/Trash view state (client-side switch);
 * the initial view comes from the `ol-libraryView` meta tag set by the
 * page routes (libraryPage → 'library', libraryTrashPage → 'trash').
 */
import React from 'react'
import { LibraryProvider } from './library-context'
import type { LibraryView } from './library-context'
import LibraryPage from './library-page'

function initialView(): LibraryView {
  if (typeof document === 'undefined') return 'library'
  const meta = document.querySelector('meta[name="ol-libraryView"]')
  return meta?.getAttribute('content') === 'trash' ? 'trash' : 'library'
}

export default function LibraryRoot() {
  // The meta tag is static per page load; read it once.
  const view = React.useMemo(() => initialView(), [])
  return (
    <LibraryProvider initialView={view}>
      <LibraryPage />
    </LibraryProvider>
  )
}
