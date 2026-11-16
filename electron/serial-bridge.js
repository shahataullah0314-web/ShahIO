'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class SerialBridge extends EventEmitter {
  constructor(python, script) {
    super();
    this.pending = new Map();
    this.nextId = 0;
    this.dead = false;
    this.child = spawn(python, ['-u', script], { windowsHide: true, shell: false });
    this.child.stdin.on('error', e => this.fail(e));
    this.child.on('error', e => this.fail(e));
    this.child.on('close', () => this.fail(new Error('Serial helper stopped. Reconnect to start it again.')));
    this.child.stderr.on('data', b => { this.lastError = String(b).slice(-2000); });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let data;
      try { data = JSON.parse(line); } catch { return; }
      if (data.id !== undefined) {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(data.id);
        if (data.ok) pending.resolve(data.data);
        else pending.reject(new Error(data.error || 'Serial operation failed.'));
      } else this.emit('message', data);
    });
  }

  fail(error) {
    if (this.dead) return;
    this.dead = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.emit('message', { event: 'error', message: this.lastError || error.message });
  }

  request(action, data = {}) {
    if (this.dead) return Promise.reject(new Error('Serial helper is not running.'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.fail(new Error('Serial operation timed out. Reconnect and retry.'));
        this.child.kill();
        reject(new Error('Serial operation timed out. Reconnect and retry.'));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, action, ...data }) + '\n');
    });
  }

  async dispose() {
    if (this.dead) return;
    try { await this.request('shutdown'); } catch { /* Process may already be closed. */ }
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 1000);
    timer.unref();
  }
}
module.exports = { SerialBridge };
