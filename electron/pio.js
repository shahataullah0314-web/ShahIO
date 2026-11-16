'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function capture(file, args, timeout = 8000) {
  return new Promise((resolve) => {
    let output = '', error = '', settled = false;
    let child;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output, error });
    };
    const timer = setTimeout(() => { child?.kill(); error += 'Timed out'; finish(-1); }, timeout);
    try {
      child = spawn(file, args, { windowsHide: true, shell: false });
      child.stdout.on('data', (b) => { output = (output + b).slice(-16000); });
      child.stderr.on('data', (b) => { error = (error + b).slice(-16000); });
      child.on('error', (e) => { error = e.message; finish(-1); });
      child.on('close', finish);
    } catch (e) { error = e.message; finish(-1); }
  });
}

function subdirectories(root) {
  try { return fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(root, d.name)); }
  catch { return []; }
}

function configureBundledTools(resourcesPath = process.resourcesPath) {
  if (!resourcesPath) return [];
  const directories = [path.join(resourcesPath, 'git', 'cmd'), path.join(resourcesPath, 'git', 'ucrt64', 'bin'), path.join(resourcesPath, 'git', 'mingw64', 'bin')].filter(dir => fs.existsSync(dir));
  if (directories.length) process.env.PATH = [...directories, process.env.PATH || ''].join(path.delimiter);
  process.env.PYTHONDONTWRITEBYTECODE = '1';
  process.env.PYTHONIOENCODING = 'utf-8';
  return directories;
}

async function discoverPython({ resourcesPath = process.resourcesPath } = {}) {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const roots = [path.join(local, 'Python'), path.join(local, 'Programs', 'Python')];
  const candidates = [
    process.env.PIO_PYTHON,
    resourcesPath ? path.join(resourcesPath, 'python', 'python.exe') : null,
    path.join(os.homedir(), '.platformio', 'penv', 'Scripts', 'python.exe'),
    ...roots.flatMap(root => subdirectories(root).sort().reverse().map(dir => path.join(dir, 'python.exe')))
  ].filter(Boolean);
  const probe = async list => { for (const python of [...new Set(list)]) {
    if (!fs.existsSync(python)) continue;
    const result = await capture(python, ['-m', 'platformio', '--version']);
    if (result.code === 0 && /PlatformIO Core/.test(result.output)) {
      return { available: true, python, version: result.output.trim() };
    }
  } return null; };
  const existing = await probe(candidates);
  if (existing) return existing;
  const where = await capture('where.exe', ['python.exe'], 3000);
  const fallback = await probe(where.output.split(/\r?\n/).filter(p => p && !p.includes('WindowsApps')));
  if (fallback) return fallback;
  return { available: false, python: '', version: '', error: 'PlatformIO Python was not found. Install PlatformIO Core or set PIO_PYTHON to the full path of its python.exe, then restart the app.' };
}

function readProject(projectPath) {
  const configPath = path.join(projectPath, 'platformio.ini');
  const ini = fs.readFileSync(configPath, 'utf8');
  const environments = [...ini.matchAll(/^\s*\[env:([^\]\r\n]+)\]\s*(?:[;#].*)?$/gm)].map(m => m[1].trim());
  if (!environments.length) throw new Error('This project has no [env:...] sections in platformio.ini.');
  return { projectPath: path.resolve(projectPath), environments, environment: environments[0] };
}

function commandArgs({ action, environment, port }, environments) {
  const targets = { build: [], upload: ['--target', 'upload'], clean: ['--target', 'clean'], install: [] };
  if (!Object.hasOwn(targets, action)) throw new Error('Choose build, upload, clean, or install dependencies.');
  if (!environments.includes(environment)) throw new Error('Select a valid project environment.');
  const args = action === 'install'
    ? ['-m', 'platformio', 'pkg', 'install', '--environment', environment]
    : ['-m', 'platformio', 'run', '--environment', environment, ...targets[action]];
  if (action === 'upload') {
    if (typeof port !== 'string' || !/^COM\d+$/i.test(port)) throw new Error('Select an available COM port before uploading.');
    args.push('--upload-port', port);
  }
  return args;
}

module.exports = { capture, discoverPython, readProject, commandArgs, configureBundledTools };
