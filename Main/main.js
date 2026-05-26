const { app, BrowserWindow, ipcMain, nativeImage, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');

let mainWindow;
const storeFileName = 'pink-ward-projects.json';
const execFileAsync = promisify(execFile);
let cachedPythonExecutable = null;

function getStorePath() {
  return path.join(app.getPath('userData'), storeFileName);
}

function getInferenceScriptPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'inference', 'run_yolo_inference.py');
  }

  return path.join(__dirname, 'inference', 'run_yolo_inference.py');
}

function getBundledPythonPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtime', 'python', 'python.exe');
  }

  return path.join(__dirname, 'runtime', 'python', 'python.exe');
}

function getProcessWorkingDirectory() {
  return app.isPackaged ? process.resourcesPath : __dirname;
}

function emptyStore() {
  return {
    activeProjectId: null,
    projects: []
  };
}

async function readProjectStore() {
  try {
    const contents = await fs.readFile(getStorePath(), 'utf8');
    const store = JSON.parse(contents);

    return {
      activeProjectId: store.activeProjectId || null,
      projects: Array.isArray(store.projects) ? store.projects : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return emptyStore();
    }

    throw error;
  }
}

async function writeProjectStore(store) {
  await fs.mkdir(path.dirname(getStorePath()), { recursive: true });
  await fs.writeFile(getStorePath(), JSON.stringify(store, null, 2));
  return store;
}

function sanitizeFileName(value) {
  return String(value || 'inference-run')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'inference-run';
}

function getPrimaryJson(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch (_error) {
      // Ignore non-JSON output from imported libraries.
    }
  }

  return null;
}

