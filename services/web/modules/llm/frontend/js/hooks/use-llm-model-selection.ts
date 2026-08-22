// overleaf-lab: shared LLM model selection (owner request): ONE model choice,
// made via the "Select LLM Model" menu item / modal, is used by ALL AI
// surfaces — Chat AI Assistant, Review, AI Generate (Title/Abstract/Keywords)
// and the ask-AI selection context menu.
//
// Storage stays per-project localStorage (utils/llm-selected-model.ts — the
// pre-existing bridge between the chat and the context menu); the surfaces
// subscribe to a window event so a change in one pane updates the others
// immediately (no reload).
import { useCallback, useEffect, useState } from 'react'
import getMeta from '@/utils/meta'
import { getJSON } from '@/infrastructure/fetch-json'
import { readSelectedModel, writeSelectedModel } from '../utils/llm-selected-model'

export const LLM_MODEL_CHANGED_EVENT = 'overleaf-llm-model-changed'

export interface LLMModelOption {
    value: string // '' = deployment default, else model id / `u:<rowId>:<model>`
    label: string
    rowName?: string
}

export function useLLMModelSelection() {
    const projectId = (getMeta('ol-project_id') as string | undefined) || undefined
    const [options, setOptions] = useState<LLMModelOption[]>([
        { value: '', label: 'Deployment default' },
    ])
    const [loaded, setLoaded] = useState(false)
    const [selected, setSelected] = useState<string>(() => readSelectedModel(projectId))

    useEffect(() => {
        if (!projectId) {
            setLoaded(true)
            return
        }
        let cancelled = false
        async function load() {
            try {
                // Shared with the chat hook's model list: site models first,
                // then BYO rows namespaced u:<rowId>:<model>.
                const data: any = await getJSON<{
                    models?: Array<{ id: string; name?: string; isDefault?: boolean }>
                    userRows?: Array<{ id: string; name: string; models: Array<{ id: string; name?: string }> }>
                }>(`/project/${projectId}/llm/models`)
                if (cancelled) return
                const opts: LLMModelOption[] = [{ value: '', label: 'Deployment default' }]
                for (const m of data.models || []) {
                    opts.push({ value: m.id, label: m.name || m.id })
                }
                for (const row of data.userRows || []) {
                    for (const m of row.models || []) {
                        opts.push({
                            value: `u:${row.id}:${m.id}`,
                            label: m.name || m.id,
                            rowName: row.name,
                        })
                    }
                }
                setOptions(opts)
                // A stored selection that no longer exists (row deleted, model
                // renamed) falls back to the deployment default so the label
                // never dangles.
                setSelected(prev => (prev && opts.some(o => o.value === prev)) ? prev : '')
                setLoaded(true)
            }
            catch {
                if (!cancelled) {
                    // Model list unavailable (LLM disabled for this project?):
                    // keep "Deployment default" as the only option.
                    setLoaded(true)
                }
            }
        }
        load()
        return () => {
            cancelled = true
        }
    }, [projectId])

    // Keep the selection in sync across surface instances.
    useEffect(() => {
        const handler = (e: Event) => {
            const value = (e as CustomEvent).detail?.value
            if (typeof value === 'string') setSelected(value)
        }
        window.addEventListener(LLM_MODEL_CHANGED_EVENT, handler)
        return () => window.removeEventListener(LLM_MODEL_CHANGED_EVENT, handler)
    }, [])

    const apply = useCallback(
        (value: string) => {
            writeSelectedModel(value, projectId)
            setSelected(value)
            window.dispatchEvent(
                new CustomEvent(LLM_MODEL_CHANGED_EVENT, { detail: { value } }),
            )
        },
        [projectId],
    )

    const selectedOption = options.find(o => o.value === selected)
    const selectedLabel = selectedOption
        ? selectedOption.rowName
            ? `${selectedOption.rowName} · ${selectedOption.label}`
            : selectedOption.label
        : selected
            ? selected
            : 'Deployment default'

    return {
        projectId,
        options,
        loaded,
        selected,
        selectedLabel,
        apply,
    }
}
