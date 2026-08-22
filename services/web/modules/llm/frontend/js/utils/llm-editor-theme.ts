// overleaf-lab: owner request (2026-08-25) — the CHAT AI window (and other
// AI surfaces in the IDE) must follow the EDITOR theme ("The code editor
// color scheme", IDE → Appearance → Editor theme), not a fixed palette.
//
// Mechanism (no timers, event-driven only):
//   1. On demand + on theme/overall-theme changes, read the Live editor's
//      computed background/foreground (CodeMirror root or its scroller).
//   2. Write --wf-editor-bg / --wf-editor-fg on the scoped element
//      (.llm-wf-editor-scoped — rail panel, selection toolbar overlay).
//   3. llm-ui.scss maps the whole token layer onto those two values via
//      color-mix, so bubbles/borders/code surfaces derive from the editor
//      theme automatically.
//
// Fallback: if no editor node exists yet (lazy load) or it is transparent,
// the variables are simply not set and the fixed upstream palette applies.
export function readEditorThemeColors(): { bg?: string; fg?: string } {
    const editor = document.querySelector<HTMLElement>('.cm-editor')
    if (!editor) return {}
    const cs = getComputedStyle(editor)
    let bg = cs.backgroundColor
    let fg = cs.color
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') {
        const scroller = editor.querySelector<HTMLElement>('.cm-scroller')
        if (scroller) {
            const scs = getComputedStyle(scroller)
            bg = bg || scs.backgroundColor
            fg = fg || scs.color
        }
    }
    const out: { bg?: string; fg?: string } = {}
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') out.bg = bg
    if (fg) out.fg = fg
    return out
}

export function applyEditorThemeVars(scope: HTMLElement | null): void {
    if (!scope) return
    const { bg, fg } = readEditorThemeColors()
    if (bg) scope.style.setProperty('--wf-editor-bg', bg)
    if (fg) scope.style.setProperty('--wf-editor-fg', fg)
}

export interface EditorThemeWatcher {
    stop: () => void
}

// Watches overall <html data-bs-theme> flips and the editor element's
// class/attribute/style changes (theme application), then re-reads colors.
export function watchEditorTheme(scopes: Array<HTMLElement | null>): EditorThemeWatcher {
    const update = () => {
        scopes.forEach(applyEditorThemeVars)
    }

    update()

    const docObs = new MutationObserver(() => {
        // Slight delay: theme CSS may apply after the attribute mutation.
        window.setTimeout(update, 0)
    })
    if (document.documentElement) {
        docObs.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-bs-theme', 'class'],
        })
    }

    let editorObs: MutationObserver | undefined
    let mountObs: MutationObserver | undefined
    const attachEditorObserver = () => {
        const editor = document.querySelector<HTMLElement>('.cm-editor')
        if (!editor) return false
        if (editorObs) editorObs.disconnect()
        editorObs = new MutationObserver(update)
        editorObs.observe(editor, {
            attributes: true,
            attributeFilter: ['class', 'style', 'data-theme', 'aria-theme'],
        })
        applyEditorThemeVars(editor) // the editor itself is a good scope
        return true
    }
    if (!attachEditorObserver()) {
        // Editor may mount late (IDE lazy-loads the file pane).
        mountObs = new MutationObserver(() => {
            if (attachEditorObserver() && mountObs) mountObs.disconnect()
        })
        mountObs.observe(document.body, { childList: true, subtree: true })
        // Safety: stop the mount observer if the editor never appears, so it
        // can never outlive the pane.
        window.setTimeout(() => mountObs?.disconnect(), 15000)
    }

    return {
        stop() {
            docObs.disconnect()
            editorObs?.disconnect()
            mountObs?.disconnect()
        },
    }
}