async function enrichInferenceResult(result) {
  const outputFiles = Array.isArray(result?.outputFiles) ? result.outputFiles : [];
  const existingDetails = Array.isArray(result?.outputFileDetails) ? result.outputFileDetails : [];
  const detailByPath = new Map(existingDetails.map((detail) => [detail.path, detail]));
  const outputFileDetails = [];

  for (const filePath of outputFiles) {
    const existing = detailByPath.get(filePath) || {};

    try {
      const stat = await fs.stat(filePath);
      outputFileDetails.push({
        ...existing,
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        lastModified: Math.round(stat.mtimeMs)
      });
    } catch (_error) {
      outputFileDetails.push({
        ...existing,
        path: filePath,
        name: path.basename(filePath),
        size: Number(existing.size || 0),
        lastModified: Number(existing.lastModified || Date.now())
      });
    }
  }

  return {
    ...result,
    outputFileDetails
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function getPyenvPythonCandidates() {
  if (process.platform !== 'win32') {
    return [];
  }

  const versionsRoot = path.join(os.homedir(), '.pyenv', 'pyenv-win', 'versions');

  try {
    const entries = await fs.readdir(versionsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(versionsRoot, entry.name, 'python.exe'))
      .sort()
      .reverse();
  } catch (_error) {
    return [];
  }
}

async function getPythonCandidates() {
  const candidates = [
    getBundledPythonPath(),
    process.env.PINK_WARD_PYTHON,
    process.env.PYTHON,
    'python',
    'python.exe',
    'python3',
    'python3.exe'
  ];

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(
      ...await getPyenvPythonCandidates(),
      path.join(localAppData, 'Python', 'bin', 'python.exe'),
      path.join(localAppData, 'Python', 'pythoncore-3.14-64', 'python.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python314', 'python.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python313', 'python.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe')
    );
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function resolvePythonExecutable() {
  if (cachedPythonExecutable && await pathExists(cachedPythonExecutable)) {
    return cachedPythonExecutable;
  }

  cachedPythonExecutable = null;
  const candidates = await getPythonCandidates();

  for (const candidate of candidates) {
    const isPath = candidate.includes(path.sep) || (process.platform === 'win32' && /^[A-Za-z]:/.test(candidate));

    if (isPath && !await pathExists(candidate)) {
      continue;
    }

    try {
      await execFileAsync(candidate, ['-c', 'import sys; print(sys.executable)'], {
        cwd: getProcessWorkingDirectory(),
        windowsHide: true,
        timeout: 10000
      });
      cachedPythonExecutable = candidate;
      return candidate;
    } catch (_error) {
      // Try the next known Python location.
    }
  }

  throw new Error('Python was not found. Install Python, or set PINK_WARD_PYTHON to the full path of python.exe.');
}

async function runPythonInference(payload) {
  const modelPath = String(payload?.modelPath || '').trim();
  const sourcePath = String(payload?.sourcePath || '').trim();
  const runName = sanitizeFileName(payload?.runName);
  const confidence = Number.isFinite(Number(payload?.confidence)) ? Number(payload.confidence) : 0.25;
  const shouldDisplay = Boolean(payload?.display);

  if (!modelPath) {
    throw new Error('Model path is required.');
  }

  if (!sourcePath) {
    throw new Error('Source path is required.');
  }

  await fs.access(modelPath);
  await fs.access(sourcePath);

  const outputDir = path.join(app.getPath('userData'), 'inference-runs', `${Date.now()}-${runName}`);
  await fs.mkdir(outputDir, { recursive: true });

  const args = [
    getInferenceScriptPath(),
    '--model',
    modelPath,
    '--source',
    sourcePath,
    '--output-dir',
    outputDir,
    '--conf',
    String(confidence)
  ];

  if (shouldDisplay) {
    args.push('--display');
    args.push('--stream-json');
  }

  const pythonExecutable = await resolvePythonExecutable();

  try {
    const { stdout, stderr } = await execFileAsync(pythonExecutable, args, {
      cwd: getProcessWorkingDirectory(),
      windowsHide: !shouldDisplay,
      maxBuffer: 1024 * 1024 * 32,
      timeout: 1000 * 60 * 60 * 4
    });
    const result = getPrimaryJson(stdout);

    if (!result?.ok) {
      throw new Error(result?.error || stderr || 'Inference finished without a usable result.');
    }

    return enrichInferenceResult(result);
  } catch (error) {
    const parsed = getPrimaryJson(error.stdout);
    throw new Error(parsed?.error || error.stderr || error.message || 'Inference failed.');
  }
}

function runStreamingPythonInference(payload, webContents) {
  return new Promise(async (resolve, reject) => {
    const modelPath = String(payload?.modelPath || '').trim();
    const sourcePath = String(payload?.sourcePath || '').trim();
    const runName = sanitizeFileName(payload?.runName);
    const confidence = Number.isFinite(Number(payload?.confidence)) ? Number(payload.confidence) : 0.25;
    const runId = String(payload?.runId || '');

    if (!modelPath) {
      reject(new Error('Model path is required.'));
      return;
    }

    if (!sourcePath) {
      reject(new Error('Source path is required.'));
      return;
    }

    try {
      await fs.access(modelPath);
      await fs.access(sourcePath);
    } catch (error) {
      reject(error);
      return;
    }

    const outputDir = path.join(app.getPath('userData'), 'inference-runs', `${Date.now()}-${runName}`);
    await fs.mkdir(outputDir, { recursive: true });

    const args = [
      getInferenceScriptPath(),
      '--model',
      modelPath,
      '--source',
      sourcePath,
      '--output-dir',
      outputDir,
      '--conf',
      String(confidence),
      '--display',
      '--stream-json'
    ];
    const pythonExecutable = await resolvePythonExecutable();
    const child = spawn(pythonExecutable, args, {
      cwd: getProcessWorkingDirectory(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    webContents.send('inference:frame', {
      runId,
      event: 'progress',
      progress: 0.002,
      resultCount: 0,
      totalFrames: 0,
      detectionCount: 0,
      status: 'Python inference process started.'
    });
    let stdoutBuffer = '';
    let stderr = '';
    let finalResult = null;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const event = JSON.parse(line);

          if (event.event === 'frame' || event.event === 'progress') {
            webContents.send('inference:frame', { runId, ...event });
          } else if (event.ok !== undefined) {
            finalResult = event;
          }
        } catch (_error) {
          stderr += `${line}\n`;
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        try {
          const event = JSON.parse(stdoutBuffer.trim());

          if (event.ok !== undefined) {
            finalResult = event;
          }
        } catch (_error) {
          stderr += stdoutBuffer;
        }
      }

      if (code !== 0 || !finalResult?.ok) {
        reject(new Error(finalResult?.error || stderr || `Inference exited with code ${code}.`));
        return;
      }

      enrichInferenceResult(finalResult).then(resolve, reject);
    });
  });
}

function createProjectRecord(input) {
  const now = new Date().toISOString();
  const id = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    name: String(input.name || '').trim(),
    type: String(input.type || 'Object detection').trim(),
    datasetSource: String(input.datasetSource || 'Not selected').trim(),
    modelBase: String(input.modelBase || 'Not selected').trim(),
    notes: String(input.notes || '').trim(),
    trainingType: String(input.trainingType || 'detection').trim(),
    status: 'No data',
    createdAt: now,
    updatedAt: now,
    data: {
      training: [],
      inference: []
    },
    models: [],
    trash: []
  };
}

function normalizeRuntimeProjectState(project) {
  let changed = false;
  const inferenceRuns = Array.isArray(project.inferenceRuns) ? project.inferenceRuns : [];

  project.inferenceRuns = inferenceRuns.map((run) => {
    if (String(run?.result || '').toLowerCase() !== 'running') {
      return run;
    }

    changed = true;
    return {
      ...run,
      result: 'Interrupted',
      finishedAt: run.finishedAt || new Date().toISOString(),
      error: run.error || 'The app closed before this inference run finished.'
    };
  });

  return changed;
}

function getPreviewMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.png') {
    return 'image/png';
  }

  if (extension === '.apng') {
    return 'image/apng';
  }

  if (extension === '.avif') {
    return 'image/avif';
  }

  if (extension === '.gif') {
    return 'image/gif';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  if (extension === '.bmp') {
    return 'image/bmp';
  }

  return null;
}

async function getWindowsShellThumbnail(filePath) {
  if (process.platform !== 'win32') {
    return null;
  }

  const outputPath = path.join(app.getPath('temp') || os.tmpdir(), `pink-ward-thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct SIZE {
  public int cx;
  public int cy;
}

[Flags]
public enum SIIGBF {
  RESIZETOFIT = 0x00000000,
  BIGGERSIZEOK = 0x00000001
}

[ComImport]
[Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemImageFactory {
  void GetImage(SIZE size, SIIGBF flags, out IntPtr phbm);
}

public static class ShellThumb {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
    IntPtr pbc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

  [DllImport("gdi32.dll")]
  private static extern bool DeleteObject(IntPtr hObject);

  public static void Save(string input, string output, int size) {
    var iid = typeof(IShellItemImageFactory).GUID;
    IShellItemImageFactory factory;
    SHCreateItemFromParsingName(input, IntPtr.Zero, iid, out factory);
    var requestedSize = new SIZE { cx = size, cy = size };
    IntPtr bitmapHandle;
    factory.GetImage(requestedSize, SIIGBF.BIGGERSIZEOK, out bitmapHandle);

    try {
      using (var bitmap = Image.FromHbitmap(bitmapHandle)) {
        bitmap.Save(output, ImageFormat.Png);
      }
    } finally {
      DeleteObject(bitmapHandle);
    }
  }
}
'@
[ShellThumb]::Save($args[0], $args[1], 256)
`;

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
      filePath,
      outputPath
    ], { windowsHide: true, timeout: 15000 });

    const bytes = await fs.readFile(outputPath);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch (_error) {
    return null;
  } finally {
    await fs.unlink(outputPath).catch(() => {});
  }
}

