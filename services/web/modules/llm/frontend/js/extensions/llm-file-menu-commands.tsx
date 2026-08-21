// overleaf-lab: File-menu commands for the whole-document LLM generators
// (reviewer #13: "Title/Abstract generators need to know the whole content of
// the file (or even the project). The context menu is not an appropriate place
// for them.") — like on the Overleaf site, they live in the File menu and the
// backend reads the whole project (LLMChatController.generateDocument).
//
// User flow (owner decision 2026-08-21): clicking a menu item opens a modal
// with an EXPLICIT model selector + Generate button — the user chooses the
// backend/model (site or BYO) and starts the run, like the AI Assistant chat
// window. No implicit "just runs with whatever lane wins" behavior.
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import { OLModal } from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'

type GenerateKind = 'title' | 'abstract' | 'keywords'
type Phase = 'pick' | 'busy' | 'result' | 'error'

const KINDS: GenerateKind[] = ['title', 'abstract', 'keywords']

// Submenu item labels — short, Download-style ("AI Generate → Title/Abstract/Keywords").
const MENU_LABEL: Record<GenerateKind, string> = {
    title: 'Title',
    abstract: 'Abstract',
    keywords: 'Keywords',
}

// Modal headings — descriptive.
const KIND_LABEL: Record<GenerateKind, string> = {
    title: 'Generate title for this document',
    abstract: 'Generate an abstract for this document',
    keywords: 'Generate keywords for this document',
}

export default function LLMFileMenuCommands() {
    const { t } = useTranslation()
    const { isReady } = useWaitForI18n()
    const [kind, setKind] = useState<GenerateKind | null>(null)
    const [phase, setPhase] = useState<Phase>('pick')
    const [models, setModels] = useState<Array<{ value: string; label: string }>>([])
    const [modelListError, setModelListError] = useState(false)
    const [model, setModel] = useState('')
    const [output, setOutput] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    const open = useCallback(
        async (asKind: GenerateKind) => {
            setKind(asKind)
            setPhase('pick')
            setError(null)
            setOutput('')
            setCopied(false)
            setModel('')
            setModelListError(false)
            const projectId = getMeta('ol-project_id')
            if (!projectId) return
            try {
                const data: any = await getJSON(`/project/${projectId}/llm/models`)
                const options: Array<{ value: string; label: string }> = []
                for (const m of data?.models || []) {
                    options.push({ value: m.id, label: String(m.name || m.id) })
                }
                for (const row of data?.userRows || []) {
                    const rowName = row.name ? `${row.name} · ` : ''
                    for (const m of row.models || []) {
                        options.push({ value: m.id, label: `${rowName}${String(m.name || m.id)}` })
                    }
                }
                setModels(options)
                setModel(options[0]?.value || '')
            }
            catch {
                // Model list unavailable: keep an empty list; the request will
                // then use the deployment default lane (empty model ref).
                setModels([])
                setModel('')
                setModelListError(true)
            }
        },
        [],
    )

    const close = useCallback(() => {
        setKind(null)
        setPhase('pick')
        setError(null)
        setOutput('')
        setCopied(false)
    }, [])

    const run = useCallback(async () => {
        if (!kind) return
        const projectId = getMeta('ol-project_id')
        if (!projectId) return
        setPhase('busy')
        setError(null)
        setOutput('')
        try {
            const data = await postJSON(`/project/${projectId}/llm/generate`, {
                body: { type: kind, ...(model ? { model } : {}) },
            })
            const text = String(data?.output ?? data?.text ?? '')
            setOutput(text)
            if (text.trim()) {
                setPhase('result')
            }
            else {
                setPhase('error')
                setError(
                    t('llm_generate_empty', 'The model returned an empty result — pick another model or try again.'),
                )
            }
        }
        catch (err: any) {
            setPhase('error')
            setError(
                err?.data?.message ||
                err?.data?.details ||
                err?.message ||
                t('llm_generate_failed', 'Generation failed — the LLM service may be disabled.'),
            )
        }
    }, [kind, model, t])

    useCommandProvider(
        () =>
            isReady
                ? KINDS.map(k => ({
                      type: 'command' as const,
                      id: `llm_generate_${k}`,
                      label: t(`llm_file_generate_${k}`, MENU_LABEL[k]),
                      handler: () => {
                          void open(k)
                      },
                  }))
                : undefined,
        [isReady, open, t],
    )

    const copy = async () => {
        if (!output) return
        try {
            await navigator.clipboard.writeText(output)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
        catch { /* clipboard unavailable (non-secure context) — the text stays selectable */ }
    }

    // The Generate button is available on the pick view and on the error view
    // (retry with the same or a different model).
    const showPicker = phase === 'pick' || phase === 'busy' || phase === 'error'

    return (
        <OLModal show={kind !== null} onHide={close} size="lg" aria-label={t('llm_generate_title', 'Generate with AI')}>
            <div className="modal-header">
                <h5 className="modal-title">
                    {kind ? t(`llm_generate_${kind}_h`, KIND_LABEL[kind]) : ''}
                </h5>
                <button type="button" className="btn-close" onClick={close} aria-label={t('close', 'Close')} />
            </div>
            <div className="modal-body">
                {phase === 'busy' ? (
                    <p>{t('llm_generate_working', 'Working on it — the model first reads the whole document…')}</p>
                ) : phase === 'result' ? (
                    <div>
                        <p className="muted">{t('llm_generate_hint', 'From the full content of this project:')}</p>
                        <textarea
                            className="form-control"
                            rows={10}
                            readOnly
                            value={output}
                            aria-label={t('llm_generate_result', 'Generated text')}
                        />
                    </div>
                ) : (
                    <div>
                        <div className="mb-2">
                            <label className="form-label" htmlFor={`llm-generate-model-${kind}`}>
                                {t('llm_model_label', 'Model')}
                            </label>
                            <select
                                id={`llm-generate-model-${kind}`}
                                className="form-select"
                                value={model}
                                onChange={e => setModel(e.target.value)}
                                disabled={models.length === 0}
                            >
                                {models.map(m => (
                                    <option key={m.value} value={m.value}>
                                        {m.label}
                                    </option>
                                ))}
                            </select>
                            {modelListError && (
                                <div className="form-text">
                                    {t(
                                        'llm_generate_models_error',
                                        'No models could be listed — the deployment default will be used.',
                                    )}
                                </div>
                            )}
                        </div>
                        {phase === 'error' && error && <p className="text-danger mb-0">{error}</p>}
                    </div>
                )}
            </div>
            <div className="modal-footer">
                <OLButton variant="tertiary" onClick={close}>
                    {t('close', 'Close')}
                </OLButton>
                {phase === 'result' && (
                    <>
                        <OLButton variant="tertiary" onClick={() => void open(kind || 'title')}>
                            {t('llm_generate_again', 'Generate with another model')}
                        </OLButton>
                        <OLButton variant="secondary" disabled={!output} onClick={() => void copy()}>
                            {copied ? t('llm_copied', 'Copied') : t('copy', 'Copy')}
                        </OLButton>
                    </>
                )}
                {showPicker && (
                    <OLButton variant="secondary" disabled={phase === 'busy'} onClick={() => void run()}>
                        {phase === 'busy'
                            ? t('llm_generate_running', 'Generating…')
                            : t('llm_generate_run', 'Generate')}
                    </OLButton>
                )}
            </div>
        </OLModal>
    )
}
