/**
 * Grammar check settings section — rendered inside the LLM user settings
 * page (/user/llm-settings).
 *
 * Modes (availability-gated, degraded gracefully):
 *   default   — Overleaf Hunspell spell check only
 *   lt        — LanguageTool + Hunspell
 *   llm       — LLM grammar + Hunspell
 *   lt+llm    — LanguageTool + LLM + Hunspell (combined)
 *
 * Persistence: per-user, server-side (GET/POST /user/llm-settings/grammar).
 * Communication with the CodeMirror extension is done via a window
 * CustomEvent `grammar:settings-changed` so this component does not need to
 * be inside the CodeMirror view.
 */

import React, { useState, useEffect, useMemo } from 'react'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLNotification from '@/shared/components/ol/ol-notification'

type GrammarMode = 'default' | 'lt' | 'llm' | 'lt+llm'

interface GrammarSettings {
    llmAdminEnabled: boolean
    llmServerConfigured: boolean
    llmAvailableForUser: boolean
    ltAvailable: boolean
}

interface GrammarSettingsResponse {
    mode: GrammarMode
    effectiveMode: GrammarMode
    llmModel: string
    language: string
    blockedRules?: string[]
    availability: GrammarSettings
    models: Array<{ id: string; name: string; isPersonal: boolean }>
}

const emptyAvailability: GrammarSettings = {
    llmAdminEnabled: false,
    llmServerConfigured: false,
    llmAvailableForUser: false,
    ltAvailable: false,
}

/** Dispatch the change to the editor extension (if one is present). */
function announceChange(
    mode: GrammarMode,
    llmModel: string,
    language: string
) {
    window.dispatchEvent(
        new CustomEvent('grammar:settings-changed', {
            detail: { mode, llmModel, language },
        })
    )
}

