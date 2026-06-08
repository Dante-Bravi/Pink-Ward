const { existsSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

if (process.platform !== 'win32') {
  process.exit(0);
}

const projectDir = path.resolve(__dirname, '..');
const rceditPath = path.join(__dirname, 'rcedit-x64.exe');
const electronPath = path.join(projectDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const iconPath = path.join(projectDir, 'assets', 'pink-ward-icon.ico');

for (const requiredPath of [rceditPath, electronPath, iconPath]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Required development icon file is missing: ${requiredPath}`);
  }
}

const result = spawnSync(
  rceditPath,
  [
    electronPath,
    '--set-icon',
    iconPath,
    '--set-version-string',
    'ProductName',
    'Pink Ward',
    '--set-version-string',
    'FileDescription',
    'Pink Ward development runtime',
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
