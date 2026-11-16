'use strict';
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WorkspaceService } = require('./service');
const { WorkspaceFiles } = require('./files');
const { discoverPython, readProject } = require('./pio');

class ProjectManager extends EventEmitter {
  constructor({ workerPath, packaged = false, recentFolders = [], serviceFactory, discover = discoverPython }) {
    super();
    this.workerPath = workerPath;
    this.packaged = packaged;
    this.records = new Map();
    this.sessions = new Set();
    this.recentFolders = recentFolders.filter(p => typeof p === 'string').slice(0, 20);
    this.serviceFactory = serviceFactory || (options => new WorkspaceService(options));
    this.discover = () => { this.discovery ||= discover(); return this.discovery; };
  }
  createSession() { const session = new WorkspaceSession(this); this.sessions.add(session); return session; }
  acquire(projectPath, session) {
    const root = fs.realpathSync(projectPath);
    if (!fs.statSync(root).isDirectory()) throw new Error('Select a project folder.');
    const canonical = process.platform === 'win32' ? root.toLowerCase() : root;
    const id = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 20);
    let record = this.records.get(id);
    if (!record) {
      const service = this.serviceFactory({ projectPath: root, workerPath: this.workerPath, packaged: this.packaged, discover: this.discover });
      record = { id, name: path.basename(root), projectPath: root, service, files: new WorkspaceFiles(root), references: new Set() };
      this.records.set(id, record);
      service.on('event', event => {
        const data = { ...event, projectId: id };
        if (event.type === 'state') data.state = { ...event.state, id, name: record.name };
        for (const owner of record.references) owner.emit('event', data);
      });
    }
    record.references.add(session);
    return record;
  }
  touchRecent(root) {
    const canonical = p => process.platform === 'win32' ? p.toLowerCase() : p;
    this.recentFolders = [root, ...this.recentFolders.filter(p => canonical(p) !== canonical(root))].slice(0, 20);
    this.notifyWorkspaces();
    this.emit('change');
  }
  notifyWorkspaces() { for (const session of this.sessions) session.emit('event', { type: 'workspace', workspace: session.snapshot() }); }
  async release(id, session) {
    const record = this.records.get(id);
    if (!record) return;
    record.references.delete(session);
    if (!record.references.size) { this.records.delete(id); await record.service.dispose(); }
  }
  refresh(record) {
    try {
      const parsed = readProject(record.projectPath);
      const previous = record.service.state.environment;
      Object.assign(record.service.state, parsed, { projectError: '' });
      if (parsed.environments.includes(previous)) record.service.state.environment = previous;
    } catch (error) {
      record.service.state.environments = [];
      record.service.state.environment = '';
      record.service.state.projectError = error.message;
    }
    record.service.changed();
  }
  allProjectPaths() { return [...this.records.values()].map(record => record.projectPath); }
  async dispose() { await Promise.allSettled([...this.records.values()].map(record => record.service.dispose())); this.records.clear(); this.sessions.clear(); }
}

