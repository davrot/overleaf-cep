// Unit tests for ConflictResolver
import { beforeEach, describe, expect, it, vi } from 'vitest'
import mongodb from 'mongodb-legacy'

const SyncStateManager = {
  getProjectState: vi.fn(),
  updateProjectState: vi.fn(),
}

vi.mock('./../../app/src/SyncStateManager.mjs', () => ({
  default: SyncStateManager,
}))

const { ConflictNotFoundError } = await import('./../../../app/src/ConflictErrors.mjs')

const ConflictResolver = await import('./../../../app/src/ConflictResolver.mjs')

describe('ConflictResolver', function () {
  let projectId
  let mockState

  beforeEach(function () {
    vi.clearAllMocks()
    projectId = new mongodb.ObjectId().toString()

    // Mock project state for each test
    mockState = {
      _id: new mongodb.ObjectId(),
      projectId,
      lastSync: null,
      folderId: null,
      lastConflict: null,
      conflictingPaths: [],
      mergeStatus: 'clean',
    }
  })

  describe('calculateHash', function () {
    it('should calculate SHA256 hash for string content', async function () {
      const content = 'test content'
      const hash = await ConflictResolver.calculateHash(content)

      expect(hash).to.be.a('string')
      expect(hash.length).to.equal(64) // SHA256 hex length
    })

    it('should return null for empty content', async function () {
      const hash = await ConflictResolver.calculateHash(null)
      expect(hash).to.be.null

      const emptyHash = await ConflictResolver.calculateHash('')
      expect(emptyHash).to.be.null
    })

    it('should calculate same hash for same content', async function () {
      const content = 'same content'
      const hash1 = await ConflictResolver.calculateHash(content)
      const hash2 = await ConflictResolver.calculateHash(content)

      expect(hash1).to.equal(hash2)
    })
  })

  describe('detectConflict', function () {
    it('should detect a conflict when local and remote versions differ', async function () {
      mockState.lastConflict = null
      SyncStateManager.getProjectState.mockResolvedValue(mockState)
      SyncStateManager.updateProjectState.mockResolvedValue({ matchedCount: 1 })

      const result = await ConflictResolver.detectConflict({
        projectId,
        path: 'file.txt',
        localHash: 'abc123',
        remoteETag: 'def456',
      })

      expect(result).to.have.property('exists', false)
      expect(result).to.have.property('shouldCheckNextPoll', true)
    })

    it('should identify existing conflict when path matches lastConflict', async function () {
      mockState.lastConflict = { path: 'file.txt' }
      SyncStateManager.getProjectState.mockResolvedValue(mockState)

      const result = await ConflictResolver.detectConflict({
        projectId,
        path: 'file.txt',
        localHash: 'abc123',
        remoteETag: 'def456',
      })

      expect(result).to.have.property('exists', true)
    })

    it('should throw error when project not linked to WebDAV', async function () {
      SyncStateManager.getProjectState.mockResolvedValue(null)

      await expect(
        ConflictResolver.detectConflict({
          projectId,
          path: 'file.txt',
          localHash: 'abc123',
          remoteETag: 'def456',
        })
      ).to.eventually.rejectWith(Error, 'Project not linked to WebDAV')
    })
  })

  describe('getProjectConflictState', function () {
    it('should get project conflict state from SyncStateManager', async function () {
      const mockState = { _id: new mongodb.ObjectId(), projectId }
      SyncStateManager.getProjectState.mockResolvedValue(mockState)

      const result = await ConflictResolver.getProjectConflictState(projectId)

      expect(SyncStateManager.getProjectState).toHaveBeenCalledWith(projectId)
      expect(result).to.deep.equal(mockState)
    })
  })

  describe('getConflictingVersions', function () {
    it('should return both versions when conflict exists', async function () {
      mockState.lastConflict = {
        path: 'file.txt',
        versions: {
          local: 'local-content',
          remote: 'remote-content',
        },
      }
      SyncStateManager.getProjectState.mockResolvedValue(mockState)

      const result = await ConflictResolver.getConflictingVersions(projectId, 'file.txt')

      expect(result).to.deep.equal({
        local: 'local-content',
        remote: 'remote-content',
      })
    })

    it('should throw error when no active conflict exists', async function () {
      mockState.lastConflict = null
      SyncStateManager.getProjectState.mockResolvedValue(mockState)

      await expect(
        ConflictResolver.getConflictingVersions(projectId, 'file.txt')
      ).to.eventually.rejectWith(ConflictNotFoundError)
    })
  })

  describe('resolve', function () {
    it('should resolve conflict by keeping local version', async function () {
      mockState.lastConflict = { path: 'file.txt' }
      SyncStateManager.getProjectState.mockResolvedValue(mockState)
      SyncStateManager.updateProjectState.mockResolvedValue({ matchedCount: 1 })

      const result = await ConflictResolver.resolve(projectId, 'file.txt', 'local')

      expect(result).to.have.property('success', true)
      expect(result.choice).to.equal('local')
    })

    it('should resolve conflict by keeping remote version', async function () {
      mockState.lastConflict = { path: 'file.txt' }
      SyncStateManager.getProjectState.mockResolvedValue(mockState)
      SyncStateManager.updateProjectState.mockResolvedValue({ matchedCount: 1 })

      const result = await ConflictResolver.resolve(projectId, 'file.txt', 'remote')

      expect(result).to.have.property('success', true)
      expect(result.choice).to.equal('remote')
    })

    it('should throw error for invalid choice', async function () {
      mockState.lastConflict = { path: 'file.txt' }
      SyncStateManager.getProjectState.mockResolvedValue(mockState)

      await expect(
        ConflictResolver.resolve(projectId, 'file.txt', 'invalid')
      ).to.eventually.rejectWith(Error, "Invalid choice: invalid. Must be 'local' or 'remote'")
    })

    it('should throw error when conflict not found', async function () {
      mockState.lastConflict = null
      SyncStateManager.getProjectState.mockResolvedValue(mockState)

      await expect(
        ConflictResolver.resolve(projectId, 'file.txt', 'local')
      ).to.eventually.rejectWith(ConflictNotFoundError)
    })

    it('should clear conflict state after resolution', async function () {
      mockState.lastConflict = { path: 'file.txt' }
      SyncStateManager.getProjectState.mockResolvedValue(mockState)
      SyncStateManager.updateProjectState.mockResolvedValue({ matchedCount: 1 })

      await ConflictResolver.resolve(projectId, 'file.txt', 'local')

      // Verify the update included clearing conflict fields
      const updateCall = SyncStateManager.updateProjectState.getCall(0)
      expect(updateCall.args[1].$unset).to.include.keys('lastConflict')
    })
  })
})