export default function GrammarSettingsSection() {
    const metaAvailability: GrammarSettings =
        (getMeta('ol-grammarSettings') as GrammarSettings) || emptyAvailability

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [availability, setAvailability] =
        useState<GrammarSettings>(metaAvailability)
    const [storedMode, setStoredMode] = useState<GrammarMode>('default')
    const [mode, setMode] = useState<GrammarMode>('default')
    const [llmModel, setLlmModel] = useState('')
    const [language, setLanguage] = useState('auto')
    const [models, setModels] = useState<
        Array<{ id: string; name: string; isPersonal: boolean }>
    >([])
    const [languages, setLanguages] = useState<
        Array<{ name: string; longCode: string }>
    >([])
    const [languagesLoading, setLanguagesLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    // overleaf-lab (grammar port): free-text list of LanguageTool rule IDs the
    // user blocked (rule name is shown in the editor hover panel, e.g.
    // "LanguageTool (PASSIVE_VOICE_SIMPLE)")
    const [blockedRules, setBlockedRules] = useState<string[]>([])
    const [newRule, setNewRule] = useState('')
    const [addRuleError, setAddRuleError] = useState<string | null>(null)

    // ── Hydrate from the server (authoritative, per-user) ─────────────
    useEffect(() => {
        let cancelled = false
        getJSON<GrammarSettingsResponse>('/user/llm-settings/grammar')
            .then(data => {
                if (cancelled) return
                setAvailability(data.availability ?? emptyAvailability)
                setStoredMode(data.mode || 'default')
                setMode(data.effectiveMode || data.mode || 'default')
                setLlmModel(data.llmModel || '')
                setLanguage(data.language || 'auto')
                setBlockedRules(data.blockedRules ?? [])
                setModels(data.models ?? [])
            })
            .catch(() => {
                if (!cancelled) setError(true)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [])

    // ── LT languages (only needed when an LT mode is active) ──────────
    const needsLanguages =
        availability.ltAvailable && (mode === 'lt' || mode === 'lt+llm')

    useEffect(() => {
        if (!needsLanguages || languages.length > 0 || languagesLoading)
            return
        setLanguagesLoading(true)
        getJSON<Array<{ name: string; longCode: string }>>(
            '/languagetool/languages'
        )
            .then(langs => {
                if (Array.isArray(langs)) {
                    setLanguages(
                        [...langs].sort((a, b) =>
                            (a.name || '').localeCompare(b.name || '')
                        )
                    )
                }
            })
            .catch(() => {})
            .finally(() => setLanguagesLoading(false))
    }, [needsLanguages, languages.length, languagesLoading])

    // ── Mode options per availability (not rendered when unavailable) ─
    const modeOptions = useMemo(() => {
        const options: Array<{ value: GrammarMode; label: string }> = [
            { value: 'default', label: 'Default Overleaf spell check' },
        ]
        if (availability.ltAvailable) {
            options.push({
                value: 'lt',
                label: 'LanguageTool + Overleaf spell check',
            })
        }
        if (availability.llmAvailableForUser) {
            options.push({
                value: 'llm',
                label: 'LLM + Overleaf spell check',
            })
        }
        if (availability.ltAvailable && availability.llmAvailableForUser) {
            options.push({
                value: 'lt+llm',
                label: 'LanguageTool + LLM + Overleaf spell check',
            })
        }
        return options
    }, [availability.ltAvailable, availability.llmAvailableForUser])

    const degraded = storedMode !== mode

    const addBlockedRule = () => {
        const id = newRule.trim().slice(0, 120)
        if (!id) {
            setAddRuleError('Enter a rule ID to block')
            return
        }
        if (blockedRules.some(r => r.toLowerCase() === id.toLowerCase())) {
            setAddRuleError('That rule is already blocked')
            return
        }
        setBlockedRules([...blockedRules, id])
        setNewRule('')
        setAddRuleError(null)
    }

    const removeBlockedRule = (id: string) => {
        setBlockedRules(blockedRules.filter(r => r !== id))
    }

    const handleModeChange = (value: GrammarMode) => {
        setMode(value)
    }

    const handleSave = async () => {
        setSaving(true)
        setSaveError(null)
        setSaved(false)
        try {
            const response = await postJSON<{
                success: boolean
                effectiveMode?: GrammarMode
                blockedRules?: string[]
            }>('/user/llm-settings/grammar', {
                body: { mode, llmModel, language, blockedRules },
            })
            const nextMode =
                response.effectiveMode ?? mode
            setMode(nextMode)
            setStoredMode(nextMode)
            if (Array.isArray(response.blockedRules)) {
                setBlockedRules(response.blockedRules)
            }
            setSaved(true)
            // Tell the editor extension (if the user has an editor open in
            // another tab — and always, so the extension can resync).
            announceChange(nextMode, llmModel, language)
            setTimeout(() => setSaved(false), 4000)
        } catch (err) {
            setSaveError(
                err instanceof Error
                    ? err.message
                    : 'Failed to save grammar settings'
            )
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return <div style={{ fontSize: '0.875rem' }}>Loading…</div>
    }

    if (error) {
        return (
            <OLNotification type="error" content="Could not load your grammar settings.">
            </OLNotification>
        )
    }

    const showModelSelector = mode === 'llm' || mode === 'lt+llm'
    const showLanguageSelector = mode === 'lt' || mode === 'lt+llm'

    return (
        <>
            <h3 style={{ marginTop: '1.5rem' }}>Grammar check</h3>
            <OLFormText>
                How grammar is checked in the source editor. Overleaf spell
                check (Hunspell) is always combined with the mode you pick
                here.
            </OLFormText>

            {degraded && (
                <OLFormGroup>
                    <OLNotification
                        type="warning"
                        content={`Your saved grammar mode (${storedMode}) is not available right now — using ${mode} instead.`}
                    />
                    </OLFormGroup>
            )}

            <form
                onSubmit={event => {
                    event.preventDefault()
                    handleSave()
                }}
            >
                <OLFormGroup>
                    <OLFormLabel>Grammar mode</OLFormLabel>
                    {modeOptions.map(option => (
                        <div
                            key={option.value}
                            style={{ marginBottom: '0.25rem' }}
                        >
                            <input
                                type="radio"
                                name="grammar-mode"
                                id={`grammar-mode-${option.value}`}
                                value={option.value}
                                checked={mode === option.value}
                                onChange={() =>
                                    handleModeChange(option.value)
                                }
                                style={{ marginRight: '0.5rem' }}
                            />
                            <label htmlFor={`grammar-mode-${option.value}`}>
                                {option.label}
                            </label>
                        </div>
                    ))}
                </OLFormGroup>

                {showModelSelector && (
                    <OLFormGroup controlId="grammar-llm-model">
                        <OLFormLabel>Model for LLM grammar check</OLFormLabel>
                        <select
                            className="form-control"
                            style={{ width: '18rem' }}
                            value={llmModel}
                            onChange={event =>
                                setLlmModel(event.target.value)
                            }
                        >
                            <option value="">Server default</option>
                            {models.map(model => (
                                <option key={model.id} value={model.id}>
                                    {model.name}
                                </option>
                            ))}
                        </select>
                    </OLFormGroup>
                )}

                {showLanguageSelector && (
                    <OLFormGroup controlId="grammar-lt-language">
                        <OLFormLabel>
                            Language for grammar check
                        </OLFormLabel>
                        <select
                            className="form-control"
                            style={{ width: '18rem' }}
                            value={language}
                            onChange={event => setLanguage(event.target.value)}
                            disabled={languagesLoading}
                        >
                            <option value="auto">Auto-detect</option>
                            {languages.map(lang => (
                                <option key={lang.longCode} value={lang.longCode}>
                                    {lang.name}
                                </option>
                            ))}
                        </select>
                    </OLFormGroup>
                )}

                {/* overleaf-lab (grammar port): blocklist of LanguageTool rules.
                    Free text: the rule ID is shown in the editor hover panel
                    (e.g. "LanguageTool (PASSIVE_VOICE_SIMPLE)"). Filtered in the
                    editor before anything is shown, so no rule catalog needed. */}
                <OLFormGroup controlId="grammar-blocked-rules">
                    <OLFormLabel>Blocked rules (LanguageTool)</OLFormLabel>
                    <OLFormText>
                        Block individual LanguageTool rules that annoy you. Copy the
                        rule ID from the underline tooltip in the editor (shown as
                        "LanguageTool (RULE_ID)"), add it here, and the editor will
                        stop showing it. Works regardless of the grammar mode and the
                        project's picky setting.
                    </OLFormText>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                            className="form-control"
                            style={{ width: '18rem' }}
                            placeholder="e.g. PASSIVE_VOICE_SIMPLE"
                            value={newRule}
                            onChange={event => {
                                setNewRule(event.target.value)
                                setAddRuleError(null)
                            }}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    addBlockedRule()
                                }
                            }}
                        />
                        <OLButton
                            variant="secondary"
                            type="button"
                            onClick={addBlockedRule}
                        >
                            Add
                        </OLButton>
                    </div>
                    {addRuleError && (
                        <OLFormText style={{ color: 'var(--danger, #d9534f)' }}>
                            {addRuleError}
                        </OLFormText>
                    )}
                    {blockedRules.length > 0 ? (
                        <ul
                            style={{
                                margin: '0.5rem 0 0',
                                paddingLeft: '1.25rem',
                            }}
                        >
                            {blockedRules.map(rule => (
                                <li key={rule} style={{ marginBottom: '0.25rem' }}>
                                    <code>{rule}</code>
                                    <button
                                        type="button"
                                        onClick={() => removeBlockedRule(rule)}
                                        style={{
                                            marginLeft: '0.5rem',
                                            border: 'none',
                                            background: 'none',
                                            cursor: 'pointer',
                                            color: 'var(--danger, #d9534f)',
                                        }}
                                    >
                                        (remove)
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <OLFormText>
                            No rules blocked yet.
                        </OLFormText>
                    )}
                </OLFormGroup>

                <OLFormGroup>
                    <OLButton
                        variant="primary"
                        type="submit"
                        disabled={saving}
                        isLoading={saving}
                        loadingLabel="Saving…"
                    >
                        Save
                    </OLButton>
                </OLFormGroup>

                {saved && (
                    <OLFormGroup>
                        <OLNotification type="success" content="Grammar settings saved." />
                        </OLFormGroup>
                )}

                {saveError && (
                    <OLFormGroup>
                        <OLNotification type="error" content={saveError} />
                        </OLFormGroup>
                )}
            </form>
        </>
    )
}
