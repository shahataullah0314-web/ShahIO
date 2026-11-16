'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('workspaceTabs', {
  getState: () => ipcRenderer.invoke('tabs:get'),
  newTab: () => ipcRenderer.invoke('tabs:new'),
  activateTab: id => ipcRenderer.invoke('tabs:activate', id),
  closeTab: id => ipcRenderer.invoke('tabs:close', id),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('tabs:state', listener);
    return () => ipcRenderer.removeListener('tabs:state', listener);
  }
});
