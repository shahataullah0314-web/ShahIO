'use strict';
const { EventEmitter } = require('node:events');

// One live WebContents per workspace keeps editors, scroll positions, running
// tasks, and terminals intact when another workspace becomes visible.
class TabbedWindow extends EventEmitter {
  constructor({ win, createView, createHost, disposeHost, confirmClose, documentURL, shellHeight = 40 }) {
    super();
    Object.assign(this, { win, createView, createHost, disposeHost, confirmClose, documentURL, shellHeight });
    this.tabs = new Map(); this.activeTabId = ''; this.sequence = 0; this.disposed = false;
  }
  snapshot() {
    return { tabs: [...this.tabs.values()].map(host => ({ id: host.tabId, title: this.title(host), dirty: Boolean(host.dirty) })), activeTabId: this.activeTabId };
  }
  title(host) {
    const state = host.session.snapshot();
    return state.projects.find(item => item.id === state.activeProjectId)?.name || state.projects[0]?.name || 'New workspace';
  }
  active() { return this.tabs.get(this.activeTabId); }
  notify() {
    if (this.disposed || this.win.isDestroyed()) return;
    const active = this.active();
    if (active && !active.contents.isDestroyed()) this.win.setTitle(active.contents.getTitle() || 'ShahIO');
    this.emit('change', this.snapshot());
  }
  layout() {
    if (this.disposed || this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    for (const host of this.tabs.values()) host.view.setBounds({ x: 0, y: this.shellHeight, width, height: Math.max(0, height - this.shellHeight) });
  }
  async newTab(descriptor = {}, { activate = true } = {}) {
    if (this.disposed) throw new Error('This workspace window has closed.');
    const view = this.createView();
    const host = this.createHost(view, descriptor);
    host.tabId = String(++this.sequence);
    this.tabs.set(host.tabId, host);
    this.win.contentView.addChildView(view); view.setVisible(false); this.layout();
    if (activate || !this.activeTabId) this.activateTab(host.tabId); else this.notify();
    try { await host.contents.loadURL(this.documentURL); }
    catch (error) {
      // Closing a tab or the window aborts an in-flight navigation. Its owner
      // already released that host; do not dispose twice or revive another tab.
      if (this.disposed || this.tabs.get(host.tabId) !== host) return host;
      this.tabs.delete(host.tabId);
      this.win.contentView.removeChildView(view);
      if (!host.contents.isDestroyed()) host.contents.close({ waitForBeforeUnload: false });
      await this.disposeHost(host);
      if (this.activeTabId === host.tabId) {
        this.activeTabId = '';
        const remaining = this.tabs.keys().next().value; if (remaining) this.activateTab(remaining); else this.notify();
      } else this.notify();
      throw error;
    }
    return host;
  }
  activateTab(id) {
    const next = this.tabs.get(String(id));
    if (!next) throw new Error('This workspace tab is no longer open.');
    this.activeTabId = next.tabId;
    for (const host of this.tabs.values()) host.view.setVisible(host === next);
    this.win.contentView.addChildView(next.view); this.layout();
    next.contents.focus(); this.notify(); return this.snapshot();
  }
  cycle(direction = 1) {
    const ids = [...this.tabs.keys()]; if (!ids.length) return this.snapshot();
    return this.activateTab(ids[(ids.indexOf(this.activeTabId) + direction + ids.length) % ids.length]);
  }
  async closeTab(id) {
    const host = this.tabs.get(String(id));
    if (!host || host.closing) return this.snapshot();
    host.closing = true;
    try { if (!await this.confirmClose(host)) { host.closing = false; return this.snapshot(); } }
    catch (error) { host.closing = false; throw error; }
    if (this.disposed || this.tabs.get(host.tabId) !== host) return this.snapshot();
    const ids = [...this.tabs.keys()], index = ids.indexOf(host.tabId);
    this.tabs.delete(host.tabId); this.win.contentView.removeChildView(host.view);
    if (!host.contents.isDestroyed()) host.contents.close({ waitForBeforeUnload: false });
    try {
      if (this.activeTabId === host.tabId) {
        this.activeTabId = '';
        const neighbor = [...this.tabs.keys()][Math.min(index, this.tabs.size - 1)];
        if (neighbor) this.activateTab(neighbor);
      }
      // Keep the main window usable after its final workspace tab is closed.
      if (!this.tabs.size && !this.disposed) await this.newTab(); else this.notify();
    } finally { await this.disposeHost(host); }
    return this.snapshot();
  }
  descriptors() {
    return [...this.tabs.values()].map(host => {
      const state = host.session.snapshot();
      return { projectPaths: state.projects.map(item => item.projectPath), activeProjectPath: state.projects.find(item => item.id === state.activeProjectId)?.projectPath || '' };
    });
  }
  async dispose() {
    if (this.disposed) return; this.disposed = true;
    const hosts = [...this.tabs.values()]; this.tabs.clear(); this.activeTabId = '';
    for (const host of hosts) if (!host.contents.isDestroyed()) host.contents.close({ waitForBeforeUnload: false });
    await Promise.allSettled(hosts.map(host => this.disposeHost(host)));
  }
}

function restoredWorkspaceTabs(saved) {
  if (!Array.isArray(saved?.workspaceTabs) || !saved.workspaceTabs.length) return null;
  const tabs = saved.workspaceTabs.slice(0, 50).filter(item => item && typeof item === 'object' && Array.isArray(item.projectPaths)).map(item => ({
    projectPaths: item.projectPaths.filter(root => typeof root === 'string' && root.length > 0),
    activeProjectPath: typeof item.activeProjectPath === 'string' ? item.activeProjectPath : ''
  }));
  return tabs.length ? tabs : null;
}
module.exports = { TabbedWindow, restoredWorkspaceTabs };
