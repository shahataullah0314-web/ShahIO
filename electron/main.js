'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { ProjectManager } = require('./workspace');
const { BoardCatalog, addEnvironment } = require('./boards');
const { configureBundledTools, discoverPython } = require('./pio');
const { startupProjects } = require('./startup');
const { createProject: scaffoldProject } = require('./projects');
const { TerminalSession } = require('./terminal');
const { TabbedWindow, restoredWorkspaceTabs } = require('./tabbed-window');
const { loadSettings } = require('./profile');
const argument = (name, argv = process.argv) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
const sourceRoot = path.resolve(__dirname, '..');
const bundledResources = app.isPackaged ? process.resourcesPath : path.join(sourceRoot, 'vendor');
configureBundledTools(bundledResources);
app.setName('ShahIO');
const explicitProfile = argument('--profile');
const profileRoot = explicitProfile || path.join(app.getPath('appData'), 'ShahIO');
let saved = loadSettings({ profileRoot, legacyRoot: path.join(app.getPath('appData'), 'embosser-control'), migrate: !explicitProfile });
app.setPath('userData', profileRoot);
app.setAppUserModelId('com.shahataullah.shahio');
const settingsFile = path.join(profileRoot, 'settings.json');
const manager = new ProjectManager({ packaged: app.isPackaged, workerPath: app.isPackaged ? path.join(process.resourcesPath, 'serial_worker.py') : path.join(__dirname, 'serial_worker.py'), recentFolders: saved.recentFolders || [], discover: () => discoverPython({ resourcesPath: bundledResources }) });
const catalog = new BoardCatalog();
const hosts = new Map();
const documentURL = pathToFileURL(path.join(sourceRoot, 'ui', 'index.html')).href;
const shellURL = pathToFileURL(path.join(sourceRoot, 'ui', 'shell.html')).href;
let shutdownReady = false, restoringTabs = true, closingApplication = false, mainWindow = null, workspaceTabs = null;
function persist() {
  if (restoringTabs || closingApplication || !workspaceTabs) return;
  const descriptors = workspaceTabs.descriptors();
  const paths = [...new Set(descriptors.flatMap(tab => tab.projectPaths))];
  const focusedHost = workspaceTabs.active();
  saved.workspaceFolders = paths;
  saved.activeProjectPath = focusedHost?.session.activeProjectId ? focusedHost.session.record().projectPath : '';
  saved.workspaceTabs = descriptors;
  saved.activeWorkspaceTab = [...workspaceTabs.tabs.keys()].indexOf(workspaceTabs.activeTabId);
  saved.recentFolders = manager.recentFolders;
  fs.writeFileSync(settingsFile, JSON.stringify(saved, null, 2));
}
manager.on('change', persist);
function register(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    const host = hosts.get(event.sender.id);
    if (!host || event.senderFrame !== host.contents.mainFrame || event.senderFrame.url !== documentURL) throw new Error('Unsupported IPC source.');
    return callback(host, ...args);
  });
}
async function openProject(host, data = {}) {
  let root = data.path;
  if (!root) {
    const result = await dialog.showOpenDialog(host.win, { title: 'Open project folder', defaultPath: host.session.projectIds.size ? host.session.record().projectPath : undefined, properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return host.session.snapshot();
    root = result.filePaths[0];
  }
  return host.session.openProject(root);
}
register('workspace:get', host => host.session.ready());
register('workspace:open', openProject);
register('workspace:activate', (host, id) => host.session.activateProject(id));
register('workspace:close', async (host, id) => { const next = await host.session.closeProject(id); await closeTerminal(host, id); return next; });
register('workspace:new-window', async host => { await workspaceTabs.newTab(); return host.session.snapshot(); });
register('workspace:dirty', (host, data) => { host.dirty = Boolean(data?.dirty); workspaceTabs.notify(); return { ok: true }; });
register('workspace:discard', (host, data) => dialog.showMessageBoxSync(host.win, { type: 'question', buttons: ['Cancel', 'Discard changes'], defaultId: 0, cancelId: 0, message: `Discard unsaved changes to ${String(data?.name || 'this file').slice(0, 200)}?`, detail: 'To keep your edits, cancel and save the file.' }) === 1);
for (const method of ['listFiles', 'readFile', 'readChunk', 'saveFile', 'createFile', 'createDirectory']) register(`files:${method}`, (host, data) => host.session[method](data));
for (const method of ['runCommand', 'cancelBuild', 'listPorts', 'connectSerial', 'disconnectSerial', 'sendSerial', 'setDemo']) register(`tools:${method}`, (host, data) => host.session[method](data));
register('boards:list', async () => {
  const pio = await manager.discover(); if (!pio.available) throw new Error(pio.error);
  return catalog.list(pio.python);
});
register('boards:add-environment', async (host, data) => {
  const record = host.session.record(data.projectId);
  if (record.service.state.build.running) throw new Error('Wait for this project’s build to finish before changing its environments.');
  const pio = await manager.discover(); if (!pio.available) throw new Error(pio.error);
  const boards = await catalog.list(pio.python);
  const board = boards.find(item => item.id === data.boardId && (!data.platform || item.platform === data.platform));
  if (!board) throw new Error('Select a board from the PlatformIO catalog.');
  if (fs.existsSync(path.join(record.projectPath, 'platformio.ini')) && (await record.files.read('platformio.ini')).kind === 'binary') throw new Error('platformio.ini must be a UTF-8 text configuration file.');
  await addEnvironment(record.projectPath, { board, environment: data.environment, framework: data.framework });
  manager.refresh(record); manager.notifyWorkspaces();
  for (const session of record.references) session.emit('event', { type: 'file-changed', projectId: record.id, path: 'platformio.ini' });
  return host.session.snapshot();
});
register('projects:defaults', host => ({ parentDirectory: host.session.projectIds.size && !fs.existsSync(path.join(host.session.record().projectPath, 'platformio.ini')) ? host.session.record().projectPath : path.join(app.getPath('documents'), 'ShahIO Projects') }));
register('projects:choose-parent', async (host, data) => {
  const result = await dialog.showOpenDialog(host.win, { title: 'Choose parent folder for the new project', defaultPath: data?.parentDirectory || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
register('projects:create', async (host, data) => {
  const pio = await manager.discover(); if (!pio.available) throw new Error(pio.error);
  const boards = await catalog.list(pio.python);
  const board = boards.find(item => item.id === data.boardId && (!data.platform || item.platform === data.platform));
  if (!board) throw new Error('Select a board from the catalog.');
  const created = scaffoldProject({ parentDirectory: data.parentDirectory, name: data.name, board, environment: data.environment, framework: data.framework });
  return { ...created, workspace: host.session.openProject(created.projectPath) };
});

function terminalEnvironment(python) {
  const bin = path.join(profileRoot, 'terminal-bin'); fs.mkdirSync(bin, { recursive: true });
  const escaped = python.replaceAll('%', '%%');
  fs.writeFileSync(path.join(bin, 'pio.cmd'), '@echo off\r\n"' + escaped + '" -m platformio %*\r\n');
  fs.writeFileSync(path.join(bin, 'pip.cmd'), '@echo off\r\n"' + escaped + '" -m pip %*\r\n');
  return { ...process.env, PATH: [bin, path.dirname(python), process.env.PATH || ''].join(path.delimiter), PIO_PYTHON_EXE: python };
}
async function closeTerminal(host, id) {
  const record = host.terminals.get(id); if (!record) return { ok: true };
  host.terminals.delete(id); await record.session.dispose(); return { ok: true };
}
register('terminal:open', async (host, data) => {
  const record = host.session.record(data.projectId);
  const existing = host.terminals.get(record.id);
  if (existing?.starting) return existing.ready;
  if (existing?.running) return existing.state;
  await closeTerminal(host, record.id);
  const packagedPython = path.join(bundledResources, 'python', 'python.exe');
  const python = fs.existsSync(packagedPython) ? packagedPython : (await manager.discover()).python;
  if (!python) throw new Error('The Python runtime needed by the terminal is unavailable.');
  const terminal = new TerminalSession({ python, workerPath: app.isPackaged ? path.join(process.resourcesPath, 'terminal_worker.py') : path.join(__dirname, 'terminal_worker.py'), cwd: record.projectPath, env: terminalEnvironment(python), shell: data.shell || 'powershell' });
  const entry = { session: terminal, running: false, starting: true, state: null, ready: null }; host.terminals.set(record.id, entry);
  const send = event => sendHost(host, { ...event, projectId: record.id });
  terminal.on('data', chunk => send({ type: 'terminal-data', data: chunk }));
  terminal.on('exit', code => { entry.running = false; send({ type: 'terminal-exit', code }); });
  terminal.on('terminal-error', message => send({ type: 'terminal-error', message }));
  entry.ready = terminal.start({ cols: data.cols || 100, rows: data.rows || 25 }).then(state => {
    if (terminal.dead || host.terminals.get(record.id) !== entry) throw new Error('The terminal was closed while starting.');
    entry.state = state; entry.running = true; return state;
  }).finally(() => { entry.starting = false; });
  return entry.ready;
});
register('terminal:write', async (host, data) => { host.session.record(data.projectId); const terminal = host.terminals.get(data.projectId); if (terminal?.starting) await terminal.ready; if (!terminal?.running) throw new Error('Start a terminal first.'); return terminal.session.write(data.data); });
register('terminal:resize', (host, data) => { host.session.record(data.projectId); const terminal = host.terminals.get(data.projectId); return terminal?.running ? terminal.session.resize({ cols: data.cols, rows: data.rows }) : { ok: true }; });
register('terminal:close', (host, id) => { host.session.record(id); return closeTerminal(host, id); });
register('terminal:focus', (host, focused) => { host.contents.setIgnoreMenuShortcuts(Boolean(focused)); return { ok: true }; });
function sendHost(host, event) {
  if (!host.win.isDestroyed() && !host.contents.isDestroyed()) host.contents.send('workspace:event', event);
}
function focused() { return workspaceTabs?.active(); }
function sendMenu(type) { const host = focused(); if (host) sendHost(host, { type }); }
function menuFailure(host, error) {
  if (host) sendHost(host, { type: 'notice', message: error.message });
  else if (mainWindow && !mainWindow.isDestroyed()) dialog.showErrorBox('Could not open workspace', error.message);
}
function tabFailure(error) { menuFailure(focused(), error); }
function protectContents(contents) {
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
    const key = input.key.toLowerCase();
    if ((key === 't' && !input.shift) || (key === 'n' && input.shift)) {
      event.preventDefault(); workspaceTabs.newTab().catch(tabFailure);
    } else if (key === 'tab') { event.preventDefault(); workspaceTabs.cycle(input.shift ? -1 : 1); }
    else if (key === 'w' && input.shift) { event.preventDefault(); workspaceTabs.closeTab(workspaceTabs.activeTabId).catch(tabFailure); }
  });
}
function confirmClosing(tabHosts, scope) {
  if (tabHosts.some(host => host.dirty) && dialog.showMessageBoxSync(mainWindow, {
    type: 'warning', buttons: ['Cancel', 'Discard changes and close'], defaultId: 0, cancelId: 0,
    message: `You have unsaved files in ${scope}.`, detail: 'Cancel to save your files before closing.'
  }) !== 1) return false;
  const closingSessions = new Set(tabHosts.map(host => host.session));
  const running = [...manager.records.values()].some(record => record.service.state.build.running && [...record.references].every(session => closingSessions.has(session)));
  if (running && dialog.showMessageBoxSync(mainWindow, {
    type: 'question', buttons: ['Keep open', 'Cancel tasks and close'], defaultId: 0, cancelId: 0,
    message: `Build tasks are still running in ${scope}.`
  }) !== 1) return false;
  return true;
}
function registerTabs(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== shellURL) throw new Error('Unsupported tab-strip IPC source.');
    return callback(...args);
  });
}
registerTabs('tabs:get', () => workspaceTabs.snapshot());
registerTabs('tabs:new', async () => { await workspaceTabs.newTab(); return workspaceTabs.snapshot(); });
registerTabs('tabs:activate', id => workspaceTabs.activateTab(id));
registerTabs('tabs:close', id => workspaceTabs.closeTab(id));
async function createWindow(descriptors, activeIndex = 0) {
  const win = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 720, title: 'ShahIO', backgroundColor: '#1e1e1e', show: false, webPreferences: { preload: path.join(__dirname, 'shell-preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  mainWindow = win;
  workspaceTabs = new TabbedWindow({ win, documentURL,
    createView: () => {
      const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } });
      view.setBackgroundColor('#1e1e1e'); return view;
    },
    createHost: (view, descriptor) => {
      const session = manager.createSession(), contents = view.webContents;
      const host = { win, view, contents, session, dirty: false, terminals: new Map() };
      hosts.set(contents.id, host); protectContents(contents);
      session.on('event', event => { sendHost(host, event); if (event.type === 'workspace') workspaceTabs.notify(); });
      contents.on('page-title-updated', event => { event.preventDefault(); workspaceTabs.notify(); });
      for (const root of descriptor.projectPaths || []) { try { session.openProject(root); } catch { /* Missing folders remain in recents. */ } }
      if (descriptor.activeProjectPath) { const active = session.snapshot().projects.find(project => project.projectPath === descriptor.activeProjectPath); if (active) session.activateProject(active.id); }
      return host;
    },
    disposeHost: async host => {
      hosts.delete(host.contents.id);
      await Promise.allSettled([host.session.dispose(), ...[...host.terminals.keys()].map(id => closeTerminal(host, id))]);
    },
    confirmClose: host => confirmClosing([host], 'this workspace tab')
  });
  workspaceTabs.on('change', state => { if (!win.isDestroyed()) win.webContents.send('tabs:state', state); persist(); });
  protectContents(win.webContents);
  win.on('resize', () => workspaceTabs.layout());
  win.on('close', event => {
    if (shutdownReady || closingApplication) return;
    if (!confirmClosing([...workspaceTabs.tabs.values()], 'this window')) { event.preventDefault(); return; }
    persist(); closingApplication = true;
  });
  win.on('closed', () => { workspaceTabs.dispose().finally(() => app.quit()); });
  await win.loadURL(shellURL);
  for (const descriptor of descriptors.length ? descriptors : [{}]) await workspaceTabs.newTab(descriptor, { activate: false });
  const ids = [...workspaceTabs.tabs.keys()];
  workspaceTabs.activateTab(ids[Math.max(0, Math.min(ids.length - 1, activeIndex))] || ids[0]);
  restoringTabs = false; persist(); win.show(); return win;
}
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'New Workspace Tab', accelerator: 'CmdOrCtrl+T', click: () => workspaceTabs.newTab().catch(tabFailure) },
      { label: 'Close Workspace Tab', accelerator: 'CmdOrCtrl+Shift+W', click: () => workspaceTabs.closeTab(workspaceTabs.activeTabId).catch(tabFailure) },
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => { const host = focused(); if (host) openProject(host).catch(error => menuFailure(host, error)); } },
      { type: 'separator' }, { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save-request') },
      { label: 'Save All', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('save-all-request') },
      { type: 'separator' }, { role: 'close', accelerator: 'Alt+F4' }
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ label: 'Next Workspace Tab', accelerator: 'Ctrl+Tab', click: () => workspaceTabs.cycle(1) }, { label: 'Previous Workspace Tab', accelerator: 'Ctrl+Shift+Tab', click: () => workspaceTabs.cycle(-1) }, { type: 'separator' }, { label: 'Serial Monitor', accelerator: 'CmdOrCtrl+Shift+M', click: () => sendMenu('serial-panel-request') }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', async (_event, argv) => {
    const requested = argument('--project', argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus();
      if (requested) await workspaceTabs.newTab({ projectPaths: [requested], activeProjectPath: requested }).catch(tabFailure);
    }
  });
  app.whenReady().then(async () => {
    menu();
    const requested = argument('--project');
    let descriptors = !requested && restoredWorkspaceTabs(saved);
    if (!descriptors) {
      let paths = [];
      try { paths = startupProjects({ requested, saved, packaged: app.isPackaged, sourceRoot, starterSource: app.isPackaged ? path.join(process.resourcesPath, 'starter-project') : path.join(sourceRoot, 'resources', 'starter-project'), documentsPath: app.getPath('documents') }); }
      catch (error) { dialog.showErrorBox('Could not create the example project', error.message + '\nUse Open folder to choose a writable project folder.'); }
      descriptors = [{ projectPaths: paths, activeProjectPath: requested || saved.activeProjectPath || '' }];
    }
    await createWindow(descriptors, requested ? 0 : Number.isInteger(saved.activeWorkspaceTab) ? saved.activeWorkspaceTab : 0);
  });
  app.on('window-all-closed', () => { /* Last session cleanup initiates quit. */ });
  app.on('before-quit', event => {
    if (shutdownReady) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.close(); return; }
    manager.dispose().finally(() => { shutdownReady = true; app.quit(); });
  });
}
