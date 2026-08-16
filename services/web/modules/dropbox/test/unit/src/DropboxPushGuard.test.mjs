import { describe, expect, it, vi } from 'vitest'

// DropboxRouter imports a lot of app-level machinery; none of it is exercised
// by the pure helpers under test here, so stub the heavy modules to keep the
// import graph light and deterministic.
vi.mock('../../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs', () => ({
  default: {
    ensureUserCanWriteProjectContent: () => (req, res, next) => next(),
  },
}))
vi.mock('../../../../../app/src/Features/Authentication/AuthenticationController.mjs', () => ({
  default: { requireLogin: () => (req, res, next) => next() },
}))
vi.mock('../../../../../app/src/Features/Project/ProjectGetter.mjs', () => ({
  default: { promises: { getProject: async () => null } },
}))
vi.mock('../../../../../app/src/Features/Project/ProjectEntityHandler.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/Editor/EditorController.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/History/HistoryManager.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../app/models/dropboxUserCredentials.mjs', () => ({
  DropboxUserCredentials: {},
}))
vi.mock('../../../app/models/dropboxSyncProjectStates.mjs', () => ({
  DropboxSyncProjectStates: {},
}))
vi.mock('@overleaf/settings', () => ({ default: {} }))

const { joinDisplayPath, planRemoteDeletions } = await import(
  '../../../app/src/DropboxRouter.mjs'
)

describe('planRemoteDeletions (BUG2: guarded remote deletion)', () => {
  const storedEntries = [
    { path: '/main.tex', rev: '01658c9439774350000000373b78f03' },
    { path: '/sample.bib', rev: '01658c9439774350000000373b78f04' },
    { path: '/Bla/Screenshot_2026-08-04.png', rev: '01658c943b131170000000373b78f05' },
    // legacy entry without a rev baseline — must never be blindly deleted
    { path: '/legacy.txt' },
  ]

  it('(a) remote unchanged since last sync -> deletion proceeds', () => {
    const localFilePaths = new Set() // everything previously stored was deleted locally
    // current remote listing (PROJECT-relative, slash keys as produced by
    // getDropboxRemoteFiles) — same revs as the stored baseline:
    const currentRemoteMap = {
      'main.tex': { rev: '01658c9439774350000000373b78f03' },
      'sample.bib': { rev: '01658c9439774350000000373b78f04' },
      'Bla/Screenshot_2026-08-04.png': { rev: '01658c943b131170000000373b78f05' },
      'legacy.txt': { rev: '01658c94deadbeef000000000000001' },
    }
    const plan = planRemoteDeletions(storedEntries, localFilePaths, currentRemoteMap)
    expect(plan.deletions.map(d => d.path).sort()).toEqual([
      'Bla/Screenshot_2026-08-04.png',
      'main.tex',
      'sample.bib',
    ])
    // the only skip must be the entry WITHOUT a stored baseline (no rev to
    // compare against) — never a healthy unchanged file:
    expect(plan.skipped.map(s => s.path)).toEqual(['legacy.txt'])
  })

  it('(b) remote modified since last sync -> deletion skipped + conflict data recorded', () => {
    const localFilePaths = new Set()
    // user confirms on Dropbox: main.tex changed (new rev); rest unchanged
    const currentRemoteMap = {
      'main.tex': { rev: '01659c949999999990000000000000000' }, // CHANGED
      'sample.bib': { rev: '01658c9439774350000000373b78f04' },
    }
    const plan = planRemoteDeletions(storedEntries, localFilePaths, currentRemoteMap)
    // changed + vanished-from-listing + no-baseline are all skipped;
    // unchanged still proceeds:
    expect(plan.skipped.map(s => s.path).sort()).toEqual([
      'Bla/Screenshot_2026-08-04.png', // vanished from listing -> not "unchanged"
      'legacy.txt',
      'main.tex',
    ])
    expect(plan.deletions.map(d => d.path)).toEqual(['sample.bib'])
    // the conflict entry for the changed file carries the CURRENT remote rev
    // (so keep-local resolution can unblock the deletion on the next push):
    const main = plan.skipped.find(s => s.path === 'main.tex')
    expect(main.remoteRev).toBe('01659c949999999990000000000000000')
  })

  it('files that still exist locally are never planned for deletion', () => {
    const currentRemoteMap = { 'main.tex': { rev: '01658c9439774350000000373b78f03' } }
    const localFilePaths = new Set(['main.tex'])
    const plan = planRemoteDeletions(storedEntries, localFilePaths, currentRemoteMap)
    expect(plan.deletions.map(d => d.path)).not.toContain('main.tex')
    expect(plan.skipped.map(s => s.path)).not.toContain('main.tex')
    // the other stored files are missing locally but ABSENT from the current
    // listing (or have no baseline) — safe direction: skipped, not deleted:
    expect(plan.deletions).toHaveLength(0)
    expect(plan.skipped.map(s => s.path).sort()).toEqual([
      'Bla/Screenshot_2026-08-04.png',
      'legacy.txt',
      'sample.bib',
    ])
  })

  it('reproduces the live incident map shape (all files skipped) only when the listing is really wrong', () => {
    // THE LIVE BUG: listing taken against the ROOT directory shifts every key
    // by the project name. With the fixed planner that input must still
    // skip everything (safe direction) — the route fix is to snapshot the
    // project folder so this case no longer occurs:
    const rootLevelMap = {
      'A5 test/main.tex': { rev: '01658c9439774350000000373b78f03' },
      'A5 test/sample.bib': { rev: '01658c9439774350000000373b78f04' },
    }
    const plan = planRemoteDeletions(storedEntries, new Set(), rootLevelMap)
    expect(plan.deletions).toHaveLength(0)
    expect(plan.skipped.map(s => s.path).sort()).toEqual([
      'Bla/Screenshot_2026-08-04.png',
      'legacy.txt',
      'main.tex',
      'sample.bib',
    ])
  })
})

describe('joinDisplayPath (BUG1: full Dropbox path for the modal)', () => {
  it('combines the owner root with the project state path (user incident case)', () => {
    expect(joinDisplayPath('Apps/Overleaf Dev', '/A5 test')).toBe(
      'Apps/Overleaf Dev/A5 test'
    )
  })

  it('decodes percent-encoded roots and state paths', () => {
    expect(joinDisplayPath('Apps/Overleaf%20Dev', '/A5%20test')).toBe(
      'Apps/Overleaf Dev/A5 test'
    )
  })

  it('falls back to the state path alone for a plain sandbox root', () => {
    expect(joinDisplayPath('/', '/A5 test')).toBe('A5 test')
    expect(joinDisplayPath(undefined, '/A5 test')).toBe('A5 test')
    expect(joinDisplayPath(null, '/A5 test')).toBe('A5 test')
  })

  it('handles empty state paths without crashing', () => {
    expect(joinDisplayPath('Apps/Overleaf Dev', '')).toBe('')
    expect(joinDisplayPath('Apps/Overleaf Dev', '/')).toBe('')
  })
})
