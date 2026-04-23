import Metrics from '@overleaf/metrics'
import ProjectGetter from '../Project/ProjectGetter.mjs'
import ProjectZipStreamManager from './ProjectZipStreamManager.mjs'
import DocumentUpdaterHandler from '../DocumentUpdater/DocumentUpdaterHandler.mjs'
import { prepareZipAttachment } from '../../infrastructure/Response.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import ProjectAuditLogHandler from '../Project/ProjectAuditLogHandler.mjs'
import DocumentConversionManager from '../Uploads/DocumentConversionManager.mjs'
import { expressify } from '@overleaf/promise-utils'
import { pipeline } from 'node:stream/promises'

const SUPPORTED_CONVERSION_TYPES = new Map([['docx', 'docx']])

// Keep in sync with the logic for PDF files in CompileController
function getSafeProjectName(project) {
  return project.name.replace(/[^\p{L}\p{Nd}]/gu, '_')
}

async function exportProjectConversion(req, res) {
  const type = req.params.type
  const extension = SUPPORTED_CONVERSION_TYPES.get(type)
  if (!extension) {
    return res.sendStatus(400)
  }
  const userId = SessionManager.getLoggedInUserId(req.session)
  const projectId = req.params.Project_id
  Metrics.inc('document-exports', 1, { type })

  const project = await ProjectGetter.promises.getProject(projectId, {
    name: true,
  })

  const { stream, contentLength } =
    await DocumentConversionManager.promises.convertProjectToDocument(
      projectId,
      userId,
      type
    )

  const safeFileName = getSafeProjectName(project)
  res.setHeader('Content-Length', contentLength)
  res.attachment(`${safeFileName}.${extension}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Accel-Buffering', 'no')
  ProjectAuditLogHandler.addEntryInBackground(
    projectId,
    `project-exported-${type}`,
    userId,
    req.ip
  )
  await pipeline(stream, res)
}

export default {
  exportProjectConversion: expressify(exportProjectConversion),

  downloadProject(req, res, next) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const projectId = req.params.Project_id
    Metrics.inc('zip-downloads')
    DocumentUpdaterHandler.flushProjectToMongo(projectId, function (error) {
      if (error) {
        return next(error)
      }
      ProjectGetter.getProject(
        projectId,
        { name: true },
        function (error, project) {
          if (error) {
            return next(error)
          }
          ProjectAuditLogHandler.addEntryInBackground(
            projectId,
            'project-downloaded',
            userId,
            req.ip
          )
          ProjectZipStreamManager.createZipStreamForProject(
            projectId,
            function (error, stream) {
              if (error) {
                return next(error)
              }
              prepareZipAttachment(res, `${getSafeProjectName(project)}.zip`)
              stream.pipe(res)
            }
          )
        }
      )
    })
  },

  downloadMultipleProjects(req, res, next) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const projectIds = req.query.project_ids.split(',')
    Metrics.inc('zip-downloads-multiple')
    DocumentUpdaterHandler.flushMultipleProjectsToMongo(
      projectIds,
      function (error) {
        if (error) {
          return next(error)
        }
        // Log audit entry for each project in the batch
        for (const projectId of projectIds) {
          ProjectAuditLogHandler.addEntryInBackground(
            projectId,
            'project-downloaded',
            userId,
            req.ip
          )
        }
        ProjectZipStreamManager.createZipStreamForMultipleProjects(
          projectIds,
          function (error, stream) {
            if (error) {
              return next(error)
            }
            prepareZipAttachment(
              res,
              `Overleaf Projects (${projectIds.length} items).zip`
            )
            stream.pipe(res)
          }
        )
      }
    )
  },
}
