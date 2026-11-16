'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const readline = require('node:readline');

function terminalSize({ cols = 100, rows = 25 } = {}) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 1000 || rows < 2 || rows > 500) throw new Error('Terminal size must be 2–1000 columns and 2–500 rows.');
  return { cols, rows };
}

class TerminalSession extends EventEmitter {
  constructor({ python, workerPath, cwd, env = process.env, shell = 'powershell', spawnProcess = spawn }) {
    super();
    if (!['powershell', 'cmd'].includes(shell)) throw new Error('Choose PowerShell or Command Prompt.');
    if (typeof python !== 'string' || !python || typeof workerPath !== 'string' || !workerPath) throw new Error('The terminal Python helper is unavailable.');
    if (typeof cwd !== 'string' || !fs.statSync(cwd).isDirectory()) throw new Error('Choose an existing project folder for the terminal.');
    this.options = { python, workerPath, cwd, env, shell };
    this.spawnProcess = spawnProcess;
    this.pending = new Map(); this.sequence = 0; this.dead = false; this.closing = false; this.exitSent = false;
  }
  start(size = {}) {
    const { cols, rows } = terminalSize(size);
    if (this.startPromise) return this.startPromise;
    if (this.dead) return Promise.reject(new Error('Create a new terminal after this session ends.'));
    const { python, workerPath, cwd, env, shell } = this.options;
    this.startPromise = new Promise((resolve, reject) => {
      this.resolveStart = resolve; this.rejectStart = reject;
      this.startTimer = setTimeout(() => { this.failure(new Error('The terminal did not start in time.')); this.child?.kill(); }, 20000);
      try {
        this.child = this.spawnProcess(python, ['-u', workerPath, '--shell', shell, '--cwd', cwd, '--cols', String(cols), '--rows', String(rows)], { cwd, windowsHide: true, shell: false, env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } });
        this.child.stdin.on('error', error => { if (!this.closing) this.failure(error); });
        this.child.on('error', error => this.failure(error));
        this.child.stderr.on('data', data => { this.lastError = ((this.lastError || '') + String(data)).slice(-4000); });
        this.lines = readline.createInterface({ input: this.child.stdout });
        this.lines.on('line', line => this.message(line));
        this.closePromise = new Promise(done => this.child.once('close', code => {
          this.dead = true; clearTimeout(this.startTimer);
          if (this.rejectStart) { this.rejectStart(new Error(this.lastError || 'The terminal helper stopped before the shell opened.')); this.rejectStart = null; }
          this.rejectPending(new Error('This terminal session has ended.'));
          if (!this.exitSent) { this.exitSent = true; this.emit('exit', code ?? -1); }
          done();
        }));
      } catch (error) { this.failure(error); }
    });
    return this.startPromise;
  }
  message(line) {
    if (line.length > 65536) { this.failure(new Error('The terminal helper sent an oversized message.')); this.child?.kill(); return; }
    let data; try { data = JSON.parse(line); } catch { return; }
    if (data.id !== undefined) {
      const entry = this.pending.get(data.id); if (!entry) return;
      this.pending.delete(data.id); clearTimeout(entry.timer);
      if (data.ok) entry.resolve({ ok: true }); else entry.reject(new Error(data.error || 'Terminal request failed.'));
      return;
    }
    this.emit('message', data);
    if (data.type === 'ready') {
      clearTimeout(this.startTimer); this.rejectStart = null;
      this.state = { shell: data.shell, cwd: data.cwd, cols: data.cols, rows: data.rows };
      this.resolveStart?.(this.state); this.resolveStart = null;
    } else if (data.type === 'data' && typeof data.data === 'string') this.emit('data', data.data);
    else if (data.type === 'exit') { this.dead = true; this.exitSent = true; this.rejectPending(new Error('This terminal session has ended.')); this.emit('exit', data.code ?? 0); this.child?.stdin.end(); }
    else if (data.type === 'error') { if (data.fatal) { this.failure(new Error(data.message)); this.child?.kill(); } else this.emit('terminal-error', data.message); }
  }
  rejectPending(error) { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear(); }
  failure(error) {
    if (this.dead) return; this.dead = true; clearTimeout(this.startTimer);
    this.rejectStart?.(error); this.rejectStart = null; this.resolveStart = null;
    this.rejectPending(error); this.emit('terminal-error', error.message);
  }
  request(action, data) {
    if (this.dead || !this.child || !this.state) return Promise.reject(new Error('The terminal is not running.'));
    if (this.pending.size >= 64) return Promise.reject(new Error('The terminal is busy. Try a smaller paste.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The terminal did not acknowledge input.')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, action, ...data }) + '\n');
    });
  }
  write(data) {
    if (typeof data !== 'string' || data.length > 65536) return Promise.reject(new Error('Terminal input must contain at most 65536 characters per message.'));
    return this.request('write', { data });
  }
  resize(size) { const value = terminalSize(size); return this.request('resize', value).then(result => { Object.assign(this.state, value); return result; }); }
  async dispose() {
    if (this.closing) return this.closePromise;
    this.closing = true;
    if (!this.child) { this.dead = true; return; }
    if (!this.dead && this.state) { try { await this.request('close', {}); } catch { /* Shell may have just exited. */ } }
    this.child.stdin.end();
    const timer = setTimeout(() => { this.child.kill(); }, 2500);
    timer.unref();
    try { await this.closePromise; } finally { clearTimeout(timer); this.dead = true; this.lines?.close(); }
  }
}
module.exports = { TerminalSession, terminalSize };
