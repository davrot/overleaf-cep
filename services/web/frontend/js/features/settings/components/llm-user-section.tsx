// overleaf-lab: PR item 2 — a real LLM section on the Account Settings page:
// the BYO provider management (table + editor) is rendered HERE when the LLM
// module is present (injected via the overleafModuleImports macro — the same
// mechanism core uses for the github/zotero linking widgets, so the module's
// React code stays in the module without risking dual React instances in the
// core bundle). If the module is absent, we fall back to a plain link card to
// the dedicated page, so the settings page always shows something useful.
//
// NOTE: the module section is a full-page-sized component (its own table,
// editor and notifications); it renders compactly (no double header) inside
// this section when embedded.
import React from 'react'
import { useTranslation } from 'react-i18next'
import importOverleafModules from '../../../../macros/import-overleaf-module.macro'

const [llmUserSettingsSectionModule] = importOverleafModules(
    'llmUserSettingsSection'
) as { import: { default: React.ElementType } }[]

function LLMUserSection() {
    const { t } = useTranslation()
    const EmbeddedSection = llmUserSettingsSectionModule?.import?.default

    if (EmbeddedSection) {
        return (
            <div className="llm-settings-embedded">
                <h2>{t('llm_section_title', 'AI assistant')}</h2>
                <p style={{ color: '#6c757d' }}>
                    {t(
                        'llm_section_help',
                        'Manage the AI chat, selection actions, generators and your own LLM connections below. Keys are encrypted on this server.',
                    )}
                </p>
                <EmbeddedSection compact />
            </div>
        )
    }

    return (
        <div style={{ marginTop: '0.5rem' }}>
            <h2>{t('llm_section_title', 'AI assistant')}</h2>
            <p style={{ color: '#6c757d' }}>
                {t(
                    'llm_section_help',
                    'Use the AI chat, selection actions and optional personal LLM connection for this project.',
                )}
            </p>
            <a
                href="/user/llm-settings"
                className="btn btn-secondary"
                aria-label={t('llm_section_open', 'Open AI assistant settings')}
            >
                {t('llm_section_open', 'Open AI assistant settings')}
            </a>
        </div>
    )
}

export default LLMUserSection
