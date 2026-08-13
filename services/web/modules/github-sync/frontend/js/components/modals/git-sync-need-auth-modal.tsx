import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'

const serverTypes = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'gitea', label: 'Gitea' },
  { value: 'forgejo', label: 'Forgejo' }
]

const GitSyncNeedAuthModal = ({ handleHide, serverType, setServerType }: { 
  handleHide: () => void 
  serverType?: string
  setServerType?: (type: string) => void
}) => {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')
  
  return (
    <>
      <OLModalBody>
        {setServerType && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('select_git_server_type')}</label>
            <select
              value={serverType || 'github'}
              onChange={(e) => setServerType(e.target.value)}
              style={{ width: '100%', padding: '8px', fontSize: '1rem' }}
            >
              {serverTypes.map(opt => (
                <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
              ))}
            </select>
          </div>
        )}
        <p>{t('link_to_github_description', { appName })}</p>
      </OLModalBody>
      <OLModalFooter>
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>

        <OLButton
          variant="primary"
          onClick={() => {
            handleHide()
            window.open(
              '/user/github-sync/oauth2',
              'githubAuth',
              'width=600,height=700'
            )
          }}
        >
          {t('link_to_github')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncNeedAuthModal
