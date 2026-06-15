const fs = require('node:fs/promises');
const path = require('node:path');

function sanitizePathSegment(value, fallback = 'files') {
  let sanitized = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  return sanitized || fallback;
}

function normalizeRelativeFilePath(value, fallbackName = 'file') {
  const segments = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => sanitizePathSegment(segment, 'file'));

  if (!segments.length) {
    return sanitizePathSegment(fallbackName, 'file');
  }

  return path.join(...segments);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function makeUniqueFilePath(destinationPath) {
  if (!(await pathExists(destinationPath))) {
    return destinationPath;
  }

  const directory = path.dirname(destinationPath);
  const extension = path.extname(destinationPath);
  const baseName = path.basename(destinationPath, extension);
  let attempt = 2;

  while (true) {
    const candidatePath = path.join(directory, `${baseName} (${attempt})${extension}`);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
    attempt += 1;
  }
}

async function copyFileWithTimestamps(sourcePath, destinationPath, sourceStat) {
  await fs.copyFile(sourcePath, destinationPath);
  await fs.utimes(destinationPath, sourceStat.atime, sourceStat.mtime).catch(() => {});
}

async function moveFile(sourcePath, destinationPath, sourceStat) {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }

    await copyFileWithTimestamps(sourcePath, destinationPath, sourceStat);
    await fs.unlink(sourcePath);
  }
}

async function restoreMovedFile(sourcePath, destinationPath) {
  if (!(await pathExists(destinationPath)) || await pathExists(sourcePath)) {
    return;
  }

  await fs.mkdir(path.dirname(sourcePath), { recursive: true });

  try {
    await fs.rename(destinationPath, sourcePath);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }

    const destinationStat = await fs.stat(destinationPath);
    await copyFileWithTimestamps(destinationPath, sourcePath, destinationStat);
    await fs.unlink(destinationPath);
  }
}

function getProjectStorageRoot(userDataPath, projectId, projectName = '') {
  return path.join(
    userDataPath,
    'project-data',
    sanitizePathSegment(projectName || projectId, 'project')
  );
}

async function migrateProjectStorageRoot(userDataPath, projectId, projectName) {
  const legacyRoot = getProjectStorageRoot(userDataPath, projectId);
  const projectRoot = getProjectStorageRoot(userDataPath, projectId, projectName);

  if (path.resolve(legacyRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase()) {
    return {
      migrated: false,
      legacyRoot,
      projectRoot
    };
  }

  if (!(await pathExists(legacyRoot))) {
    return {
      migrated: false,
      legacyRoot,
      projectRoot
    };
  }

  await fs.mkdir(path.dirname(projectRoot), { recursive: true });

  if (await pathExists(projectRoot)) {
    await fs.cp(legacyRoot, projectRoot, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true
    });
    await fs.rm(legacyRoot, { recursive: true, force: true });
  } else {
    await fs.rename(legacyRoot, projectRoot);
  }

  return {
    migrated: true,
    legacyRoot,
    projectRoot
  };
}

function isPathInsideRoot(rootPath, candidatePath) {
  if (!rootPath || !candidatePath) {
    return false;
  }

  const relativePath = path.relative(
    path.resolve(rootPath),
    path.resolve(candidatePath)
  );

  return relativePath === ''
    || (!relativePath.startsWith(`..${path.sep}`)
      && relativePath !== '..'
      && !path.isAbsolute(relativePath));
}

function getCommonContainingDirectory(filePaths) {
  const directories = filePaths
    .map((filePath) => String(filePath || '').trim())
    .filter(Boolean)
    .map((filePath) => path.dirname(path.resolve(filePath)));

  if (!directories.length) {
    return '';
  }

  const root = path.parse(directories[0]).root;
  let sharedSegments = path.relative(root, directories[0]).split(path.sep).filter(Boolean);

  for (const directory of directories.slice(1)) {
    if (path.parse(directory).root.toLowerCase() !== root.toLowerCase()) {
      return '';
    }

    const segments = path.relative(root, directory).split(path.sep).filter(Boolean);
    let sharedLength = 0;

    while (
      sharedLength < sharedSegments.length
      && sharedLength < segments.length
      && sharedSegments[sharedLength].toLowerCase() === segments[sharedLength].toLowerCase()
    ) {
      sharedLength += 1;
    }

    sharedSegments = sharedSegments.slice(0, sharedLength);
  }

  return path.join(root, ...sharedSegments);
}

