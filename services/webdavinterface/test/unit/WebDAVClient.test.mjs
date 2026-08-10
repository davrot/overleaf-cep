import { describe, it, expect } from 'vitest'

describe('WebDAVClient', () => {
  it('validates auth credentials on construction', async () => {
    const WebDAVClient = (await import('./app/src/WebDAVClient.mjs')).default
    
    await expect(async () => {
      return new WebDAVClient({ 
        baseUrl: 'http://example.com',
        username: '',
        password: 'pass'
      })
    }).rejects.toThrow('Missing authentication credentials')
  })

  it('validates auth with missing username', async () => {
    const WebDAVClient = (await import('./app/src/WebDAVClient.mjs')).default
    
    await expect(async () => {
      return new WebDAVClient({ 
        baseUrl: 'http://example.com',
        password: 'pass'
      })
    }).rejects.toThrow('Missing authentication credentials')
  })

  it('validates auth with missing password', async () => {
    const WebDAVClient = (await import('./app/src/WebDAVClient.mjs')).default
    
    await expect(async () => {
      return new WebDAVClient({ 
        baseUrl: 'http://example.com',
        username: 'user'
      })
    }).rejects.toThrow('Missing authentication credentials')
  })

  it('generates correct basic auth header', async () => {
    const { generateBasicAuthHeader } = await import('./app/src/auth.mjs')
    
    expect(generateBasicAuthHeader('user', 'pass')).toBe('Basic dXNlcjpwYXNz')
  })
})
