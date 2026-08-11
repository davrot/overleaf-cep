import { beforeEach, describe, expect, it, vi } from 'vitest'
import mongodb from 'mongodb-legacy'

const WebdavSyncProjectStates = vi.hoisted(() => {
  return {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
    deleteMany: vi.fn(),
  }
})

vi.mock('./../../../app/models/webdavSyncProjectStates.mjs', () => ({
  WebdavSyncProjectStates,
}))

const { default: SyncStateManager } = await import('./../../../app/src/SyncStateManager.mjs')

describe('SyncStateManager', function () {
  let projectId

  beforeEach(function () {
    vi.clearAllMocks()
    projectId = new mongodb.ObjectId().toString()
  })

  describe('getProjectState', function () {
    it('should get project state with default projection', async function () {
      const mockState = {
        _id: new mongodb.ObjectId(),
        projectId,
        lastSync: new Date(),
      }
      WebdavSyncProjectStates.findOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockState),
      })

      const result = await SyncStateManager.getProjectState(projectId)

      expect(WebdavSyncProjectStates.findOne).toHaveBeenCalledWith(
        { projectId },
        {}
      )
      expect(result).to.deep.equal(mockState)
    })

    it('should return null for non-existent project', async function () {
      WebdavSyncProjectStates.findOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      })

      const result = await SyncStateManager.getProjectState(projectId)

      expect(result).to.be.null
    })

    it('should apply projection if provided', async function () {
      const mockState = {
        _id: new mongodb.ObjectId(),
        projectId,
        lastSync: new Date(),
      }
      WebdavSyncProjectStates.findOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockState),
      })

      await SyncStateManager.getProjectState(projectId, { lastSync: 1 })

      expect(WebdavSyncProjectStates.findOne).toHaveBeenCalledWith(
        { projectId },
        { lastSync: 1 }
      )
    })
  })

  describe('createProjectState', function () {
    it('should create a new project state', async function () {
      const mockState = {
        _id: new mongodb.ObjectId(),
        projectId,
        lastSync: null,
        folderId: null,
      }
      WebdavSyncProjectStates.findOneAndUpdate.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockState),
      })

      const data = { lastSync: null, folderId: null }
      const result = await SyncStateManager.createProjectState(projectId, data)

      expect(WebdavSyncProjectStates.findOneAndUpdate).toHaveBeenCalledWith(
        { projectId },
        { $set: data, $setOnInsert: { projectId } },
        { upsert: true, new: true }
      )
      expect(result).to.deep.equal(mockState)
    })

    it('should handle empty data', async function () {
      const mockState = {
        _id: new mongodb.ObjectId(),
        projectId,
      }
      WebdavSyncProjectStates.findOneAndUpdate.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockState),
      })

      const result = await SyncStateManager.createProjectState(projectId, {})

      expect(result.projectId).to.equal(projectId)
    })
  })

  describe('updateProjectState', function () {
    it('should update project state with $set', async function () {
      WebdavSyncProjectStates.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      })

      const result = await SyncStateManager.updateProjectState(projectId, {
        lastSync: new Date(),
      })

      expect(WebdavSyncProjectStates.updateOne).toHaveBeenCalledWith(
        { projectId },
        { $set: { lastSync: new Date() } }
      )
    })

    it('should return update result', async function () {
      const mockResult = {
        matchedCount: 0,
        modifiedCount: 0,
      }
      WebdavSyncProjectStates.updateOne.mockResolvedValue(mockResult)

      const result = await SyncStateManager.updateProjectState(projectId, {})

      expect(result).to.deep.equal(mockResult)
    })
  })

  describe('removeProjectState', function () {
    it('should delete project state', async function () {
      WebdavSyncProjectStates.deleteMany.mockResolvedValue({
        deletedCount: 1,
      })

      const result = await SyncStateManager.removeProjectState(projectId)

      expect(WebdavSyncProjectStates.deleteMany).toHaveBeenCalledWith({ projectId })
      expect(result).to.deep.equal({ deletedCount: 1 })
    })
  })
})