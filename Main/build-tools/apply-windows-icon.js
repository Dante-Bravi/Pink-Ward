const { existsSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');
const rceditPath = path.join(__dirname, 'rcedit-x64.exe');
const executablePath = path.join(projectDir, 'dist', 'win-unpacked', 'Pink Ward.exe');
const iconPath = path.join(projectDir, 'assets', 'pink-ward-icon.ico');

for (const requiredPath of [rceditPath, executablePath, iconPath]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Required build file is missing: ${requiredPath}`);
  }
}

const result = spawnSync(
  rceditPath,
  [
    executablePath,
    '--set-icon',
    iconPath,
    '--set-version-string',
    'ProductName',
    'Pink Ward',
    '--set-version-string',
    'FileDescription',
    'Pink Ward',
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
