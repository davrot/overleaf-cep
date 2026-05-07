import Path from 'node:path'
import sinon from 'sinon'
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest'
const MODULE_PATH = Path.join(
  import.meta.dirname,
  '../../../app/js/ConversionManager'
)

describe('ConversionManager', function () {
  beforeEach(async function (ctx) {
    ctx.CommandRunner = {
      promises: {
        run: sinon.stub().resolves({ stdout: '', stderr: '', exitCode: 0 }),
      },
    }

    ctx.lock = {
      release: sinon.stub(),
    }

    ctx.LockManager = {
      acquire: sinon.stub().returns(ctx.lock),
    }

    ctx.Settings = {
      pandocImage: 'mock-pandoc-image',
      conversionTimeoutSeconds: 60,
      path: { compilesDir: '/compiles' },
    }

    ctx.fs = {
      mkdir: sinon.stub().resolves(),
      copyFile: sinon.stub().resolves(),
      rm: sinon.stub().resolves(),
      unlink: sinon.stub().resolves(),
    }

    ctx.conversionId = 'test-conversion-id'
    ctx.conversionDir = '/compiles/test-conversion-id'
    ctx.outputPath = '/compiles/test-conversion-id/output-uuid.zip'

    ctx.uuidStub = sinon
      .stub(globalThis.crypto, 'randomUUID')
      .returns('output-uuid')

    vi.doMock('../../../app/js/LockManager', () => ({
      default: ctx.LockManager,
    }))

    vi.doMock('@overleaf/settings', () => ({
      default: ctx.Settings,
    }))

    vi.doMock('../../../app/js/CommandRunner', () => ({
      default: ctx.CommandRunner,
    }))

    vi.doMock('node:fs/promises', () => ({ default: ctx.fs }))

    ctx.ConversionManager = (await import(MODULE_PATH)).default
  })

  afterEach(function (ctx) {
    ctx.uuidStub.restore()
  })

  describe('convertToLaTeXWithLock', function () {
    describe('with conversionType=docx', function () {
      beforeEach(function (ctx) {
        ctx.inputPath = '/path/to/input.docx'
      })

      describe('file setup and pandoc args', function () {
        beforeEach(async function (ctx) {
          ctx.result =
            await ctx.ConversionManager.promises.convertToLaTeXWithLock(
              ctx.conversionId,
              ctx.inputPath,
              'docx'
            )
        })

        it('should acquire a lock', async function (ctx) {
          sinon.assert.calledWith(ctx.LockManager.acquire, ctx.conversionDir)
        })

        it('should copy the input file to the conversion directory with docx filename', async function (ctx) {
          sinon.assert.calledWith(ctx.fs.mkdir, ctx.conversionDir, {
            recursive: true,
          })
          sinon.assert.calledWith(
            ctx.fs.copyFile,
            ctx.inputPath,
            Path.join(ctx.conversionDir, 'input.docx')
          )
        })

        it('should convert conversion timeout to milliseconds', async function (ctx) {
          expect(ctx.CommandRunner.promises.run.firstCall.args[4]).toBe(60_000)
          expect(ctx.CommandRunner.promises.run.secondCall.args[4]).toBe(60_000)
        })

        it('should run pandoc with docx args followed by zip', function (ctx) {
          expect(ctx.CommandRunner.promises.run.callCount).toBe(2)
          expect(ctx.CommandRunner.promises.run.firstCall.args).toEqual([
            ctx.conversionId,
            [
              'pandoc',
              'input.docx',
              '--output',
              'main.tex',
              '--to',
              'latex',
              '--standalone',
              '--extract-media=.',
              '--from',
              'docx+citations',
              '--citeproc',
            ],
            ctx.conversionDir,
            ctx.Settings.pandocImage,
            60_000,
            {},
            'conversions',
          ])
          expect(ctx.CommandRunner.promises.run.secondCall.args).toEqual([
            ctx.conversionId,
            ['zip', '-r', 'output-uuid.zip', '.'],
            ctx.conversionDir,
            ctx.Settings.pandocImage,
            60_000,
            {},
            'conversions',
          ])
        })
      })

      describe('successful conversion', function () {
        beforeEach(async function (ctx) {
          ctx.CommandRunner.promises.run.resolves({
            stdout: 'mock-stdout',
            stderr: 'mock-stderr',
            exitCode: 0,
          })

          ctx.result =
            await ctx.ConversionManager.promises.convertToLaTeXWithLock(
              ctx.conversionId,
              ctx.inputPath,
              'docx'
            )
        })

        it('should remove the source document after conversion', async function (ctx) {
          sinon.assert.calledWith(
            ctx.fs.unlink,
            Path.join(ctx.conversionDir, 'input.docx')
          )
        })

        it('should return the output zip path', function (ctx) {
          expect(ctx.result).toBe(ctx.outputPath)
        })

        it('should release the lock', function (ctx) {
          sinon.assert.called(ctx.lock.release)
        })
      })

      describe('unsuccessful conversion (exitcode)', function () {
        beforeEach(async function (ctx) {
          ctx.CommandRunner.promises.run.resolves({
            stdout: 'mock-stdout',
            stderr: 'mock-stderr',
            exitCode: 63,
          })

          await expect(
            ctx.ConversionManager.promises.convertToLaTeXWithLock(
              ctx.conversionId,
              ctx.inputPath,
              'docx'
            )
          ).to.be.rejectedWith('pandoc conversion failed')
        })

        it('should remove the entire conversion directory', async function (ctx) {
          sinon.assert.calledWith(ctx.fs.rm, ctx.conversionDir, {
            force: true,
            recursive: true,
          })
        })

        it('should release the lock', function (ctx) {
          sinon.assert.called(ctx.lock.release)
        })
      })

      describe('unsuccessful compression (exitcode)', function () {
        beforeEach(async function (ctx) {
          ctx.CommandRunner.promises.run
            .onFirstCall()
            .resolves({
              stdout: 'mock-pandoc-stdout',
              stderr: 'mock-pandoc-stderr',
              exitCode: 0,
            })
            .onSecondCall()
            .resolves({
              stdout: 'mock-zip-stdout',
              stderr: 'mock-zip-stderr',
              exitCode: 12,
            })

          await expect(
            ctx.ConversionManager.promises.convertToLaTeXWithLock(
              ctx.conversionId,
              ctx.inputPath,
              'docx'
            )
          ).to.be.rejectedWith('pandoc conversion failed')
        })

        it('should remove the entire conversion directory', async function (ctx) {
          sinon.assert.calledWith(ctx.fs.rm, ctx.conversionDir, {
            force: true,
            recursive: true,
          })
        })

        it('should release the lock', function (ctx) {
          sinon.assert.called(ctx.lock.release)
        })
      })

      describe('unsuccessful conversion (throws)', function () {
        beforeEach(async function (ctx) {
          ctx.CommandRunner.promises.run.rejects(
            new Error('mock conversion error')
          )
          await expect(
            ctx.ConversionManager.promises.convertToLaTeXWithLock(
              ctx.conversionId,
              ctx.inputPath,
              'docx'
            )
          ).to.be.rejectedWith('pandoc conversion failed')
        })

        it('should remove the entire conversion directory', async function (ctx) {
          sinon.assert.calledWith(ctx.fs.rm, ctx.conversionDir, {
            force: true,
            recursive: true,
          })
        })

        it('should release the lock', function (ctx) {
          sinon.assert.called(ctx.lock.release)
        })
      })
    })

    describe('with conversionType=markdown', function () {
      beforeEach(function (ctx) {
        ctx.inputPath = '/path/to/input.md'
      })

      describe('file setup and pandoc args', function () {
        beforeEach(async function (ctx) {
          ctx.result =
            await ctx.ConversionManager.promises.convertToLaTeXWithLock(
              ctx.conversionId,
              ctx.inputPath,
              'markdown'
            )
        })

        it('should copy the input file to the conversion directory with md filename', async function (ctx) {
          sinon.assert.calledWith(ctx.fs.mkdir, ctx.conversionDir, {
            recursive: true,
          })
          sinon.assert.calledWith(
            ctx.fs.copyFile,
            ctx.inputPath,
            Path.join(ctx.conversionDir, 'input.md')
          )
        })

        it('should run pandoc with markdown args followed by zip', function (ctx) {
          expect(ctx.CommandRunner.promises.run.callCount).toBe(2)
          expect(ctx.CommandRunner.promises.run.firstCall.args).toEqual([
            ctx.conversionId,
            [
              'pandoc',
              'input.md',
              '--output',
              'main.tex',
              '--to',
              'latex',
              '--standalone',
              '--from',
              'markdown',
            ],
            ctx.conversionDir,
            ctx.Settings.pandocImage,
            60_000,
            {},
            'conversions',
          ])
          expect(ctx.CommandRunner.promises.run.secondCall.args).toEqual([
            ctx.conversionId,
            ['zip', '-r', 'output-uuid.zip', '.'],
            ctx.conversionDir,
            ctx.Settings.pandocImage,
            60_000,
            {},
            'conversions',
          ])
        })
      })

      describe('successful conversion', function () {
        beforeEach(async function (ctx) {
          ctx.CommandRunner.promises.run.resolves({
            stdout: 'mock-stdout',
            stderr: 'mock-stderr',
            exitCode: 0,
          })

          ctx.result =
            await ctx.ConversionManager.promises.convertToLaTeXWithLock(
              ctx.conversionId,
              ctx.inputPath,
              'markdown'
            )
        })

        it('should remove the source document after conversion', async function (ctx) {
          sinon.assert.calledWith(
            ctx.fs.unlink,
            Path.join(ctx.conversionDir, 'input.md')
          )
        })

        it('should return the output zip path', function (ctx) {
          expect(ctx.result).toBe(ctx.outputPath)
        })
      })
    })
  })

  describe('convertLaTeXToDocumentInDirWithLock', function () {
    describe('successfully', function () {
      beforeEach(async function (ctx) {
        ctx.compileDir = '/compiles/test-compile-dir'
        ctx.rootDocPath = 'main.tex'
        ctx.type = 'docx'
        ctx.extension = 'docx'

        ctx.result =
          await ctx.ConversionManager.promises.convertLaTeXToDocumentInDirWithLock(
            ctx.conversionId,
            ctx.compileDir,
            ctx.rootDocPath,
            ctx.type
          )
      })

      it('should acquire a lock on the compile dir', function (ctx) {
        sinon.assert.calledWith(ctx.LockManager.acquire, ctx.compileDir)
      })

      it('should release the lock', function (ctx) {
        sinon.assert.called(ctx.lock.release)
      })

      it('should run pandoc with correct arguments', function (ctx) {
        expect(ctx.CommandRunner.promises.run.callCount).toBe(1)
        expect(ctx.CommandRunner.promises.run.firstCall.args).toEqual([
          ctx.conversionId,
          [
            'pandoc',
            ctx.rootDocPath,
            '--output',
            `output-uuid.${ctx.extension}`,
            '--from',
            'latex',
            '--to',
            ctx.type,
            '--resource-path=.',
          ],
          ctx.compileDir,
          ctx.Settings.pandocImage,
          60_000,
          {},
          'conversions',
        ])
      })

      it('should convert conversion timeout to milliseconds', function (ctx) {
        expect(ctx.CommandRunner.promises.run.firstCall.args[4]).toBe(60_000)
      })

      it('should return path to the output document', function (ctx) {
        expect(ctx.result).toBe(
          Path.join(ctx.compileDir, `output-uuid.${ctx.extension}`)
        )
      })
    })

    describe('when pandoc fails (non-zero exit code)', function () {
      it('should reject with an error and release the lock', async function (ctx) {
        ctx.compileDir = '/compiles/test-compile-dir'

        ctx.CommandRunner.promises.run.resolves({
          stdout: 'mock-stdout',
          stderr: 'mock-stderr',
          exitCode: 1,
        })

        await expect(
          ctx.ConversionManager.promises.convertLaTeXToDocumentInDirWithLock(
            ctx.conversionId,
            ctx.compileDir,
            'main.tex',
            'docx'
          )
        ).to.be.rejectedWith('pandoc latex-to-document conversion failed')

        sinon.assert.called(ctx.lock.release)
      })
    })
  })

  describe('convertLaTeXToDocumentInDirWithLock (type=markdown)', function () {
    describe('successfully', function () {
      beforeEach(async function (ctx) {
        ctx.compileDir = '/compiles/test-compile-dir'
        ctx.rootDocPath = 'main.tex'

        ctx.result =
          await ctx.ConversionManager.promises.convertLaTeXToDocumentInDirWithLock(
            ctx.conversionId,
            ctx.compileDir,
            ctx.rootDocPath,
            'markdown'
          )
      })

      it('should acquire a lock on the compile dir', function (ctx) {
        sinon.assert.calledWith(ctx.LockManager.acquire, ctx.compileDir)
      })

      it('should release the lock', function (ctx) {
        sinon.assert.called(ctx.lock.release)
      })

      it('should create a UUID-named subdirectory', function (ctx) {
        sinon.assert.calledWith(
          ctx.fs.mkdir,
          Path.join(ctx.compileDir, 'output-uuid'),
          { recursive: true }
        )
      })

      it('should run pandoc then zip (two commands total)', function (ctx) {
        expect(ctx.CommandRunner.promises.run.callCount).toBe(2)
      })

      it('should run pandoc outputting main.md into the UUID-named subdir', function (ctx) {
        expect(ctx.CommandRunner.promises.run.firstCall.args).toEqual([
          ctx.conversionId,
          [
            'pandoc',
            ctx.rootDocPath,
            '--output',
            Path.join('output-uuid', 'main.md'),
            '--from',
            'latex',
            '--to',
            'markdown',
            '--resource-path=.',
            '--extract-media=output-uuid',
          ],
          ctx.compileDir,
          ctx.Settings.pandocImage,
          60_000,
          {},
          'conversions',
        ])
      })

      it('should zip the project-named subdirectory', function (ctx) {
        expect(ctx.CommandRunner.promises.run.secondCall.args).toEqual([
          ctx.conversionId,
          ['sh', '-c', 'cd output-uuid && zip -r ../output-uuid.zip .'],
          ctx.compileDir,
          ctx.Settings.pandocImage,
          60_000,
          {},
          'conversions',
        ])
      })

      it('should return the path to the zip file', function (ctx) {
        expect(ctx.result).toBe(Path.join(ctx.compileDir, 'output-uuid.zip'))
      })

      it('should convert conversion timeout to milliseconds', function (ctx) {
        expect(ctx.CommandRunner.promises.run.firstCall.args[4]).toBe(60_000)
        expect(ctx.CommandRunner.promises.run.secondCall.args[4]).toBe(60_000)
      })
    })

    describe('when pandoc fails (non-zero exit code)', function () {
      it('should reject with an error and release the lock', async function (ctx) {
        ctx.compileDir = '/compiles/test-compile-dir'

        ctx.CommandRunner.promises.run.resolves({
          stdout: 'mock-stdout',
          stderr: 'mock-stderr',
          exitCode: 1,
        })

        await expect(
          ctx.ConversionManager.promises.convertLaTeXToDocumentInDirWithLock(
            ctx.conversionId,
            ctx.compileDir,
            'main.tex',
            'markdown'
          )
        ).to.be.rejectedWith('pandoc latex-to-document conversion failed')

        sinon.assert.called(ctx.lock.release)
      })
    })

    describe('when zip fails (non-zero exit code)', function () {
      it('should reject with an error and release the lock', async function (ctx) {
        ctx.compileDir = '/compiles/test-compile-dir'

        ctx.CommandRunner.promises.run
          .onFirstCall()
          .resolves({ stdout: '', stderr: '', exitCode: 0 })
          .onSecondCall()
          .resolves({ stdout: '', stderr: 'zip error', exitCode: 1 })

        await expect(
          ctx.ConversionManager.promises.convertLaTeXToDocumentInDirWithLock(
            ctx.conversionId,
            ctx.compileDir,
            'main.tex',
            'markdown'
          )
        ).to.be.rejectedWith('zip compression of export failed')

        sinon.assert.called(ctx.lock.release)
      })
    })
  })
})
