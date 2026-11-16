'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const api = {
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  openProject: data => ipcRenderer.invoke('workspace:open', data),
  activateProject: id => ipcRenderer.invoke('workspace:activate', id),
  closeProject: id => ipcRenderer.invoke('workspace:close', id),
  newWindow: () => ipcRenderer.invoke('workspace:new-window'),
  setDirty: data => ipcRenderer.invoke('workspace:dirty', data),
  confirmDiscard: data => ipcRenderer.invoke('workspace:discard', data),
  getBoards: () => ipcRenderer.invoke('boards:list'),
  addEnvironment: data => ipcRenderer.invoke('boards:add-environment', data),
  getProjectDefaults: () => ipcRenderer.invoke('projects:defaults'),
  chooseProjectParent: data => ipcRenderer.invoke('projects:choose-parent', data),
  createProject: data => ipcRenderer.invoke('projects:create', data),
  terminalOpen: data => ipcRenderer.invoke('terminal:open', data),
  terminalWrite: data => ipcRenderer.invoke('terminal:write', data),
  terminalResize: data => ipcRenderer.invoke('terminal:resize', data),
  terminalClose: id => ipcRenderer.invoke('terminal:close', id),
  terminalFocus: focused => ipcRenderer.invoke('terminal:focus', focused),
  onEvent: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('workspace:event', listener); return () => ipcRenderer.removeListener('workspace:event', listener); }
};
for (const method of ['listFiles', 'readFile', 'readChunk', 'saveFile', 'createFile', 'createDirectory']) api[method] = data => ipcRenderer.invoke(`files:${method}`, data);
for (const method of ['runCommand', 'cancelBuild', 'listPorts', 'connectSerial', 'disconnectSerial', 'sendSerial', 'setDemo']) api[method] = data => ipcRenderer.invoke(`tools:${method}`, data);
contextBridge.exposeInMainWorld('pioAPI', api);