async function getVideoFrameThumbnail(filePath) {
  const videoUrl = pathToFileURL(filePath).href;
  const captureWindow = new BrowserWindow({
    width: 640,
    height: 360,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      webSecurity: false
    }
  });

  try {
    await captureWindow.loadURL('data:text/html,<html><body></body></html>');
    return await captureWindow.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        let settled = false;
        const timeout = setTimeout(() => finish(null, 'Timed out while decoding the video.'), 12000);

        function finish(value, error) {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          video.removeAttribute('src');
          video.load();

          if (error) {
            reject(new Error(error));
          } else {
            resolve(value);
          }
        }

        function captureFrame() {
          const width = video.videoWidth;
          const height = video.videoHeight;

          if (!width || !height) {
            finish(null, 'The video did not expose a drawable frame.');
            return;
          }

          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');

          if (!context) {
            finish(null, 'Could not create the thumbnail canvas.');
            return;
          }

          context.drawImage(video, 0, 0, width, height);
          finish(canvas.toDataURL('image/png'));
        }

        video.muted = true;
        video.preload = 'auto';
        video.playsInline = true;
        video.addEventListener('error', () => {
          const code = video.error ? video.error.code : 'unknown';
          finish(null, 'Could not decode the video. Media error: ' + code);
        }, { once: true });
        video.addEventListener('loadedmetadata', () => {
          const duration = Number.isFinite(video.duration) ? video.duration : 0;
          const targetTime = Math.min(Math.max(duration * 0.08, 0.2), 2);

          if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.05) {
            video.currentTime = targetTime;
          } else {
            captureFrame();
          }
        }, { once: true });
        video.addEventListener('seeked', captureFrame, { once: true });
        video.addEventListener('loadeddata', () => {
          if (!Number.isFinite(video.duration) || video.duration === 0) {
            captureFrame();
          }
        }, { once: true });
        video.src = ${JSON.stringify(videoUrl)};
        video.load();
      });
    `, true);
  } finally {
    if (!captureWindow.isDestroyed()) {
      captureWindow.destroy();
    }
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#f4f7fa',
    frame: false,
    show: false,
    title: 'Pink Ward',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('window:action', (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window) {
    return false;
  }

  if (action === 'minimize') {
    window.minimize();
    return true;
  }

  if (action === 'maximize') {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return window.isMaximized();
  }

  if (action === 'close') {
    window.close();
    return true;
  }

  return false;
});

ipcMain.handle('projects:list', async () => {
  const store = await readProjectStore();
  const changed = store.projects.some(normalizeRuntimeProjectState);

  if (changed) {
    await writeProjectStore(store);
  }

  return store;
});

ipcMain.handle('projects:create', async (_event, input) => {
  const project = createProjectRecord(input || {});

  if (!project.name) {
    throw new Error('Project name is required.');
  }

  const store = await readProjectStore();
  store.projects.unshift(project);
  store.activeProjectId = project.id;
  await writeProjectStore(store);
  return store;
});

ipcMain.handle('projects:update', async (_event, project) => {
  if (!project?.id) {
    throw new Error('Project id is required.');
  }

  const store = await readProjectStore();
  const projectIndex = store.projects.findIndex((candidate) => candidate.id === project.id);

  if (projectIndex === -1) {
    throw new Error('Project was not found.');
  }

  store.projects[projectIndex] = {
    ...store.projects[projectIndex],
    ...project,
    updatedAt: new Date().toISOString()
  };
  store.activeProjectId = project.id;
  await writeProjectStore(store);
  return store;
});

ipcMain.handle('files:preview', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required.');
  }

  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.txt') {
    const text = await fs.readFile(filePath, 'utf8');
    return {
      kind: 'text',
      text
    };
  }

  const mimeType = getPreviewMimeType(filePath);

  if (!mimeType) {
    throw new Error('Preview is only available for images and text labels.');
  }

  const bytes = await fs.readFile(filePath);
  return {
    kind: 'image',
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`
  };
});

ipcMain.handle('files:thumbnail', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required.');
  }

  const windowsShellThumbnail = await getWindowsShellThumbnail(filePath);

  if (windowsShellThumbnail) {
    return windowsShellThumbnail;
  }

  const thumbnail = await nativeImage.createThumbnailFromPath(filePath, {
    width: 256,
    height: 256
  });

  if (thumbnail.isEmpty()) {
    return null;
  }

  return thumbnail.toDataURL();
});

ipcMain.handle('files:video-frame', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required.');
  }

  return getVideoFrameThumbnail(filePath);
});

ipcMain.handle('inference:run', async (_event, payload) => {
  if (payload?.display) {
    return runStreamingPythonInference(payload || {}, _event.sender);
  }

  return runPythonInference(payload || {});
});

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
