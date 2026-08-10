import { beforeEach, describe, expect, it, vi } from 'vitest'
import mongodb from 'mongodb-legacy'

const WebdavUserCredentials = vi.hoisted(() => {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    deleteOne: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
  }
})

vi.mock('./../../app/models/webdavUserCredentials.mjs', () => ({
  WebdavUserCredentials,
}))

// Mock encryption to avoid dependency issues
vi.mock('./../src/WebdavTokenEncryption.mjs', async (importActual) => {
  return {
    encrypt: vi.fn().mockImplementation(async (data) => {
      // Simple mock that converts to string
      return JSON.stringify(data)
    }),
    decrypt: vi.fn().mockImplementation(async (encryptedData) => {
      // Simple mock that parses from string
      return JSON.parse(encryptedData)
    }),
  }
})

const WebdavTokenManager = await import('./../../../app/src/WebdavTokenManager.mjs')

describe('WebdavTokenManager', function () {
  let userId

  beforeEach(function () {
    vi.clearAllMocks()
    userId = 'test-user-' + Date.now()
  })

  afterEach(async function () {
    // Clean up - delete record if exists
    try {
      await WebdavUserCredentials.deleteMany({ userId })
    } catch (ignore) {}
  })

  it('should save and retrieve credentials', async function () {
    const testCredentials = {
      baseUrl: 'https://nextcloud.example.com',
      username: 'testuser',
      password: 'testpass',
    }

    // Save
    await WebdavTokenManager.saveUserCredentials(userId, testCredentials)

    // Verify encrypt was called with correct data
    expect(encrypt).toHaveBeenCalledWith(testCredentials)

    // Retrieve
    const retrieved = await WebdavTokenManager.getUserCredentials(userId)

    expect(decrypt).toHaveBeenCalled()
    expect(retrieved.baseUrl).to.equal(testCredentials.baseUrl)
    expect(retrieved.username).to.equal(testCredentials.username)
  })

  it('should return null for non-existent user', async function () {
    // Mock findOne to return null
    WebdavUserCredentials.findOne.mockResolvedValue(null)

    const result = await WebdavTokenManager.getUserCredentials('nonexistent-user')

    expect(result).to.be.null
  })

  it('should remove credentials correctly', async function () {
    // First save some credentials
    const testCredentials = { baseUrl: 'https://test.com' }
    await WebdavTokenManager.saveUserCredentials(userId, testCredentials)

    // Verify the record was created
    expect(WebdavUserCredentials.findOne).toHaveBeenCalledWith({ userId })

    // Then remove
    await WebdavTokenManager.removeUserCredentials(userId)

    // Verify deleteOne was called
    expect(WebdavUserCredentials.deleteOne).toHaveBeenCalledWith({ userId })

    const result = await WebdavTokenManager.getUserCredentials(userId)
    expect(result).to.be.null
  })

  it('should get linked user IDs', async function () {
    // Create multiple users with credentials
    const ids = ['user1', 'user2', 'user3']
    for (const id of ids) {
      await WebdavTokenManager.saveUserCredentials(id, { baseUrl: 'https://test.com' })
    }

    // Mock find to return all user IDs
    WebdavUserCredentials.find.mockResolvedValue(
      ids.map((id) => ({ userId: id }))
    )

    const linkedIds = await WebdavTokenManager.getLinkedUserIds()

    expect(linkedIds).to.have.lengthOf(3)
    expect(linkedIds).to.include.members(ids)
  })
})