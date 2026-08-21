// overleaf-lab: the "Generate with AI" section for the core editor menu
// (reviewer #13: "Title/Abstract generators need to know the whole content of
// the file (or even the project). The context menu is not an appropriate place
// for them.") — they need the WHOLE document, so they live in a dedicated
// section of the core menu (next to the File-menu items), not in the editor
// context menu.
//
// Shape MUST match the core's `MenuSectionStructure`
// (frontend/js/.../toolbar/command-dropdown.ts): { id, title?, children }.
// `children` is required — the core reads `section.children.length`, so
// `label`/`items`-style keys crash the IDE (React #130).
import type { MenuSectionStructure } from '@/features/ide-react/components/toolbar/command-dropdown'

const section: MenuSectionStructure = {
    id: 'llm-generate',
    title: 'Generate with AI',
    children: [
        'llm_generate_title',
        'llm_generate_abstract',
        'llm_generate_keywords',
    ],
}

export default [section]
