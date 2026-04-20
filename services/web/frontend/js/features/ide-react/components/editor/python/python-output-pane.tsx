import { useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLButtonToolbar from '@/shared/components/ol/ol-button-toolbar'
import MaterialIcon from '@/shared/components/material-icon'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { usePythonExecutionContext } from '@/features/ide-react/context/python-execution-context'
import { DEFAULT_STATE } from './python-runner'

const emptySubscribe = () => () => {}
const getDefaultState = () => DEFAULT_STATE

export default function PythonOutputPane() {
  const { t } = useTranslation()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { getPythonRunner } = usePythonExecutionContext()
  const pythonRunner = useMemo(
    () => (currentDocumentId ? getPythonRunner(currentDocumentId) : null),
    [currentDocumentId, getPythonRunner]
  )

  const { output, error, status } = useSyncExternalStore(
    pythonRunner ? pythonRunner.subscribe : emptySubscribe,
    pythonRunner ? pythonRunner.getState : getDefaultState
  )

  if (!pythonRunner) {
    return null
  }

  return (
    <div className="ide-redesign-python-output-pane">
      <OLButtonToolbar className="toolbar toolbar-pdf toolbar-pdf-hybrid">
        <div className="toolbar-pdf-left">
          <div className="compile-button-group">
            <OLButton
              onClick={() => {
                if (status === 'running') {
                  pythonRunner.interrupt()
                } else {
                  pythonRunner.run()
                }
              }}
              variant={status === 'running' ? 'danger' : 'primary'}
              className="compile-button align-items-center py-0 px-3"
              disabled={status === 'loading'}
              aria-label={
                status === 'running'
                  ? t('stop_python_execution')
                  : t('run_python_code')
              }
            >
              {status === 'running' ? t('stop') : t('run')}
              <MaterialIcon
                type={status === 'running' ? 'stop' : 'play_arrow'}
                className="ml-2"
              />
            </OLButton>
          </div>
        </div>
      </OLButtonToolbar>

      <div className="ide-redesign-python-output-pane-body">
        {status === 'loading' && (
          <div className="ide-redesign-python-output-pane-placeholder">
            {t('loading_python_runtime')}
          </div>
        )}
        {status !== 'loading' && !error && output.length === 0 && (
          <div className="ide-redesign-python-output-pane-placeholder">
            {t('run_current_script_to_see_output')}
          </div>
        )}
        {error && (
          <div className="ide-redesign-python-output-pane-error">{error}</div>
        )}
        {output.map((line, index) => (
          <div className="ide-redesign-python-output-pane-line" key={index}>
            {line}
          </div>
        ))}
      </div>
    </div>
  )
}
