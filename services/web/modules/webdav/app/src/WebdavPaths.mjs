export function remotePath(rootPath, projectName, filePath = '/') {
  const normalizedRoot = `/${rootPath || ''}`.replace(/\/+/g, '/').replace(/\/$/, '')
  const normalizedProjectName = String(projectName || '')
    .replace(/^\/+/, '')
    .replace(new RegExp(`^${normalizedRoot.slice(1)}/?`), '')
  return `${normalizedRoot}/${normalizedProjectName}/${String(filePath).replace(/^\/+/, '')}`
    .replace(/\/+/g, '/')
}