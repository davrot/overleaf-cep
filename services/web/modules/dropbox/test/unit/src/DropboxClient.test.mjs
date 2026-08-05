import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@overleaf/settings', () => ({
    default: {
        dropbox: { appKey: 'app-key', appSecret: 'app-secret' },
    },
}))

const { default: DropboxClient } = await import(
    '../../../app/src/DropboxClient.mjs'
)

describe('DropboxClient', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('creates a Dropbox OAuth authorization URL', async () => {
        const url = await DropboxClient.getAuthorizeUrl(
            'https://overleaf.example/dropbox/completeRegistration',
            'user-id'
        )

        const parsed = new URL(url)
        expect(parsed.origin).to.equal('https://api.dropbox.com')
        expect(parsed.pathname).to.equal('/oauth2/authorize')
        expect(parsed.searchParams.get('client_id')).to.equal('app-key')
        expect(parsed.searchParams.get('redirect_uri')).to.equal(
            'https://overleaf.example/dropbox/completeRegistration'
        )
        expect(parsed.searchParams.get('state')).to.equal('user-id')
    })

    it('uses Dropbox content headers for uploads', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('{}', { status: 200 })
        )
        await DropboxClient.upload(
            { accessToken: 'token' },
            '/Apps/Overleaf/project/main.tex',
            Buffer.from('content')
        )
        expect(fetch).toHaveBeenCalledWith(
            'https://content.dropboxapi.com/2/files/upload',
            expect.objectContaining({
                method: 'POST',
                body: Buffer.from('content'),
            })
        )
        const headers = fetch.mock.calls[0][1].headers
        expect(headers.authorization).to.equal('Bearer token')
        expect(JSON.parse(headers['dropbox-api-arg']).path).to.equal(
            '/Apps/Overleaf/project/main.tex'
        )
    })

    it('continues a list-folder cursor', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ entries: [], has_more: false }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        )
        await DropboxClient.listFolderContinue({ accessToken: 'token' }, 'cursor')
        expect(fetch.mock.calls[0][0]).to.equal(
            'https://api.dropboxapi.com/2/files/list_folder/continue'
        )
        expect(JSON.parse(fetch.mock.calls[0][1].body)).to.deep.equal({
            cursor: 'cursor',
        })
    })

    it('downloads binary content and revokes a token', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(Buffer.from('file'), { status: 200 }))
            .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        const content = await DropboxClient.download(
            { accessToken: 'token' },
            '/Apps/Overleaf/project/main.tex'
        )
        await DropboxClient.revokeToken({ accessToken: 'token' })
        expect(Buffer.from(content).toString()).to.equal('file')
        expect(fetch.mock.calls[1][0]).to.equal(
            'https://api.dropboxapi.com/2/auth/token/revoke'
        )
    })
})