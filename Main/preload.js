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
  getFilePath: (file) => webUtils.getPathForFile(file),
  previewFile: (filePath) => ipcRenderer.invoke('files:preview', filePath),
  getThumbnail: (filePath) => ipcRenderer.invoke('files:thumbnail', filePath),
  getVideoFrame: (filePath) => ipcRenderer.invoke('files:video-frame', filePath),
  runInference: (payload) => ipcRenderer.invoke('inference:run', payload),
  fileUrl: (filePath) => fileUrlFromPath(filePath),
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
