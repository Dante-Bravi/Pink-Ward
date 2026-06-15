const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ensureProjectFilesStored,
  getCommonContainingDirectory,
  getProjectStorageRoot,
  importProjectFiles,
  isPathInsideRoot,
  migrateProjectStorageRoot,
  normalizeRelativeFilePath,
  sanitizePathSegment
} = require('../file-storage');

async function createTestRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pink-ward-storage-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('normalizes imported paths without allowing parent traversal', () => {
  assert.equal(
    normalizeRelativeFilePath('../../dataset/../images/cat?.jpg', 'fallback.jpg'),
    path.join('dataset', 'images', 'cat-.jpg')
  );
  assert.equal(sanitizePathSegment('CON.txt'), '_CON.txt');
});

test('detects whether a file is inside Pink Ward storage', () => {
  const root = path.resolve('C:\\PinkWard');
  assert.equal(isPathInsideRoot(root, path.join(root, 'project-data', 'file.jpg')), true);
  assert.equal(isPathInsideRoot(root, path.resolve('C:\\External\\file.jpg')), false);
});

test('finds the shared internal folder for a batch', () => {
  const root = path.resolve('C:\\PinkWard\\project-data\\project-1\\batch');
  assert.equal(
    getCommonContainingDirectory([
      path.join(root, 'images', 'one.jpg'),
      path.join(root, 'labels', 'one.txt')
    ]),
    root
  );
});

test('copy imports files into project storage and keeps the source', async (t) => {
  const root = await createTestRoot(t);
  const sourcePath = path.join(root, 'source', 'image.jpg');
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, 'copy me');

  const result = await importProjectFiles({
    userDataPath: path.join(root, 'user-data'),
    projectId: 'project-1',
    category: 'training-data',
    importName: 'cats',
    mode: 'copy',
    files: [{
      sourcePath,
      name: 'image.jpg',
      relativePath: 'cats/images/image.jpg',
      type: 'image/jpeg'
    }]
  });

  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'copy me');
  assert.equal(await fs.readFile(result.files[0].absolutePath, 'utf8'), 'copy me');
  assert.equal(result.files[0].relativePath, 'cats/images/image.jpg');
  assert.equal(result.files[0].storageMode, 'copy');
  assert.ok(result.files[0].absolutePath.startsWith(getProjectStorageRoot(path.join(root, 'user-data'), 'project-1')));
});

test('uses the project name for the visible storage folder', () => {
  assert.equal(
    getProjectStorageRoot('C:\\PinkWard', 'project-123', 'My Project'),
    path.join('C:\\PinkWard', 'project-data', 'My Project')
  );
});

test('migrates an id-named project folder to the project name', async (t) => {
  const root = await createTestRoot(t);
  const userDataPath = path.join(root, 'user-data');
  const legacyRoot = getProjectStorageRoot(userDataPath, 'project-123');
  const legacyFile = path.join(legacyRoot, 'training-data', 'image.jpg');
  await fs.mkdir(path.dirname(legacyFile), { recursive: true });
  await fs.writeFile(legacyFile, 'legacy project file');

  const migration = await migrateProjectStorageRoot(
    userDataPath,
    'project-123',
    'Visible Project Name'
  );

  const migratedFile = path.join(migration.projectRoot, 'training-data', 'image.jpg');
  assert.equal(migration.migrated, true);
  assert.equal(await fs.readFile(migratedFile, 'utf8'), 'legacy project file');
  await assert.rejects(fs.access(legacyRoot));
});

