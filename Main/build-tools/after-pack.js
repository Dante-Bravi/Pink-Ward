const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const projectDir = path.resolve(__dirname, '..');
  const rceditPath = path.join(__dirname, 'rcedit-x64.exe');
  const executablePath = path.join(context.appOutDir, 'Pink Ward.exe');
  const iconPath = path.join(projectDir, 'assets', 'pink-ward-icon.ico');
  const version = context.packager.appInfo.version;

  for (const requiredPath of [rceditPath, executablePath, iconPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Required Windows build file is missing: ${requiredPath}`);
    }
  }

  const result = spawnSync(
    rceditPath,
    [
      executablePath,
      '--set-icon',
      iconPath,
      '--set-file-version',
      version,
      '--set-product-version',
      version,
      '--set-version-string',
      'ProductName',
      'Pink Ward',
      '--set-version-string',
      'FileDescription',
      'Pink Ward',
      '--set-version-string',
      'CompanyName',
      'Pink Ward'
    ],
    { stdio: 'inherit' }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`rcedit exited with code ${result.status ?? 1}.`);
  }
};