class WorkspaceSession extends EventEmitter {
  constructor(manager) { super(); this.manager = manager; this.projectIds = new Set(); this.activeProjectId = ''; }
  snapshot() {
    return {
      activeProjectId: this.activeProjectId,
      projects: [...this.projectIds].map(id => {
        const record = this.manager.records.get(id);
        return { ...record.service.snapshot(), id, name: record.name };
      }),
      recentFolders: this.manager.recentFolders.map(root => ({ path: root, name: path.basename(root), exists: fs.existsSync(root) }))
    };
  }
  record(id = this.activeProjectId) {
    if (!this.projectIds.has(id)) throw new Error('This project is not open in this window.');
    const record = this.manager.records.get(id);
    if (!record) throw new Error('The project has been closed.');
    return record;
  }
  async ready() { await Promise.all([...this.projectIds].map(id => this.record(id).service.initialize())); return this.snapshot(); }
  openProject(projectPath) {
    const record = this.manager.acquire(projectPath, this);
    this.projectIds.add(record.id);
    this.activeProjectId = record.id;
    this.manager.touchRecent(record.projectPath);
    record.service.initialize().catch(error => this.emit('event', { type: 'notice', projectId: record.id, message: error.message }));
    return this.snapshot();
  }
  activateProject(id) { this.record(id); this.activeProjectId = id; this.emit('event', { type: 'workspace', workspace: this.snapshot() }); this.manager.emit('change'); return this.snapshot(); }
  async closeProject(id) {
    const record = this.record(id);
    if (record.service.state.build.running) throw new Error('Cancel this project’s running build before closing it.');
    this.projectIds.delete(id);
    if (this.activeProjectId === id) this.activeProjectId = this.projectIds.values().next().value || '';
    await this.manager.release(id, this);
    this.manager.notifyWorkspaces();
    this.manager.emit('change');
    return this.snapshot();
  }
  async listFiles({ projectId, path: relativePath = '', ...options }) { return this.record(projectId).files.list(relativePath, options); }
  async readFile({ projectId, path: relativePath }) { return this.record(projectId).files.read(relativePath); }
  async readChunk({ projectId, ...data }) { return this.record(projectId).files.readChunk(data); }
  async saveFile({ projectId, ...data }) {
    const record = this.record(projectId);
    const result = await record.files.write(data);
    if (data.path.replaceAll('\\', '/').toLowerCase() === 'platformio.ini') this.manager.refresh(record);
    for (const session of record.references) if (session !== this) session.emit('event', { type: 'file-changed', projectId: record.id, path: result.path });
    return result;
  }
  async createFile({ projectId, ...data }) {
    const record = this.record(projectId);
    const result = await record.files.createFile(data);
    if (data.path.replaceAll('\\', '/').toLowerCase() === 'platformio.ini') this.manager.refresh(record);
    return result;
  }
  async createDirectory({ projectId, path: relativePath }) { return this.record(projectId).files.createDirectory(relativePath); }
  async runCommand({ projectId, ...data }) {
    const record = this.record(projectId);
    if (record.service.state.build.running || record.service.serialBusy) throw new Error('Another build or connection change is in progress in this project.');
    if (data.action === 'upload') {
      for (const other of this.manager.records.values()) {
        if (other.id !== record.id && other.service.state.serial.connected && !other.service.state.serial.demo && other.service.state.serial.port.toUpperCase() === String(data.port).toUpperCase()) throw new Error(`That port is in use by ${other.name}. Disconnect its serial monitor first.`);
        if (other.id !== record.id && other.service.state.build.running && other.service.state.build.action === 'upload' && other.uploadPort?.toUpperCase() === String(data.port).toUpperCase()) throw new Error(`An upload to that port is already running in ${other.name}.`);
      }
      record.uploadPort = data.port;
    }
    try { return await record.service.runCommand(data); }
    finally { record.uploadPort = ''; }
  }
  async cancelBuild(id) { return this.record(id).service.cancelBuild(); }
  async listPorts(id) { return this.record(id).service.listPorts(); }
  async connectSerial({ projectId, ...data }) {
    const record = this.record(projectId);
    for (const other of this.manager.records.values()) {
      if (other.id !== record.id && ((other.service.state.serial.connected && !other.service.state.serial.demo && other.service.state.serial.port.toUpperCase() === String(data.port).toUpperCase()) || other.uploadPort?.toUpperCase() === String(data.port).toUpperCase())) throw new Error(`That port is in use by ${other.name}.`);
    }
    return record.service.connectSerial(data);
  }
  async disconnectSerial(id) { return this.record(id).service.disconnectSerial(); }
  async sendSerial({ projectId, command }) { return this.record(projectId).service.sendSerial(command); }
  async setDemo({ projectId, enabled }) { return this.record(projectId).service.setDemo(enabled); }
  async dispose() {
    const ids = [...this.projectIds]; this.projectIds.clear(); this.manager.sessions.delete(this);
    await Promise.allSettled(ids.map(id => this.manager.release(id, this)));
  }
}
module.exports = { ProjectManager, WorkspaceSession };