test('does not remove legacy storage when the named folder has a conflicting file', async (t) => {
  const root = await createTestRoot(t);
  const userDataPath = path.join(root, 'user-data');
  const legacyRoot = getProjectStorageRoot(userDataPath, 'project-123');
  const projectRoot = getProjectStorageRoot(userDataPath, 'project-123', 'Visible Project Name');
  const relativeFilePath = path.join('training-data', 'image.jpg');
  const legacyFile = path.join(legacyRoot, relativeFilePath);
  const projectFile = path.join(projectRoot, relativeFilePath);
  await fs.mkdir(path.dirname(legacyFile), { recursive: true });
  await fs.mkdir(path.dirname(projectFile), { recursive: true });
  await fs.writeFile(legacyFile, 'legacy project file');
  await fs.writeFile(projectFile, 'existing named project file');

  await assert.rejects(
    migrateProjectStorageRoot(userDataPath, 'project-123', 'Visible Project Name')
  );

  assert.equal(await fs.readFile(legacyFile, 'utf8'), 'legacy project file');
  assert.equal(await fs.readFile(projectFile, 'utf8'), 'existing named project file');
});

test('move imports files into project storage and removes the source', async (t) => {
  const root = await createTestRoot(t);
  const sourcePath = path.join(root, 'source', 'video.mp4');
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, 'move me');

  const result = await importProjectFiles({
    userDataPath: path.join(root, 'user-data'),
    projectId: 'project-2',
    projectName: 'Video Project',
    category: 'inference-sources',
    importName: 'video',
    mode: 'move',
    files: [{
      sourcePath,
      name: 'video.mp4',
      relativePath: 'video.mp4',
      type: 'video/mp4'
    }]
  });

  await assert.rejects(fs.access(sourcePath));
  assert.equal(await fs.readFile(result.files[0].absolutePath, 'utf8'), 'move me');
  assert.equal(result.files[0].storageMode, 'move');
});

test('failed multi-file moves restore files already transferred', async (t) => {
  const root = await createTestRoot(t);
  const firstSourcePath = path.join(root, 'source', 'first.txt');
  const missingSourcePath = path.join(root, 'source', 'missing.txt');
  await fs.mkdir(path.dirname(firstSourcePath), { recursive: true });
  await fs.writeFile(firstSourcePath, 'restore me');

  await assert.rejects(
    importProjectFiles({
      userDataPath: path.join(root, 'user-data'),
      projectId: 'project-3',
      category: 'training-data',
      importName: 'rollback',
      mode: 'move',
      files: [
        {
          sourcePath: firstSourcePath,
          name: 'first.txt',
          relativePath: 'first.txt',
          type: 'text/plain'
        },
        {
          sourcePath: missingSourcePath,
          name: 'missing.txt',
          relativePath: 'missing.txt',
          type: 'text/plain'
        }
      ]
    })
  );

  assert.equal(await fs.readFile(firstSourcePath, 'utf8'), 'restore me');
});

test('legacy external files are copied into storage while internal files are reused', async (t) => {
  const root = await createTestRoot(t);
  const userDataPath = path.join(root, 'user-data');
  const internalPath = path.join(userDataPath, 'inference-runs', 'existing.mp4');
  const externalPath = path.join(root, 'external', 'legacy.jpg');
  await fs.mkdir(path.dirname(internalPath), { recursive: true });
  await fs.mkdir(path.dirname(externalPath), { recursive: true });
  await fs.writeFile(internalPath, 'internal');
  await fs.writeFile(externalPath, 'legacy');

  const result = await ensureProjectFilesStored({
    userDataPath,
    projectId: 'project-legacy',
    category: 'legacy-data',
    importName: 'old-batch',
    files: [
      {
        name: 'existing.mp4',
        relativePath: 'existing.mp4',
        absolutePath: internalPath,
        type: 'video/mp4'
      },
      {
        name: 'legacy.jpg',
        relativePath: 'images/legacy.jpg',
        absolutePath: externalPath,
        type: 'image/jpeg',
        trainedByModelIds: ['model-1']
      }
    ]
  });

  assert.equal(result.migrated, true);
  assert.equal(result.files[0].absolutePath, internalPath);
  assert.equal(await fs.readFile(result.files[1].absolutePath, 'utf8'), 'legacy');
  assert.equal(await fs.readFile(externalPath, 'utf8'), 'legacy');
  assert.equal(isPathInsideRoot(userDataPath, result.files[1].absolutePath), true);
  assert.deepEqual(result.files[1].trainedByModelIds, ['model-1']);
});
