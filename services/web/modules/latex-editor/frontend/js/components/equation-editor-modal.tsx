import {
  ChangeEventHandler,
  FC,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLFormSwitch from '@/shared/components/ol/ol-form-switch'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { latexCommands } from '../data/latex-commands.mjs'
import { searchCommands } from '../utils/command-search.mjs'
import { EXPORT_WRAPPERS, wrapLatex } from '../utils/equation-export.mjs'
import { MathLiveInput } from './mathlive-input'

type Props = {
  initialLatex?: string
  onClose: () => void
}

const WRAPPER_KEYS: Record<string, string> = {
  plain: 'equation_editor_wrap_plain',
  equation: 'equation_editor_wrap_equation',
  eqnarray: 'equation_editor_wrap_eqnarray',
  inline: 'equation_editor_wrap_inline',
  display: 'equation_editor_wrap_display',
}

/**
 * Equation Editor: visual LaTeX equation composer (MathLive) with command
 * search, import-from-selection, and export to the document cursor.
 */
export const EquationEditorModal: FC<Props> = ({ initialLatex, onClose }) => {
  const { t } = useTranslation()
  const view = useCodeMirrorViewContext()

  const [latex, setLatex] = useState(initialLatex ?? '')
  const [showRawLatex, setShowRawLatex] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [exportWrapper, setExportWrapper] = useState('plain')
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const mathfieldRef = useRef<any>(null)

  const searchResults = useMemo(
    () => searchCommands(latexCommands, searchQuery),
    [searchQuery]
  )
  const searchOpen = searchQuery.trim().length > 0

  const insertIntoMathfield = useCallback((text: string) => {
    if (mathfieldRef.current?.executeCommand) {
      mathfieldRef.current.executeCommand(['insert', text])
      mathfieldRef.current.focus()
    } else {
      setLatex(prev => prev + text)
    }
  }, [])

  const insertAtCursor = useCallback(
    (text: string) => {
      const { from, to } = view.state.selection.main
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      })
      view.focus()
    },
    [view]
  )

  const handleInsertCommand = useCallback(
    (entry: { cmd?: string; insert?: string }) => {
      insertIntoMathfield(entry.insert ?? entry.cmd ?? '')
      setSearchQuery('')
    },
    [insertIntoMathfield]
  )

  const handleExport = useCallback(() => {
    insertAtCursor(wrapLatex(latex, exportWrapper))
    onClose()
  }, [exportWrapper, insertAtCursor, latex, onClose])

  const handleImport = useCallback(() => {
    const { from, to } = view.state.selection.main
    const selected = view.state.sliceDoc(from, to)
    if (selected) {
      setLatex(selected)
      mathfieldRef.current?.setValue(selected)
    }
  }, [view])

  const handleClear = useCallback(() => {
    setLatex('')
    if (mathfieldRef.current) {
      mathfieldRef.current.setValue('')
      mathfieldRef.current.focus()
    }
  }, [])

  const handleSearchKeydown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && searchResults.length > 0) {
        event.preventDefault()
        handleInsertCommand(searchResults[0])
      }
    },
    [handleInsertCommand, searchResults]
  )

  const handleWrapperChange: ChangeEventHandler<HTMLSelectElement> = useCallback(
    event => setExportWrapper(event.target.value),
    []
  )

  return (
    <OLModal show size="lg" onHide={onClose}>
      <OLModalHeader>
        <OLModalTitle>{t('equation_editor')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody className="equation-editor-body">
        {showRawLatex ? (
          <textarea
            className="form-control equation-editor-raw-textarea"
            value={latex}
            onChange={event => setLatex(event.target.value)}
            placeholder={t('equation_editor_raw_latex_placeholder')}
            aria-label={t('equation_editor_raw_latex_label')}
            rows={4}
          />
        ) : (
          <MathLiveInput
            value={latex}
            onChange={setLatex}
            mathfieldRef={mathfieldRef}
            keyboardVisible={keyboardVisible}
          />
        )}

        <div className="equation-editor-toolbar-row">
          <div className="equation-editor-search">
            <input
              type="search"
              className="form-control equation-editor-search-input"
              placeholder={t('equation_editor_search_placeholder')}
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchKeydown}
              aria-label={t('equation_editor_search_placeholder')}
            />
            {searchOpen &&
              (searchResults.length > 0 ? (
                <ul className="equation-editor-search-results">
                  {searchResults.map(result => (
                    <li key={result.cmd}>
                      <button
                        type="button"
                        className="equation-editor-search-result"
                        onClick={() => handleInsertCommand(result)}
                      >
                        <code>{result.cmd}</code>
                        <span>{result.desc}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="equation-editor-search-results">
                  <div className="equation-editor-search-no-results">
                    {t('equation_editor_no_results')}
                  </div>
                </div>
              ))}
          </div>
          <div className="form-check form-switch equation-editor-raw-switch">
            <OLFormSwitch
              id="equation-editor-show-raw-latex"
              checked={showRawLatex}
              onChange={event => setShowRawLatex(event.target.checked)}
            />
            <label
              className="form-check-label"
              htmlFor="equation-editor-show-raw-latex"
            >
              {t('equation_editor_show_raw_latex')}
            </label>
          </div>
        </div>
      </OLModalBody>

      <OLModalFooter className="equation-editor-footer">
        <div className="equation-editor-footer-actions">
          <OLButton variant="secondary" onClick={handleImport}>
            {t('equation_editor_import_selection')}
          </OLButton>
          <OLButton variant="ghost" onClick={handleClear}>
            {t('equation_editor_clear')}
          </OLButton>
          <OLButton
            variant={keyboardVisible ? 'secondary' : 'ghost'}
            onClick={() => setKeyboardVisible(v => !v)}
            aria-label={
              keyboardVisible
                ? t('equation_editor_hide_keyboard')
                : t('equation_editor_show_keyboard')
            }
            aria-pressed={keyboardVisible}
          >
            ⌨
          </OLButton>
          <OLFormSelect
            aria-label={t('equation_editor_export_wrapper')}
            title={t('equation_editor_export_wrapper')}
            value={exportWrapper}
            onChange={handleWrapperChange}
          >
            {EXPORT_WRAPPERS.map(wrapper => (
              <option key={wrapper} value={wrapper}>
                {t(WRAPPER_KEYS[wrapper])}
              </option>
            ))}
          </OLFormSelect>
        </div>
        <OLButton variant="primary" onClick={handleExport}>
          {t('equation_editor_export_to_cursor')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

export default EquationEditorModal
