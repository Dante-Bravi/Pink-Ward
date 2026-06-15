const { contextBridge, ipcRenderer, webUtils } = require('electron');

function fileUrlFromPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');

  if (!normalized) {
    return '';
  }

  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encodedPath = absolutePath
    .split('/')
    .map((segment, index) => {
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) {
        return segment;
      }

      return encodeURIComponent(segment);
    })
    .join('/');

  return `file://${encodedPath}`;
}

contextBridge.exposeInMainWorld('pinkWardDesktop', {
  platform: process.platform,
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (project) => ipcRenderer.invoke('projects:create', project),
  updateProject: (project) => ipcRenderer.invoke('projects:update', project),
  deleteProject: (projectId) => ipcRenderer.invoke('projects:delete', projectId),
  getFilePath: (file) => webUtils.getPathForFile(file),
  importFiles: (payload) => ipcRenderer.invoke('files:import-into-project', payload),
  ensureStoredFiles: (payload) => ipcRenderer.invoke('files:ensure-project-storage', payload),
  previewFile: (filePath) => ipcRenderer.invoke('files:preview', filePath),
  revealFile: (filePath) => ipcRenderer.invoke('files:reveal', filePath),
  revealDirectory: (directoryPath) => ipcRenderer.invoke('files:reveal-directory', directoryPath),
  getThumbnail: (filePath) => ipcRenderer.invoke('files:thumbnail', filePath),
  getVideoFrame: (filePath) => ipcRenderer.invoke('files:video-frame', filePath),
  extractFrames: (payload) => ipcRenderer.invoke('files:extract-frames', payload),
  getCudaAvailability: () => ipcRenderer.invoke('system:cuda-availability'),
  runTraining: (payload) => ipcRenderer.invoke('training:run', payload),
  runInference: (payload) => ipcRenderer.invoke('inference:run', payload),
  cancelTraining: (runId) => ipcRenderer.invoke('training:cancel', runId),
  cancelInference: (runId) => ipcRenderer.invoke('inference:cancel', runId),
  fileUrl: (filePath) => fileUrlFromPath(filePath),
  onTrainingProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('training:progress', listener);
    return () => ipcRenderer.removeListener('training:progress', listener);
  },
  onInferenceFrame: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('inference:frame', listener);
    return () => ipcRenderer.removeListener('inference:frame', listener);
  },
  onWindowMaximized: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  }
});
