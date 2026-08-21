// overleaf-lab: File-menu commands for the whole-document LLM generators
// (reviewer #13: "Title/Abstract generators need to know the whole content of
// the file (or even the project). The context menu is not an appropriate place
// for them.") — like on the Overleaf site, they live in the File menu and the
// backend reads the whole project (LLMChatController.generateDocument).
//
// Also registered so non-LLM deployments degrade gracefully: if the endpoint
// is disabled the modal shows the admin's message instead of crashing.
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { postJSON } from '@/infrastructure/fetch-json'
import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import { OLModal } from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'

type GenerateKind = 'title' | 'abstract' | 'keywords'

const KINDS: GenerateKind[] = ['title', 'abstract', 'keywords']

// Menu labels — short, File-menu style (reviewer #13: "on the Overleaf site").
const MENU_LABEL: Record<GenerateKind, string> = {
    title: 'Generate title',
    abstract: 'Generate abstract',
    keywords: 'Generate keywords',
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
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [output, setOutput] = useState('')
    const [copied, setCopied] = useState(false)

    const close = useCallback(() => {
        setKind(null)
        setError(null)
        setOutput('')
        setCopied(false)
    }, [])

    const run = useCallback(
        async (asKind: GenerateKind) => {
            const projectId = getMeta('ol-project_id')
            if (!projectId) return
            setKind(asKind)
            setError(null)
            setOutput('')
            setCopied(false)
            setBusy(true)
            try {
                const data = await postJSON(`/project/${projectId}/llm/generate`, {
                    body: { type: asKind },
                })
                setOutput(String(data?.output ?? data?.text ?? ''))
                if (!String(data?.output ?? data?.text ?? '').trim()) {
                    setError(t('llm_generate_empty', 'The model returned an empty result — try again.'))
                }
            }
            catch (err: any) {
                setError(
                    err?.data?.message ||
                    err?.data?.details ||
                    err?.message ||
                    t('llm_generate_failed', 'Generation failed — the LLM service may be disabled.'),
                )
            }
            finally {
                setBusy(false)
            }
        },
        [t],
    )

    useCommandProvider(
        () =>
            isReady
                ? KINDS.map(k => ({
                      type: 'command' as const,
                      id: `llm_generate_${k}`,
                      label: t(`llm_file_generate_${k}`, MENU_LABEL[k]),
                      handler: () => run(k),
                  }))
                : undefined,
        [isReady, run, t],
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

    return (
        <OLModal show={kind !== null} onHide={close} size="lg" aria-label={t('llm_generate_title', 'Generate with AI')}>
            <div className="modal-header">
                <h5 className="modal-title">
                    {kind ? t(`llm_generate_${kind}_h`, KIND_LABEL[kind]) : ''}
                </h5>
                <button type="button" className="btn-close" onClick={close} aria-label={t('close', 'Close')} />
            </div>
            <div className="modal-body">
                {busy ? (
                    <p>{t('llm_generate_working', 'Working on it — the model first reads the whole document…')}</p>
                ) : error ? (
                    <p className="text-danger">{error}</p>
                ) : (
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
                )}
            </div>
            <div className="modal-footer">
                <OLButton variant="tertiary" onClick={close}>
                    {t('close', 'Close')}
                </OLButton>
                <OLButton variant="secondary" disabled={busy || !output} onClick={copy}>
                    {copied ? t('llm_copied', 'Copied') : t('copy', 'Copy')}
                </OLButton>
            </div>
        </OLModal>
    )
}
