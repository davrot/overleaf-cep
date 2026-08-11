import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import DropboxIntegrationCard from './dropbox-integration-card.tsx'

const DropboxWidget = () => {
  const { project } = useProjectContext()
  
  // Only render if user has write access
  if (!project?._id) return null

  return <DropboxIntegrationCard />
}

export default DropboxWidget
