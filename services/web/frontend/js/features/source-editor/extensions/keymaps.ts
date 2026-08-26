import { keymap } from '@codemirror/view'
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { lintKeymap } from '@codemirror/lint'
import { scrollOneLineKeymap } from './scroll-one-line'
import { foldingKeymap } from './folding-keymap'
import { isMobileDevice } from '../utils/isMobileDevice'

const ignoredDefaultKeybindings = new Set([
  // NOTE: disable "Mod-Enter" as it's used for "Compile"
  'Mod-Enter',
  // Disable Alt+Arrow as we have special behaviour on Windows / Linux
  'Alt-ArrowLeft',
  'Alt-ArrowRight',
  // This keybinding causes issues on some keyboard layouts where \ is entered
  // using AltGr. Windows treats Ctrl-Alt as AltGr, so trying to insert a \
  // with Ctrl-Alt would trigger this keybinding, rather than inserting a \
  'Mod-Alt-\\',
])

const ignoredDefaultMacKeybindings = new Set([
  // We replace these with our custom visual-line versions
  'Mod-Backspace',
  'Mod-Delete',
  // Disable toggleTabFocusMode as it conflicts with ” on a Swedish keyboard layout
  'Shift-Alt-m',
])

function isKeyBindingDisabled(item: { key?: string; mac?: string }): boolean {
  if (item.key && ignoredDefaultKeybindings.has(item.key)) {
    return true
  }
  if (item.mac && ignoredDefaultMacKeybindings.has(item.mac)) {
    return true
  }
  return false
}

function isMobileKeyBindingDisabled(item: { key?: string; mac?: string }): boolean {
  if (isKeyBindingDisabled(item)) {
    return true
  }
  // Mobile: drop Alt-family bindings (AltGr conflicts on on-screen keyboards)
  if (
    item.key &&
    (item.key.startsWith('Alt-') || item.key.includes('Alt-'))
  ) {
    return true
  }
  return false
}

const desktopFilteredDefaultKeymap = defaultKeymap.filter(
  item => !isKeyBindingDisabled(item)
)

const mobileFilteredDefaultKeymap = defaultKeymap.filter(
  item => !isMobileKeyBindingDisabled(item)
)

export const keymaps = keymap.of([
  // The default CodeMirror keymap, with a few key bindings filtered out.
  ...desktopFilteredDefaultKeymap,
  // Key bindings for undo/redo/undoSelection/redoSelection
  ...historyKeymap,
  // Key bindings for “open lint panel” and “next diagnostic”
  ...lintKeymap,
  // Key bindings for folding actions
  ...foldingKeymap,
  // Key bindings for scrolling the viewport
  ...scrollOneLineKeymap,
])

/**
 * Keymaps for touch/mobile input devices (see MOBILE_PLAN.md, Phase 3).
 * On mobile we additionally drop Alt-family bindings because on-screen
 * keyboards trigger AltGr for them rather than the intended modifier.
 */
export const mobileKeymaps = keymap.of([
  ...mobileFilteredDefaultKeymap,
  ...historyKeymap,
  ...lintKeymap,
  ...foldingKeymap,
  ...scrollOneLineKeymap,
])

// Exported for the extension bundle (see 'extensions/index.ts'). The bundle
// picks the touch-tuned keymap when the device is a touch input.
export function currentKeymaps() {
  return isMobileDevice() ? mobileKeymaps : keymaps
}
