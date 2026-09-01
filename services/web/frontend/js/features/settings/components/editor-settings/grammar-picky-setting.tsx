import { useProjectSettingsContext } from '@/features/editor-left-menu/context/project-settings-context'
import ToggleSetting from '../toggle-setting'
import { useTranslation } from 'react-i18next'

// overleaf-lab (grammar port): per-project LanguageTool pickiness toggle.
// ON (default) requests the richer "picky" rule set (style, wordiness, passive
// voice, ...); OFF falls back to LanguageTool's default grammar rules. A
// coarser switch than the per-user "blocked rules" list, which filters
// individual rules regardless of level.
export default function GrammarPickySetting() {
  const { grammarPicky, setGrammarPicky } = useProjectSettingsContext()
  const { t } = useTranslation()

  return (
    <ToggleSetting
      id="grammarPicky"
      label={t('grammar_picky', { defaultValue: 'Picky grammar rules' })}
      description={t('grammar_picky_description', {
        defaultValue:
          'Also check style rules (passive voice, wordiness, fragments, ...). Turn off in a project if they are too aggressive.',
      })}
      checked={grammarPicky}
      onChange={value => setGrammarPicky(value)}
    />
  )
}
