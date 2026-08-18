import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const handlerPath = path.join(
  import.meta.dirname,
  '../../../app/src/NotificationsPreferencesHandler.mjs'
)

// A minimal ObjectId stand-in: only .toString() identity is exercised,
// so we can key on the string form of the id.
class FakeObjectId {
  constructor(value) {
    this.value = String(value)
  }
  toString() {
    return this.value
  }
}

describe('NotificationsPreferencesHandler', function () {
  beforeEach(async function (ctx) {
    ctx.notificationsPreferences = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({}),
    }

    ctx.getProject = vi.fn()

    vi.doMock(
      path.join(
        import.meta.dirname,
        '../../../../../app/src/infrastructure/mongodb.mjs'
      ),
      () => ({
        db: { notificationsPreferences: ctx.notificationsPreferences },
        ObjectId: FakeObjectId,
        connectionPromise: Promise.resolve(),
      })
    )

    vi.doMock(
      path.join(
        import.meta.dirname,
        '../../../../../app/src/Features/Project/ProjectGetter.mjs'
      ),
      async () => {
        const mod = { promises: { getProject: ctx.getProject } }
        return { default: mod }
      }
    )

    const Errors = (
      await import(
        path.join(
          import.meta.dirname,
          '../../../../../app/src/Features/Errors/Errors.js'
        )
      )
    ).default

    ctx.NotFoundError = Errors.NotFoundError
    ctx.ForbiddenError = Errors.ForbiddenError

    ctx.Handler = (await import(handlerPath)).default
  })

  function makeProject(role, userId) {
    return {
      owner_ref: role === 'owner' ? userId : 'owner-1',
      collaberator_refs:
        role === 'collaborator' ? [userId] : [],
      readOnly_refs: [],
      tokenAccessReadAndWrite_refs: [],
      tokenAccessReadOnly_refs: [],
    }
  }

  it('returns defaults (all true) when no project preference exists', async function (ctx) {
    ctx.getProject.mockResolvedValue(makeProject('owner', 'user-1'))

    const prefs = await ctx.Handler.promises.getProjectPreferences('user-1', 'p-1')

    expect(Object.keys(prefs)).toHaveLength(12)
    expect(Object.values(prefs).every(Boolean)).toBe(true)
  })

  it('forwards stored preferences and normalizes missing keys to true', async function (ctx) {
    ctx.getProject.mockResolvedValue(makeProject('collaborator', 'user-1'))
    ctx.notificationsPreferences.findOne.mockResolvedValueOnce({
      commentOnOwnProject: false,
    })

    const prefs = await ctx.Handler.promises.getProjectPreferences('user-1', 'p-1')

    expect(prefs.commentOnOwnProject).toBe(false)
    expect(prefs.trackedChangesOnOwnProject).toBe(true)
  })

  it('throws not-found when project does not exist', async function (ctx) {
    ctx.getProject.mockResolvedValue(null)

    let error = null
    try {
      await ctx.Handler.promises.getProjectPreferences('user-1', 'p-1')
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(ctx.NotFoundError)
    expect(error.message).toMatch('not found')
  })

  it('throws forbidden when user has no access to the project', async function (ctx) {
    ctx.getProject.mockResolvedValue(makeProject('other', 'other-user'))

    let error = null
    try {
      await ctx.Handler.promises.saveProjectPreferences(
        'user-1',
        'p-1',
        { commentOnOwnProject: false }
      )
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(ctx.ForbiddenError)
    expect(error.message).toMatch('not allowed to access')
  })

  it('saves normalized project preferences with upsert', async function (ctx) {
    ctx.getProject.mockResolvedValue(makeProject('owner', 'user-1'))

    const normalized = await ctx.Handler.promises.saveProjectPreferences(
      'user-1',
      'p-1',
      { commentOnOwnProject: false }
    )

    expect(normalized.commentOnOwnProject).toBe(false)
    expect(Object.keys(normalized)).toHaveLength(12)
    expect(ctx.notificationsPreferences.updateOne).toHaveBeenCalledWith(
      { user_id: expect.any(FakeObjectId), project_id: expect.any(FakeObjectId) },
      { $set: normalized },
      { upsert: true }
    )
  })

  it('reads and writes global preferences with project_id: null', async function (ctx) {
    const global = await ctx.Handler.promises.saveGlobalPreferences('user-1', {
      muteAllNotifications: true,
    })
    expect(global).toEqual({ muteAllNotifications: true })
    expect(ctx.notificationsPreferences.updateOne).toHaveBeenCalledWith(
      { user_id: expect.any(FakeObjectId), project_id: null },
      { $set: { muteAllNotifications: true } },
      { upsert: true }
    )
  })
})
