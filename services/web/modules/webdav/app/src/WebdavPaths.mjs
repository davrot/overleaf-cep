export function remotePath(rootPath, projectName, filePath = '/') {
  return `${rootPath}/${projectName}${filePath}`.replace(/\/+/g, '/')
}