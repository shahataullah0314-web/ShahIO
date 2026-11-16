'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');

const MAX_CATALOG_BYTES = 20 * 1024 * 1024;
const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

function runBoardCommand(python, { timeout = 60000, maxBytes = MAX_CATALOG_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let child, timer, settled = false, bytes = 0, stdout = '', stderr = '';
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    try {
      child = spawn(python, ['-m', 'platformio', 'boards', '--json-output'], {
        shell: false, windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
      });
      timer = setTimeout(() => {
        child.kill();
        finish(new Error('The PlatformIO board catalog timed out. Check your connection and try again.'));
      }, timeout);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > maxBytes) {
          child.kill();
          finish(new Error('The PlatformIO board catalog is too large to read.'));
          return;
        }
        stdout += chunk;
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
      child.once('error', error => finish(new Error('Could not start PlatformIO to load boards: ' + error.message)));
      child.once('close', code => {
        if (code !== 0) finish(new Error('PlatformIO could not load the board catalog. ' + (stderr.trim() || `Process exited with code ${code}.`)));
        else finish(null, stdout);
      });
    } catch (error) { finish(new Error('Could not start PlatformIO to load boards: ' + error.message)); }
  });
}

function normalizeBoards(raw) {
  if (!Array.isArray(raw)) throw new Error('PlatformIO returned an invalid board catalog. Expected a JSON array.');
  const boards = raw.filter(board => board && typeof board.id === 'string' && typeof board.platform === 'string').map(board => ({
    id: board.id,
    name: typeof board.name === 'string' ? board.name : board.id,
    platform: board.platform,
    mcu: typeof board.mcu === 'string' ? board.mcu : '',
    frequency: Number.isFinite(Number(board.fcpu ?? board.frequency)) ? Number(board.fcpu ?? board.frequency) : 0,
    ram: Number.isFinite(Number(board.ram)) ? Number(board.ram) : 0,
    rom: Number.isFinite(Number(board.rom)) ? Number(board.rom) : 0,
    frameworks: Array.isArray(board.frameworks) ? board.frameworks.filter(framework => typeof framework === 'string') : []
  }));
  if (!boards.length) throw new Error('PlatformIO returned no available boards. Check PlatformIO Core and try again.');
  return boards.sort((a, b) => a.name.localeCompare(b.name) || a.platform.localeCompare(b.platform) || a.id.localeCompare(b.id));
}

class BoardCatalog {
  constructor({ pythonProvider, execute = runBoardCommand } = {}) {
    this.pythonProvider = pythonProvider;
    this.execute = execute;
    this.cache = new Map();
    this.pending = new Map();
  }

  async list(python, { refresh = false } = {}) {
    if (!python && this.pythonProvider) {
      const discovered = await this.pythonProvider();
      python = typeof discovered === 'string' ? discovered : discovered?.python;
    }
    if (typeof python !== 'string' || !python) throw new Error('PlatformIO is unavailable. Install PlatformIO Core or choose its Python executable before loading boards.');
    if (refresh) this.cache.delete(python);
    if (this.cache.has(python)) return structuredClone(this.cache.get(python));
    if (!this.pending.has(python)) {
      const request = (async () => {
        const output = await this.execute(python);
        let raw;
        try { raw = typeof output === 'string' ? JSON.parse(output.replace(/^\uFEFF/, '')) : output; }
        catch { throw new Error('PlatformIO returned invalid JSON for the board catalog. Try again or update PlatformIO Core.'); }
        const boards = normalizeBoards(raw);
        this.cache.set(python, boards);
        return boards;
      })();
      this.pending.set(python, request);
      request.finally(() => this.pending.delete(python)).catch(() => {});
    }
    return structuredClone(await this.pending.get(python));
  }

  async find(boardId, python) {
    if (typeof boardId !== 'string' || !boardId) throw new Error('Select a board from the PlatformIO catalog.');
    const board = (await this.list(python)).find(item => item.id === boardId);
    if (!board) throw new Error('That board is not in the current PlatformIO catalog. Refresh the list and select it again.');
    return board;
  }
}

function addEnvironment(projectPath, { board, environment, framework = '' } = {}) {
  if (typeof environment !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(environment)) {
    throw new Error('Environment name must contain 1–64 letters, numbers, underscores, or hyphens.');
  }
  const iniValue = value => typeof value === 'string' && /^[A-Za-z0-9_.+-]+$/.test(value);
  if (!board || !iniValue(board.id) || !iniValue(board.platform)) throw new Error('Choose a valid board from the PlatformIO catalog.');
  const frameworks = Array.isArray(board.frameworks) ? board.frameworks : [];
  if (typeof framework !== 'string' || (framework && (!iniValue(framework) || !frameworks.includes(framework)))) {
    throw new Error('Choose a framework supported by this board.');
  }
  if (frameworks.length && !framework) throw new Error('Choose a framework supported by this board.');
  const root = fs.realpathSync(projectPath);
  if (!fs.statSync(root).isDirectory()) throw new Error('The project folder is unavailable.');
  const configPath = path.join(root, 'platformio.ini');
  let original = Buffer.alloc(0), mode;
  try {
    const stat = fs.lstatSync(configPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('platformio.ini must be a regular file inside the project folder.');
    if (stat.size > MAX_CONFIG_BYTES) throw new Error('platformio.ini is too large to update.');
    original = fs.readFileSync(configPath);
    mode = stat.mode;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const content = original.toString('utf8');
  if (content.includes('\0')) throw new Error('platformio.ini is not a text configuration file.');
  const existing = [...content.matchAll(/^\s*\[env:([^\]\r\n]+)\]\s*(?:[;#].*)?$/gm)].map(match => match[1].trim().toLowerCase());
  if (existing.includes(environment.toLowerCase())) throw new Error(`Environment "${environment}" already exists. Choose a different name.`);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const addition = [`[env:${environment}]`, `platform = ${board.platform}`, `board = ${board.id}`, ...(framework ? [`framework = ${framework}`] : [])].join(newline) + newline;
  const updated = content + (content ? (content.endsWith('\n') ? newline : newline + newline) : '') + addition;
  const temporaryPath = path.join(root, `.platformio.ini-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, updated, { encoding: 'utf8', flag: 'wx', ...(mode ? { mode } : {}) });
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch { /* Temporary file may not have been created. */ }
    throw error;
  }
  return { path: 'platformio.ini', environment, boardId: board.id, platform: board.platform, framework, content: updated, version: createHash('sha256').update(updated).digest('hex') };
}

module.exports = { BoardCatalog, normalizeBoards, runBoardCommand, addEnvironment };
