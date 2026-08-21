// overleaf-lab: File-menu section structure for the LLM document generators
// (reviewer #13). The actual commands are registered by the companion
// `llm-file-menu-commands` component (menubarExtraComponents); this file only
// declares WHERE in the File menu the entries appear. Sections whose commands
// are not registered are automatically filtered out by the core menu renderer,
// so non-LLM deployments never see these items.
import type { MenuSectionStructure } from '@/features/ide-react/components/toolbar/command-dropdown'

const sections: MenuSectionStructure[] = [
    {
        id: 'llm-ai-generate',
        children: ['llm_generate_title', 'llm_generate_abstract', 'llm_generate_keywords'],
    },
]

export default sections
