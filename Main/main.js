const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require('electron');
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
const activeInferenceProcesses = new Map();
const canceledInferenceRuns = new Set();
const activeTrainingProcesses = new Map();
const canceledTrainingRuns = new Set();
let allowCloseWithActiveTraining = false;

function getStorePath() {
  return path.join(app.getPath('userData'), storeFileName);
}

function getInferenceScriptPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'inference', 'run_yolo_inference.py');
  }

  return path.join(__dirname, 'inference', 'run_yolo_inference.py');
}

function getExtractFramesScriptPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'extract_video_frames.py');
  }

  return path.join(__dirname, 'scripts', 'extract_video_frames.py');
}

function getTrainingScriptPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'run_yolo_training.py');
  }

  return path.join(__dirname, 'scripts', 'run_yolo_training.py');
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

function getAppIconPath() {
  return path.join(__dirname, 'assets', 'pink-ward-icon.ico');
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

async function makeUniqueDirectory(rootPath, desiredName) {
  const sanitizedName = sanitizeFileName(desiredName).slice(0, 120) || 'Extracted frames';
  let candidateName = sanitizedName;
  let attempt = 2;

  while (true) {
    const candidatePath = path.join(rootPath, candidateName);

    try {
      await fs.mkdir(candidatePath);
      return candidatePath;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      candidateName = `${sanitizedName} (${attempt})`;
      attempt += 1;
    }
  }
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

function encodeWindows1252Byte(character) {
  const code = character.codePointAt(0);
  const cp1252 = new Map([
    [0x20AC, 0x80],
    [0x201A, 0x82],
    [0x0192, 0x83],
    [0x201E, 0x84],
    [0x2026, 0x85],
    [0x2020, 0x86],
    [0x2021, 0x87],
    [0x02C6, 0x88],
    [0x2030, 0x89],
    [0x0160, 0x8A],
    [0x2039, 0x8B],
    [0x0152, 0x8C],
    [0x017D, 0x8E],
    [0x2018, 0x91],
    [0x2019, 0x92],
    [0x201C, 0x93],
    [0x201D, 0x94],
    [0x2022, 0x95],
    [0x2013, 0x96],
    [0x2014, 0x97],
    [0x02DC, 0x98],
    [0x2122, 0x99],
    [0x0161, 0x9A],
    [0x203A, 0x9B],
    [0x0153, 0x9C],
    [0x017E, 0x9E],
    [0x0178, 0x9F]
  ]);

  if (code <= 0xFF) {
    return code;
  }

  return cp1252.get(code) ?? null;
}

function repairUtf8Mojibake(value) {
  const text = String(value || '');

  if (!/[ÃÂâ]/.test(text)) {
    return text;
  }

  const bytes = [];

  for (const character of text) {
    const byte = encodeWindows1252Byte(character);

    if (byte === null) {
      return text;
    }

    bytes.push(byte);
  }

  try {
    const repaired = Buffer.from(bytes).toString('utf8');
    return repaired.includes('\uFFFD') ? text : repaired;
  } catch (_error) {
    return text;
  }
}

async function resolveExistingFilePath(filePath) {
  const candidates = [
    String(filePath || ''),
    repairUtf8Mojibake(filePath)
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (_error) {
      // Try the next spelling of the same path.
    }
  }

  return String(filePath || '');
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

async function getCudaAvailability() {
  const fallback = { available: false, source: 'none', error: '' };

  async function probeWithNvidiaSmi() {
    const candidates = process.platform === 'win32'
      ? [
          'nvidia-smi',
          path.join(process.env.ProgramW6432 || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
        ]
      : ['nvidia-smi'];

    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];

    for (const candidate of uniqueCandidates) {
      try {
        const { stdout } = await execFileAsync(candidate, ['--query-gpu=name,driver_version,cuda_version', '--format=csv,noheader'], {
          cwd: getProcessWorkingDirectory(),
          windowsHide: true,
          timeout: 9000
        });

        const firstLine = String(stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);

        if (firstLine) {
          return {
            available: true,
            source: 'nvidia-smi',
            error: '',
            details: firstLine
          };
        }
      } catch (_error) {
        // Try the next candidate path.
      }
    }

    return null;
  }

  try {
    const pythonExecutable = await resolvePythonExecutable();
    const probeScript = [
      'import json',
      'result = {"torchInstalled": False, "torchCudaAvailable": False, "cudaVersion": "", "deviceCount": 0, "error": ""}',
      'try:',
      '    import torch',
      '    result["torchInstalled"] = True',
      '    result["torchCudaAvailable"] = bool(torch.cuda.is_available())',
      '    result["cudaVersion"] = str(torch.version.cuda or "")',
      '    result["deviceCount"] = int(torch.cuda.device_count()) if result["torchCudaAvailable"] else 0',
      'except Exception as exc:',
      '    result["error"] = str(exc)',
      'print(json.dumps(result))'
    ].join('\n');
    const { stdout } = await execFileAsync(pythonExecutable, ['-c', probeScript], {
      cwd: getProcessWorkingDirectory(),
      windowsHide: true,
      timeout: 12000
    });
    const parsed = getPrimaryJson(stdout);

    if (parsed && typeof parsed.torchCudaAvailable === 'boolean') {
      if (parsed.torchCudaAvailable) {
        return {
          available: true,
          source: 'torch',
          error: '',
          details: parsed.cudaVersion ? `PyTorch CUDA ${parsed.cudaVersion}` : 'PyTorch CUDA runtime detected'
        };
      }

      const smiProbe = await probeWithNvidiaSmi();
      if (smiProbe?.available) {
        return smiProbe;
      }

      return {
        available: false,
        source: 'torch',
        error: typeof parsed.error === 'string' ? parsed.error : ''
      };
    }

    const smiProbe = await probeWithNvidiaSmi();
    if (smiProbe?.available) {
      return smiProbe;
    }

    return {
      ...fallback,
      error: 'CUDA probe returned an unreadable response from both probes.'
    };
  } catch (error) {
    const smiProbe = await probeWithNvidiaSmi();
    if (smiProbe?.available) {
      return smiProbe;
    }

    return {
      ...fallback,
      error: error?.message || 'CUDA probe failed.'
    };
  }
}

async function runPythonInference(payload) {
  const modelPath = String(payload?.modelPath || '').trim();
  const sourcePath = String(payload?.sourcePath || '').trim();
  const runName = sanitizeFileName(payload?.runName);
  const confidence = Number.isFinite(Number(payload?.confidence)) ? Number(payload.confidence) : 0.25;
  const shouldDisplay = Boolean(payload?.display);
  const enableTracker = payload?.enableTracker === true;

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

  if (enableTracker) {
    args.push('--enable-tracker');
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

function sendTrainingProgress(webContents, payload) {
  if (!webContents || webContents.isDestroyed?.()) {
    return;
  }

  webContents.send('training:progress', payload);
}

async function runPythonTraining(payload, webContents) {
  const runId = String(payload?.runId || `training-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).trim();
  const requestedModel = String(payload?.model || '').trim();
  const requestedModelName = String(payload?.modelName || '').trim();
  const runName = sanitizeFileName(payload?.runName || requestedModelName || 'training-run');
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const hyperparams = payload?.hyperparams && typeof payload.hyperparams === 'object'
    ? payload.hyperparams
    : {};

  if (!requestedModel) {
    throw new Error('Training model is required.');
  }
  if (!requestedModelName) {
    throw new Error('Training model name is required.');
  }

  const normalizedFiles = files
    .map((file) => ({
      name: String(file?.name || '').trim(),
      relativePath: String(file?.relativePath || '').trim(),
      absolutePath: String(file?.absolutePath || '').trim(),
      size: Number(file?.size || 0),
      type: String(file?.type || 'application/octet-stream').trim()
    }))
    .filter((file) => file.absolutePath);

  if (!normalizedFiles.length) {
    throw new Error('At least one training file is required.');
  }

  const trainingRoot = path.join(app.getPath('userData'), 'training-runs');
  const runRoot = path.join(trainingRoot, `${Date.now()}-${runName}`);
  const datasetRoot = path.join(runRoot, 'dataset');
  const modelOutputRoot = path.join(runRoot, 'output');
  const resultPath = path.join(runRoot, 'training-result.json');
  const progressPath = path.join(runRoot, 'training-progress.json');
  await fs.mkdir(runRoot, { recursive: true });
  await fs.mkdir(datasetRoot, { recursive: true });
  await fs.mkdir(modelOutputRoot, { recursive: true });

  const trainingPayload = {
    runId,
    model: requestedModel,
    modelName: requestedModelName,
    runName,
    datasetRoot,
    outputRoot: modelOutputRoot,
    files: normalizedFiles,
    hyperparams
  };
  const payloadPath = path.join(runRoot, 'training-payload.json');
  await fs.writeFile(payloadPath, JSON.stringify(trainingPayload, null, 2), 'utf8');

  const pythonExecutable = await resolvePythonExecutable();
  const args = [
    getTrainingScriptPath(),
    '--payload-json',
    payloadPath,
    '--result-json',
    resultPath,
    '--progress-json',
    progressPath
  ];
  let lastProgressText = '';
  let progressReadBusy = false;
  const readAndSendProgress = async () => {
    if (progressReadBusy) {
      return;
    }

    progressReadBusy = true;
    try {
      const progressText = await fs.readFile(progressPath, 'utf8');
      if (progressText === lastProgressText) {
        return;
      }

      lastProgressText = progressText;
      const progress = JSON.parse(progressText);
      sendTrainingProgress(webContents, {
        event: 'progress',
        ...progress,
        runId: String(progress?.runId || runId)
      });
    } catch (_error) {
      // The progress file is created by Python after training setup starts.
    } finally {
      progressReadBusy = false;
    }
  };

  try {
    sendTrainingProgress(webContents, {
      runId,
      event: 'progress',
      progress: 0,
      status: 'Training started.'
    });

    await new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable, args, {
        cwd: getProcessWorkingDirectory(),
        windowsHide: process.platform !== 'win32',
        stdio: ['ignore', 'inherit', 'inherit']
      });
      let settled = false;
      const progressTimer = setInterval(() => {
        void readAndSendProgress();
      }, 750);
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(progressTimer);
        canceledTrainingRuns.add(runId);
        activeTrainingProcesses.delete(runId);
        void stopChildProcessTree(child).finally(() => canceledTrainingRuns.delete(runId));
        reject(new Error('Training timed out.'));
      }, 1000 * 60 * 60 * 12);

      activeTrainingProcesses.set(runId, child);
      void readAndSendProgress();

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        clearInterval(progressTimer);
        activeTrainingProcesses.delete(runId);
        canceledTrainingRuns.delete(runId);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        clearInterval(progressTimer);
        activeTrainingProcesses.delete(runId);
        const wasCanceled = canceledTrainingRuns.delete(runId);
        void readAndSendProgress();

        if (wasCanceled) {
          sendTrainingProgress(webContents, {
            runId,
            event: 'progress',
            progress: 0,
            status: 'Training cancelled.',
            canceled: true
          });
          reject(new Error('Training cancelled.'));
          return;
        }

        if (code !== 0) {
          reject(new Error(`Training exited with code ${code}.`));
          return;
        }

        resolve();
      });
    });

    const resultText = await fs.readFile(resultPath, 'utf8');
    const result = JSON.parse(resultText);

    if (!result?.ok) {
      throw new Error(result?.error || 'Training finished without a usable result.');
    }

    const outputFiles = [];
    const candidatePaths = [
      result.bestModelPath,
      result.lastModelPath
    ].filter(Boolean);

    for (const filePath of candidatePaths) {
      try {
        const stat = await fs.stat(filePath);
        outputFiles.push({
          path: filePath,
          name: path.basename(filePath),
          size: stat.size,
          lastModified: Math.round(stat.mtimeMs)
        });
      } catch (_error) {
        // Ignore output files that no longer exist.
      }
    }

    let resultsCsv = null;
    if (result.resultsCsvPath) {
      try {
        const stat = await fs.stat(result.resultsCsvPath);
        resultsCsv = {
          path: result.resultsCsvPath,
          name: path.basename(result.resultsCsvPath),
          size: stat.size,
          lastModified: Math.round(stat.mtimeMs)
        };
      } catch (_error) {
        resultsCsv = null;
      }
    }

    return {
      ...result,
      outputFiles,
      resultsCsv
    };
  } catch (error) {
    if (/cancel/i.test(String(error?.message || ''))) {
      throw new Error('Training cancelled.');
    }

    let parsedError = "";
    try {
      const resultText = await fs.readFile(resultPath, 'utf8');
      const parsed = JSON.parse(resultText);
      parsedError = String(parsed?.error || "").trim();
    } catch (_readError) {
      // Fall back to the process error below.
    }

    if (!parsedError && error?.code === 'ENOENT' && error?.path === resultPath) {
      throw new Error('Training did not produce a result file.');
    }

    throw new Error(parsedError || error.message || 'Training failed.');
  }
}

async function extractVideoFrames(payload) {
  const requestedSourcePath = String(payload?.sourcePath || '').trim();
  const requestedSourceName = String(payload?.sourceName || payload?.sourceTitle || '').trim();
  const intervalSeconds = Number(payload?.intervalSeconds);
  const modelPath = String(payload?.modelPath || '').trim();
  const confidence = Number.isFinite(Number(payload?.confidence)) ? Number(payload.confidence) : 0.25;
  const runId = String(payload?.runId || '').trim();

  if (!requestedSourcePath) {
    throw new Error('Source path is required.');
  }

  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error('Interval seconds must be greater than zero.');
  }

  const sourcePath = await resolveExistingFilePath(requestedSourcePath);
  await fs.access(sourcePath);
  const sourceName = requestedSourceName || path.parse(sourcePath).name || 'Video';
  const outputRoot = path.join(app.getPath('userData'), 'extracted-frames');
  await fs.mkdir(outputRoot, { recursive: true });
  const outputDir = await makeUniqueDirectory(outputRoot, `Extracted frames from ${sourceName}`);

  const args = [
    getExtractFramesScriptPath(),
    '--source',
    sourcePath,
    '--output-dir',
    outputDir,
    '--interval-seconds',
    String(intervalSeconds)
  ];

  if (modelPath) {
    await fs.access(modelPath);
    args.push('--model');
    args.push(modelPath);
    args.push('--confidence');
    args.push(String(confidence));
  }

  const pythonExecutable = await resolvePythonExecutable();

  let result = null;
  try {
    if (runId) {
      result = await new Promise((resolve, reject) => {
        const child = spawn(pythonExecutable, args, {
          cwd: getProcessWorkingDirectory(),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        activeInferenceProcesses.set(runId, child);
        let stdoutBuffer = '';
        let stderr = '';
        let settled = false;

        const finish = (error, resolvedValue = null) => {
          if (settled) {
            return;
          }
          settled = true;
          activeInferenceProcesses.delete(runId);
          if (error) {
            reject(error);
            return;
          }
          resolve(resolvedValue);
        };

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk) => {
          stdoutBuffer += chunk;
        });

        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });

        child.on('error', (error) => {
          finish(error);
        });

        child.on('close', (code) => {
          const wasCanceled = canceledInferenceRuns.has(runId);
          canceledInferenceRuns.delete(runId);
          const parsed = getPrimaryJson(stdoutBuffer);

          if (code !== 0 || !parsed?.ok) {
            if (wasCanceled || parsed?.error === 'INFERENCE_CANCELLED') {
              finish(new Error('Frame extraction cancelled.'));
              return;
            }
            finish(new Error(parsed?.error || stderr || `Frame extraction exited with code ${code}.`));
            return;
          }

          finish(null, parsed);
        });
      });
    } else {
      const { stdout, stderr } = await execFileAsync(pythonExecutable, args, {
        cwd: getProcessWorkingDirectory(),
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 32,
        timeout: 1000 * 60 * 60
      });
      result = getPrimaryJson(stdout);

      if (!result?.ok) {
        throw new Error(result?.error || stderr || 'Frame extraction did not return a usable result.');
      }
    }
  } catch (error) {
    const parsed = getPrimaryJson(error.stdout);
    throw new Error(parsed?.error || error.stderr || error.message || 'Frame extraction failed.');
  }

  const entries = await fs.readdir(outputDir, { withFileTypes: true, recursive: true });
  const frameFiles = [];
  const labelFiles = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const fileName = entry.name;
    const parentPath = entry.parentPath || entry.path || outputDir;
    const absolutePath = path.join(parentPath, fileName);
    const relativePath = path.relative(outputDir, absolutePath).replace(/\\/g, '/');
    const stat = await fs.stat(absolutePath);
    const detail = {
      path: absolutePath,
      name: fileName,
      relativePath,
      size: stat.size,
      lastModified: Math.round(stat.mtimeMs)
    };

    if (/^images\//i.test(relativePath) && /\.(apng|avif|bmp|gif|jpe?g|png|webp)$/i.test(fileName)) {
      frameFiles.push(detail);
      continue;
    }

    if ((/^labels\//i.test(relativePath) || /^classes\.txt$/i.test(relativePath)) && /\.txt$/i.test(fileName)) {
      labelFiles.push(detail);
    }
  }

  frameFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  labelFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));

  return {
    ok: true,
    outputDir,
    folderName: path.basename(outputDir),
    sourcePath,
    sourceName: path.basename(sourcePath),
    intervalSeconds,
    frameCount: frameFiles.length,
    labelCount: labelFiles.length,
    durationSeconds: Number(result.durationSeconds || 0),
    frameFiles,
    labelFiles
  };
}

function runStreamingPythonInference(payload, webContents) {
  return new Promise(async (resolve, reject) => {
    const modelPath = String(payload?.modelPath || '').trim();
    const sourcePath = String(payload?.sourcePath || '').trim();
    const runName = sanitizeFileName(payload?.runName);
    const confidence = Number.isFinite(Number(payload?.confidence)) ? Number(payload.confidence) : 0.25;
    const enableTracker = payload?.enableTracker === true;
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
    if (enableTracker) {
      args.push('--enable-tracker');
    }
    const pythonExecutable = await resolvePythonExecutable();
    const child = spawn(pythonExecutable, args, {
      cwd: getProcessWorkingDirectory(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (runId) {
      activeInferenceProcesses.set(runId, child);
    }
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
      if (runId) {
        activeInferenceProcesses.delete(runId);
      }
      const wasCanceled = runId ? canceledInferenceRuns.has(runId) : false;
      if (runId) {
        canceledInferenceRuns.delete(runId);
      }
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
        if (wasCanceled || finalResult?.error === 'INFERENCE_CANCELLED') {
          reject(new Error('Inference cancelled.'));
          return;
        }

        reject(new Error(finalResult?.error || stderr || `Inference exited with code ${code}.`));
        return;
      }

      enrichInferenceResult(finalResult).then(resolve, reject);
    });
  });
}

function stopChildProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve(true);
      return;
    }

    if (process.platform === 'win32' && Number.isInteger(child.pid)) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });

      killer.on('close', () => resolve(true));
      killer.on('error', () => {
        try {
          child.kill('SIGTERM');
        } catch (_error) {
          // Ignore failures while attempting to stop process.
        }
        resolve(true);
      });
      return;
    }

    try {
      child.kill('SIGTERM');
    } catch (_error) {
      // Ignore failures while attempting to stop process.
    }
    resolve(true);
  });
}

async function cancelTrainingRun(runId) {
  const key = String(runId || '').trim();

  if (!key) {
    throw new Error('Run id is required to cancel training.');
  }

  const child = activeTrainingProcesses.get(key);

  if (!child) {
    return { ok: false, reason: 'not-running' };
  }

  canceledTrainingRuns.add(key);
  await stopChildProcessTree(child);
  return { ok: true };
}

async function stopAllTrainingProcesses() {
  const entries = [...activeTrainingProcesses.entries()];

  entries.forEach(([runId]) => {
    canceledTrainingRuns.add(runId);
  });

  await Promise.all(entries.map(([, child]) => stopChildProcessTree(child)));
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
    titlePage: { mode: 'default' },
    status: 'No data',
    createdAt: now,
    updatedAt: now,
    data: {
      training: [],
      inference: [],
      inferenceFrames: []
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
  const appIcon = nativeImage.createFromPath(getAppIconPath());

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#f4f7fa',
    frame: false,
    show: false,
    title: 'Pink Ward',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setIcon(appIcon);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('close', (event) => {
    if (!activeTrainingProcesses.size || allowCloseWithActiveTraining) {
      return;
    }

    event.preventDefault();
    void (async () => {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Keep Pink Ward Open', 'Close Pink Ward'],
        defaultId: 0,
        cancelId: 0,
        title: 'Close Pink Ward?',
        message: 'Are you sure you want to close Pink Ward?',
        detail: 'Training will stop if Pink Ward closes.'
      });

      if (response !== 1) {
        return;
      }

      allowCloseWithActiveTraining = true;
      await stopAllTrainingProcesses();
      mainWindow.close();
    })();
  });
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

ipcMain.handle('projects:delete', async (_event, projectId) => {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Project id is required.');
  }

  const store = await readProjectStore();
  const projectIndex = store.projects.findIndex((candidate) => candidate.id === projectId);

  if (projectIndex === -1) {
    throw new Error('Project was not found.');
  }

  store.projects.splice(projectIndex, 1);

  if (store.activeProjectId === projectId || !store.projects.some((project) => project.id === store.activeProjectId)) {
    store.activeProjectId = store.projects[0]?.id || null;
  }

  await writeProjectStore(store);
  return store;
});

ipcMain.handle('files:preview', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required.');
  }

  filePath = await resolveExistingFilePath(filePath);
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

ipcMain.handle('files:reveal', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required.');
  }

  filePath = await resolveExistingFilePath(filePath);
  const resolvedPath = path.resolve(filePath);
  await fs.access(resolvedPath);
  shell.showItemInFolder(resolvedPath);
  return true;
});

ipcMain.handle('files:thumbnail', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required.');
  }

  filePath = await resolveExistingFilePath(filePath);
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

  filePath = await resolveExistingFilePath(filePath);
  return getVideoFrameThumbnail(filePath);
});

ipcMain.handle('files:extract-frames', async (_event, payload) => {
  return extractVideoFrames(payload || {});
});

ipcMain.handle('system:cuda-availability', async () => {
  return getCudaAvailability();
});

ipcMain.handle('inference:run', async (_event, payload) => {
  if (payload?.display) {
    return runStreamingPythonInference(payload || {}, _event.sender);
  }

  return runPythonInference(payload || {});
});

ipcMain.handle('training:run', async (_event, payload) => {
  return runPythonTraining(payload || {}, _event.sender);
});

ipcMain.handle('training:cancel', async (_event, runId) => {
  return cancelTrainingRun(runId);
});

ipcMain.handle('inference:cancel', async (_event, runId) => {
  const key = String(runId || '').trim();

  if (!key) {
    throw new Error('Run id is required to cancel inference.');
  }

  const child = activeInferenceProcesses.get(key);

  if (!child) {
    return { ok: false, reason: 'not-running' };
  }

  activeInferenceProcesses.delete(key);
  canceledInferenceRuns.add(key);
  await stopChildProcessTree(child);
  return { ok: true };
});

app.setAppUserModelId('local.pinkward.workspace');

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
