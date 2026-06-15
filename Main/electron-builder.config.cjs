const fs = require('node:fs');
const path = require('node:path');

const projectDir = __dirname;
const runtimeDir = path.resolve(
  process.env.PINK_WARD_RUNTIME_DIR || path.join(projectDir, 'runtime', 'python')
);

if (!fs.existsSync(path.join(runtimeDir, 'python.exe'))) {
  throw new Error(
    `Bundled Python runtime is missing: ${runtimeDir}. ` +
    'Run npm run runtime:build or set PINK_WARD_RUNTIME_DIR.'
  );
}

module.exports = {
  appId: 'com.pinkward.desktop',
  productName: 'Pink Ward',
  artifactName: 'Pink-Ward-${version}-Windows-${arch}.${ext}',
  compression: 'maximum',
  asar: true,
  directories: {
    output: 'dist'
  },
  files: [
    'index.html',
    'main.js',
    'preload.js',
    'file-storage.js',
    'inference/**/*',
    'scripts/extract_video_frames.py',
    'scripts/run_yolo_training.py',
    'assets/**/*'
  ],
  asarUnpack: [
    'inference/**/*',
    'scripts/**/*.py'
  ],
  extraResources: [
    {
      from: runtimeDir,
      to: 'runtime/python',
      filter: ['**/*']
    },
    {
      from: 'yolov8n.pt',
      to: 'models/yolov8n.pt'
    },
    {
      from: 'yolo26n.pt',
      to: 'models/yolo26n.pt'
    }
  ],
  afterPack: 'build-tools/after-pack.js',
  win: {
    icon: 'assets/pink-ward-icon.ico',
    requestedExecutionLevel: 'asInvoker',
    signAndEditExecutable: false,
    target: [
      {
        target: '7z',
        arch: ['x64']
      }
    ]
  }
};
