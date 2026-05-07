import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import fs from 'node:fs/promises'
import Path from 'node:path'
import CommandRunner from './CommandRunner.js'
import LockManager from './LockManager.js'
import OError from '@overleaf/o-error'

const CONVERSION_CONFIGS = {
  docx: {
    inputFilename: 'input.docx',
    pandocArgs: ['--extract-media=.', '--from', 'docx+citations', '--citeproc'],
  },
  markdown: {
    inputFilename: 'input.md',
    pandocArgs: ['--from', 'markdown'],
  },
}

async function convertToLaTeXWithLock(conversionId, inputPath, conversionType) {
  const conversionDir = Path.join(Settings.path.compilesDir, conversionId)
  const lock = LockManager.acquire(conversionDir)
  try {
    return await convertToLaTeX(
      conversionId,
      conversionDir,
      inputPath,
      conversionType
    )
  } finally {
    lock.release()
  }
}

async function convertToLaTeX(
  conversionId,
  conversionDir,
  inputPath,
  conversionType
) {
  const config = CONVERSION_CONFIGS[conversionType]
  if (!config) {
    throw new OError('unsupported conversion type', { conversionType })
  }
  await fs.mkdir(conversionDir, { recursive: true })
  const newSourcePath = Path.join(conversionDir, config.inputFilename)
  await fs.copyFile(inputPath, newSourcePath)
  const outputName = crypto.randomUUID() + '.zip'

  try {
    const {
      stdout: stdoutPandoc,
      stderr: stderrPandoc,
      exitCode: exitCodePandoc,
    } = await CommandRunner.promises.run(
      conversionId,
      [
        'pandoc',
        config.inputFilename,
        '--output',
        'main.tex',
        '--to',
        'latex',
        '--standalone',
        ...config.pandocArgs,
      ],
      conversionDir,
      Settings.pandocImage,
      Settings.conversionTimeoutSeconds * 1000,
      {},
      'conversions'
    )
    if (exitCodePandoc !== 0) {
      throw new OError('Non-zero exit code from pandoc', {
        exitCode: exitCodePandoc,
        stderr: stderrPandoc,
      })
    }
    logger.debug(
      { stdout: stdoutPandoc, stderr: stderrPandoc, exitCode: exitCodePandoc },
      'conversion command completed'
    )

    // Clean up the source document to leave only the conversion result
    await fs.unlink(newSourcePath).catch(() => {})

    const {
      stdout: stdoutZip,
      stderr: stderrZip,
      exitCode: exitCodeZip,
    } = await CommandRunner.promises.run(
      conversionId,
      ['zip', '-r', outputName, '.'],
      conversionDir,
      Settings.pandocImage,
      Settings.conversionTimeoutSeconds * 1000,
      {},
      'conversions'
    )
    if (exitCodeZip !== 0) {
      throw new OError('Non-zero exit code from pandoc', {
        exitCode: exitCodeZip,
        stderr: stderrZip,
      })
    }
    logger.debug(
      { stdout: stdoutZip, stderr: stderrZip, exitCode: exitCodeZip },
      'conversion output compressed'
    )
  } catch (error) {
    // Clean up the conversion directory on error to avoid leaving failed conversions around
    await fs.rm(conversionDir, { force: true, recursive: true }).catch(() => {})
    throw new OError('pandoc conversion failed').withCause(error)
  }

  return Path.join(conversionDir, outputName)
}

const LATEX_EXPORT_CONFIGS = {
  docx: {
    fileExtension: 'docx',
    compressOutput: false,
    getPandocArgs: ({ outputPath }) => [
      '--output',
      outputPath,
      '--from',
      'latex',
      '--to',
      'docx',
      '--citeproc',
      '--number-sections',
      '--resource-path=.',
    ],
  },
  markdown: {
    fileExtension: 'md',
    compressOutput: true,
    getPandocArgs: ({ outputPath, subdirName }) => [
      '--output',
      outputPath,
      '--from',
      'latex',
      '--to',
      'markdown',
      '--resource-path=.',
      `--extract-media=${subdirName}`,
    ],
  },
}

async function convertLaTeXToDocumentInDirWithLock(
  conversionId,
  compileDir,
  rootDocPath,
  type
) {
  const lock = LockManager.acquire(compileDir)
  try {
    return await convertLaTeXToDocumentInDir(
      conversionId,
      compileDir,
      rootDocPath,
      type
    )
  } finally {
    lock.release()
  }
}

async function convertLaTeXToDocumentInDir(
  conversionId,
  compileDir,
  rootDocPath = 'main.tex',
  type
) {
  if (!Object.hasOwn(LATEX_EXPORT_CONFIGS, type)) {
    throw new OError('unsupported conversion type', { type })
  }
  const config = LATEX_EXPORT_CONFIGS[type]

  const timeoutMs = Settings.conversionTimeoutSeconds * 1000
  const outputId = crypto.randomUUID()

  let pandocOutputPath, finalOutputName
  if (config.compressOutput) {
    await fs.mkdir(Path.join(compileDir, outputId), { recursive: true })
    pandocOutputPath = Path.join(outputId, `main.${config.fileExtension}`)
    finalOutputName = outputId + '.zip'
  } else {
    pandocOutputPath = outputId + '.' + config.fileExtension
    finalOutputName = pandocOutputPath
  }

  logger.debug(
    { compileDir, rootDocPath, type },
    'running pandoc latex-to-document in compile dir'
  )

  const { exitCode, stdout, stderr } = await CommandRunner.promises.run(
    conversionId,
    [
      'pandoc',
      rootDocPath,
      ...config.getPandocArgs({
        outputPath: pandocOutputPath,
        subdirName: outputId,
      }),
    ],
    compileDir,
    Settings.pandocImage,
    timeoutMs,
    {},
    'conversions'
  )

  if (exitCode !== 0) {
    throw new OError('pandoc latex-to-document conversion failed', {
      type,
      exitCode,
      stdout,
      stderr,
    })
  }

  logger.debug(
    { stdout, stderr, exitCode },
    'pandoc latex-to-document conversion completed'
  )

  if (!config.compressOutput) {
    return Path.join(compileDir, finalOutputName)
  }

  const {
    exitCode: zipExitCode,
    stdout: zipStdout,
    stderr: zipStderr,
  } = await CommandRunner.promises.run(
    conversionId,
    ['sh', '-c', `cd ${outputId} && zip -r ../${finalOutputName} .`],
    compileDir,
    Settings.pandocImage,
    timeoutMs,
    {},
    'conversions'
  )

  if (zipExitCode !== 0) {
    throw new OError('zip compression of export failed', {
      exitCode: zipExitCode,
      stdout: zipStdout,
      stderr: zipStderr,
    })
  }

  logger.debug(
    { stdout: zipStdout, stderr: zipStderr, exitCode: zipExitCode },
    'export compressed'
  )

  return Path.join(compileDir, finalOutputName)
}

export default {
  promises: {
    convertToLaTeXWithLock,
    convertLaTeXToDocumentInDirWithLock,
  },
}
