import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@overleaf/settings', () => ({
  default: { webdav: { requestTimeoutMs: 1000 } },
}))

const { default: WebdavClient, parseMultistatus } = await import(
  '../../../app/src/WebdavClient.mjs'
)
const { remotePath } = await import('../../../app/src/WebdavPaths.mjs')

describe('WebdavClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the configured WebDAV endpoint path when building URLs', () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })

    expect(client.url('/Overleaf/demo/main.tex').toString()).to.equal(
      'https://cloud.example/remote.php/dav/files/alice/Overleaf/demo/main.tex'
    )
  })

  it('uses the connected user root for project paths', () => {
    expect(remotePath('/alice-files', 'demo', '/main.tex')).to.equal(
      '/alice-files/demo/main.tex'
    )
  })

  it('does not duplicate the configured root in project paths', () => {
    expect(remotePath('/Overleaf', 'Overleaf/Model-Notes', '/sample.bib')).to.equal(
      '/Overleaf/Model-Notes/sample.bib'
    )
  })

  it('converts absolute WebDAV hrefs to endpoint-relative paths', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/remote.php/dav/files/alice/Overleaf/demo/main%20file.tex</d:href>
          <d:propstat><d:prop>
            <d:resourcetype />
            <d:getetag>abc</d:getetag>
            <d:getcontentlength>12</d:getcontentlength>
          </d:prop></d:propstat>
        </d:response>
      </d:multistatus>`

    expect(
      parseMultistatus(
        xml,
        '/Overleaf/demo',
        '/remote.php/dav/files/alice'
      )
    ).to.deep.equal([
      {
        href: '/remote.php/dav/files/alice/Overleaf/demo/main%20file.tex',
        path: '/Overleaf/demo/main file.tex',
        isDirectory: false,
        etag: 'abc',
        modifiedAt: null,
        size: 12,
      },
    ])
  })

  it('rejects malformed multistatus XML', () => {
    expect(() => parseMultistatus('<not-xml', '/Overleaf/demo')).to.throw(
      'invalid WebDAV multistatus response'
    )
  })

  it('retries transient WebDAV responses', async () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const body = await client.get('/Overleaf/demo/main.tex')
    expect(body.byteLength).to.equal(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries locked WebDAV responses before succeeding', async () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 423 }))
      .mockResolvedValueOnce(new Response(null, { status: 423 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const body = await client.get('/Overleaf/demo/main.tex')
    expect(body.byteLength).to.equal(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('uses If-Match when replacing a known remote file', async () => {
    const client = new WebdavClient({
      baseUrl: 'https://cloud.example/remote.php/dav/files/alice',
      username: 'alice',
      password: 'secret',
      rootPath: '/Overleaf',
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    await client.put('/Overleaf/demo/main.tex', 'updated', { etag: '"v1"' })

    expect(fetchMock.mock.calls[0][1].headers['if-match']).to.equal('"v1"')
  })
})