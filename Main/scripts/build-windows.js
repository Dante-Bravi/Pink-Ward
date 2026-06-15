const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..');
const runtimeDir = path.resolve(
  process.env.PINK_WARD_RUNTIME_DIR || path.join(projectDir, 'runtime', 'python')
);
const pythonPath = path.join(runtimeDir, 'python.exe');
const distDir = path.join(projectDir, 'dist');
const dirOnly = process.argv.includes('--dir');
const githubReleaseFileLimit = 2 * 1024 * 1024 * 1024;
const sevenZipPath = path.join(
  projectDir,
  'node_modules',
  '7zip-bin',
  'win',
  'x64',
  '7za.exe'
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    env: {
      ...process.env,
      PINK_WARD_RUNTIME_DIR: runtimeDir
    },
    stdio: 'inherit',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? 1}.`);
  }
}

function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

if (!fs.existsSync(pythonPath)) {
  throw new Error(
    `Bundled Python runtime is missing: ${pythonPath}. ` +
    'Run npm run runtime:build or set PINK_WARD_RUNTIME_DIR.'
  );
}

run(pythonPath, [
  '-c',
  [
    'import cv2, numpy, torch, ultralytics',
    'assert torch.version.cuda, "The packaged PyTorch runtime is not CUDA-enabled"',
    'print("Python runtime OK")',
    'print("torch", torch.__version__)',
    'print("ultralytics", ultralytics.__version__)',
    'print("opencv", cv2.__version__)',
    'print("numpy", numpy.__version__)'
  ].join('; ')
]);

fs.rmSync(distDir, { recursive: true, force: true });

const builderPath = path.join(
  projectDir,
  'node_modules',
  'electron-builder',
  'out',
  'cli',
  'cli.js'
);
const targets = dirOnly ? ['--win', 'dir', '--x64'] : ['--win', '7z', '--x64'];

run(process.execPath, [
  builderPath,
  '--config',
  'electron-builder.config.cjs',
  ...targets
]);

if (!dirOnly) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')
  );
  const portableArchiveName = `Pink-Ward-${packageJson.version}-Windows-x64.7z`;
  const portableArchivePath = path.join(distDir, portableArchiveName);
  const installerArchivePath = path.join(
    distDir,
    `Pink-Ward-Installer-${packageJson.version}-Windows-x64.zip`
  );
  const installerKitDir = path.join(distDir, '.installer-kit');

  if (!fs.existsSync(portableArchivePath)) {
    throw new Error(`The portable CUDA archive is missing: ${portableArchivePath}`);
  }

  fs.mkdirSync(installerKitDir, { recursive: true });
  fs.copyFileSync(portableArchivePath, path.join(installerKitDir, portableArchiveName));
  fs.copyFileSync(sevenZipPath, path.join(installerKitDir, '7za.exe'));

  for (const scriptName of [
    'Install-Pink-Ward.cmd',
    'Install-Pink-Ward.ps1',
    'Uninstall-Pink-Ward.cmd',
    'Uninstall-Pink-Ward.ps1'
  ]) {
    const sourcePath = path.join(projectDir, 'installer', scriptName);
    const destinationPath = path.join(installerKitDir, scriptName);

    if (scriptName.endsWith('.ps1')) {
      const scriptText = fs.readFileSync(sourcePath, 'utf8')
        .replaceAll('__PINK_WARD_VERSION__', packageJson.version);
      fs.writeFileSync(destinationPath, scriptText);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }

  run(
    sevenZipPath,
    [
      'a',
      '-tzip',
      '-mx=0',
      installerArchivePath,
      '*'
    ],
    { cwd: installerKitDir }
  );
  fs.rmSync(installerKitDir, { recursive: true, force: true });

  const artifactPaths = fs.readdirSync(distDir)
    .filter((name) => /\.(7z|zip)$/i.test(name))
    .map((name) => path.join(distDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort();

  if (!artifactPaths.length) {
    throw new Error('The Windows build completed without producing release artifacts.');
  }

  const oversizedArtifact = artifactPaths.find(
    (filePath) => fs.statSync(filePath).size >= githubReleaseFileLimit
  );
  if (oversizedArtifact) {
    throw new Error(
      `${path.basename(oversizedArtifact)} exceeds GitHub's 2 GiB per-file release limit.`
    );
  }

  const artifacts = artifactPaths.map((filePath) => ({
    file: path.basename(filePath),
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath)
  }));
  const checksumText = artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.file}`)
    .join('\n');

  fs.writeFileSync(path.join(distDir, 'SHA256SUMS.txt'), `${checksumText}\n`);
  fs.writeFileSync(
    path.join(distDir, 'release-manifest.json'),
    `${JSON.stringify({
      product: 'Pink Ward',
      version: packageJson.version,
      platform: 'Windows 10/11',
      architecture: 'x64',
      runtime: 'Bundled Python, CUDA 12.6 PyTorch, and YOLO dependencies',
      artifacts
    }, null, 2)}\n`
  );
}
