import { useCallback, useEffect } from 'react'
import { useIdeContext } from '../../../shared/context/ide-context'
import { useProjectContext } from '@/shared/context/project-context'
import type { ProjectSettings } from '../utils/api'

export default function useProjectWideSettingsSocketListener() {
  const { socket } = useIdeContext()

  const { project, updateProject } = useProjectContext()

  const setCompiler = useCallback(
    (compiler: ProjectSettings['compiler']) => {
      if (project) {
        updateProject({ compiler })
      }
    },
    [project, updateProject]
  )

  const setImageName = useCallback(
    (imageName: ProjectSettings['imageName']) => {
      if (project) {
        updateProject({ imageName })
      }
    },
    [project, updateProject]
  )

  const setSpellCheckLanguage = useCallback(
    (spellCheckLanguage: ProjectSettings['spellCheckLanguage']) => {
      if (project) {
        updateProject({ spellCheckLanguage })
      }
    },
    [project, updateProject]
  )

  const setGrammarPicky = useCallback(
    (grammarPicky: boolean) => {
      if (project) {
        updateProject({ grammarPicky })
      }
      // overleaf-lab (grammar port): tell the live editor extension (outside
      // React) so it can re-run the grammar check with the new level.
      window.dispatchEvent(
        new CustomEvent('grammar:picky-changed', {
          detail: { picky: grammarPicky === true },
        })
      )
    },
    [project, updateProject]
  )

  useEffect(() => {
    // data is not available on initial mounting
    const dataAvailable = !!project

    if (dataAvailable && socket) {
      socket.on('compilerUpdated', setCompiler)
      socket.on('imageNameUpdated', setImageName)
      socket.on('spellCheckLanguageUpdated', setSpellCheckLanguage)
      socket.on('grammarPickyUpdated', setGrammarPicky)
      return () => {
        socket.removeListener('compilerUpdated', setCompiler)
        socket.removeListener('imageNameUpdated', setImageName)
        socket.removeListener(
          'spellCheckLanguageUpdated',
          setSpellCheckLanguage
        )
        socket.removeListener('grammarPickyUpdated', setGrammarPicky)
      }
    }
  }, [
    socket, project, setCompiler, setImageName, setSpellCheckLanguage, setGrammarPicky,
  ])
}