async function importProjectFiles(options) {
  const {
    userDataPath,
    projectId,
    projectName = '',
    category = 'imports',
    importName = 'import',
    mode,
    files = []
  } = options || {};

  if (!userDataPath || !projectId) {
    throw new Error('Project storage location is required.');
  }

  if (mode !== 'copy' && mode !== 'move') {
    throw new Error('Import mode must be copy or move.');
  }

  if (!Array.isArray(files) || !files.length) {
    throw new Error('At least one file is required for import.');
  }

  const projectRoot = getProjectStorageRoot(userDataPath, projectId, projectName);
  const categoryRoot = path.join(projectRoot, sanitizePathSegment(category, 'imports'));
  const importDirectoryName = [
    new Date().toISOString().replace(/[:.]/g, '-'),
    sanitizePathSegment(importName, 'import'),
    Math.random().toString(36).slice(2, 8)
  ].join('-');
  const importRoot = path.join(categoryRoot, importDirectoryName);
  const completedTransfers = [];
  const importedFiles = [];

  await fs.mkdir(importRoot, { recursive: true });

  try {
    for (const descriptor of files) {
      const sourcePath = path.resolve(String(descriptor?.sourcePath || ''));
      if (!descriptor?.sourcePath) {
        throw new Error(`The selected file "${descriptor?.name || 'unknown'}" does not have an accessible path.`);
      }

      const sourceStat = await fs.stat(sourcePath);
      if (!sourceStat.isFile()) {
        throw new Error(`"${descriptor?.name || path.basename(sourcePath)}" is not a file.`);
      }

      const fallbackName = descriptor?.name || path.basename(sourcePath);
      const relativePath = normalizeRelativeFilePath(descriptor?.relativePath, fallbackName);
      const requestedDestinationPath = path.join(importRoot, relativePath);
      const destinationPath = await makeUniqueFilePath(requestedDestinationPath);
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });

      if (mode === 'move') {
        await moveFile(sourcePath, destinationPath, sourceStat);
      } else {
        await copyFileWithTimestamps(sourcePath, destinationPath, sourceStat);
      }

      completedTransfers.push({ sourcePath, destinationPath });
      const destinationStat = await fs.stat(destinationPath);
      importedFiles.push({
        name: descriptor?.name || path.basename(destinationPath),
        size: destinationStat.size,
        type: descriptor?.type || 'application/octet-stream',
        relativePath: path.relative(importRoot, destinationPath).replace(/\\/g, '/'),
        absolutePath: destinationPath,
        lastModified: Math.round(destinationStat.mtimeMs),
        importedAt: new Date().toISOString(),
        storageMode: mode
      });
    }
  } catch (error) {
    if (mode === 'move') {
      const rollbackResults = await Promise.allSettled(
        [...completedTransfers].reverse().map(({ sourcePath, destinationPath }) =>
          restoreMovedFile(sourcePath, destinationPath)
        )
      );
      const rollbackFailed = rollbackResults.some((result) => result.status === 'rejected');

      if (rollbackFailed) {
        throw new Error(`${error.message} Some moved files could not be restored and remain in ${importRoot}.`);
      }
    }

    await fs.rm(importRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return {
    mode,
    storageRoot: importRoot,
    files: importedFiles
  };
}

async function ensureProjectFilesStored(options) {
  const {
    userDataPath,
    projectId,
    projectName = '',
    category = 'legacy-imports',
    importName = 'legacy-import',
    files = []
  } = options || {};

  if (!userDataPath || !projectId) {
    throw new Error('Project storage location is required.');
  }

  if (!Array.isArray(files) || !files.length) {
    throw new Error('At least one file is required.');
  }

  const results = new Array(files.length);
  const externalFiles = [];
  const externalIndexes = [];

  files.forEach((descriptor, index) => {
    const sourcePath = String(descriptor?.absolutePath || descriptor?.sourcePath || '').trim();

    if (!sourcePath) {
      throw new Error(`The selected file "${descriptor?.name || 'unknown'}" does not have an accessible path.`);
    }

    if (isPathInsideRoot(userDataPath, sourcePath)) {
      results[index] = {
        ...descriptor,
        absolutePath: path.resolve(sourcePath)
      };
      return;
    }

    externalIndexes.push(index);
    externalFiles.push({
      ...descriptor,
      sourcePath
    });
  });

  if (!externalFiles.length) {
    return {
      migrated: false,
      storageRoot: getCommonContainingDirectory(results.map((file) => file.absolutePath)),
      files: results
    };
  }

  const imported = await importProjectFiles({
    userDataPath,
    projectId,
    projectName,
    category,
    importName,
    mode: 'copy',
    files: externalFiles
  });

  imported.files.forEach((file, index) => {
    const { sourcePath: _sourcePath, ...originalDescriptor } = externalFiles[index];
    results[externalIndexes[index]] = {
      ...originalDescriptor,
      ...file
    };
  });

  return {
    migrated: true,
    storageRoot: getCommonContainingDirectory(results.map((file) => file.absolutePath)),
    files: results
  };
}

module.exports = {
  ensureProjectFilesStored,
  getCommonContainingDirectory,
  getProjectStorageRoot,
  importProjectFiles,
  isPathInsideRoot,
  migrateProjectStorageRoot,
  normalizeRelativeFilePath,
  sanitizePathSegment
};
