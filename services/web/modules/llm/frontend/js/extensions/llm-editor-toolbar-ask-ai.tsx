import React from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'

/**
 * overleaf-lab (reference-synced 2026-08): the "Ask AI" button of the editor
 * toolbar — smart_toy, same aria label as the reference product. Clicking it
 * opens the LLM context menu (input + context-sensitive actions) anchored in
 * the IDE, like the reference's editor-toolbar AI entry point.
 *
 * Rendered by the core editor toolbar via the module slot
 * `sourceEditorToolbarStartButtons`, so it lives inside the CodeMirror
 * provider tree (the view can be read from the context).
 */
const LLMEditorToolbarAskAi = React.memo(function LLMEditorToolbarAskAi() {
    const view = useCodeMirrorViewContext()

    const onClick = () => {
        document.dispatchEvent(
            new CustomEvent('ol-llm-open-ask-ai', { detail: { view } }),
        )
    }

    return (
        <div className="writefull" data-overflow="main-toolbar-ai-context-menu">
            <button
                type="button"
                className="ol-cm-toolbar-button llm-cm-toolbar-ask-ai"
                aria-label="Get AI assistance for your LaTeX writing and more"
                title="Get AI assistance for your LaTeX writing and more"
                onClick={onClick}
            >
                <span className="material-symbols" aria-hidden="true" translate="no">
                    smart_toy
                </span>
            </button>
        </div>
    )
})

export default LLMEditorToolbarAskAi
