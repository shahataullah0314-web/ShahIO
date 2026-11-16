'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { discoverPython, readProject, commandArgs } = require('./pio');
const { SerialBridge } = require('./serial-bridge');

class WorkspaceService extends EventEmitter {
  constructor({ projectPath, workerPath, packaged = false, launch = spawn, discover = discoverPython, makeBridge = (python, script) => new SerialBridge(python, script) }) {
    super();
    this.launch = launch;
    this.discover = discover;
    this.makeBridge = makeBridge;
    this.workerPath = workerPath;
    this.serialFailureEpoch = 0;
    this.state = {
      projectPath, environment: 'uno', environments: [], packaged,
      pio: { available: false, version: '', python: '', error: 'Checking PlatformIO…' },
      build: { running: false, action: '' },
      serial: { connected: false, port: '', baud: 9600, demo: false }
    };
    try { Object.assign(this.state, readProject(projectPath)); }
    catch (e) { this.state.projectError = e.message; }
  }

  snapshot() { return structuredClone(this.state); }
  event(data) { this.emit('event', data); }
  changed() { this.event({ type: 'state', state: this.snapshot() }); return this.snapshot(); }

  async initialize() {
    if (!this.discovering) this.discovering = this.discover().then(pio => { this.state.pio = pio; this.changed(); return pio; });
    await this.discovering;
    return this.snapshot();
  }

  async bridge() {
    await this.initialize();
    if (!this.state.pio.available) throw new Error(this.state.pio.error);
    if (!this.serialBridge || this.serialBridge.dead) {
      this.serialBridge = this.makeBridge(this.state.pio.python, this.workerPath);
      this.serialBridge.on('message', message => {
        if (message.event === 'line') this.event({ type: 'serial-line', line: message.line });
        if (message.event === 'notice') this.event({ type: 'notice', message: message.message });
        if (message.event === 'error') {
          this.serialFailureEpoch++;
          this.state.serial.connected = false;
          this.event({ type: 'serial-error', message: message.message });
          this.changed();
        }
        if (message.event === 'closed') { this.serialFailureEpoch++; this.state.serial.connected = false; this.changed(); }
      });
    }
    return this.serialBridge;
  }

  async setProject(projectPath) {
    if (this.state.build.running) throw new Error('Wait for the current build to finish.');
    const project = readProject(projectPath);
    await this.disconnectSerial();
    Object.assign(this.state, project, { projectError: '' });
    return this.changed();
  }

  async listPorts() { return (await this.bridge()).request('list'); }

  async connectSerial({ port, baud }) {
    if (this.state.build.running) throw new Error('Wait for the current build to finish before connecting.');
    if (this.serialBusy) throw new Error('A serial connection change is in progress.');
    if (!/^COM\d+$/i.test(port || '') || ![9600, 19200, 38400, 57600, 115200, 230400].includes(baud)) throw new Error('Select a valid COM port and baud rate.');
    this.serialBusy = true;
    try {
      await this.disconnectSerial();
      const bridge = await this.bridge();
      const failureEpoch = this.serialFailureEpoch;
      await bridge.request('open', { port, baud });
      if (this.serialFailureEpoch !== failureEpoch) throw new Error('Serial connection closed while opening. Check the device and reconnect.');
      this.state.serial = { connected: true, port, baud, demo: false };
      return this.changed();
    } finally { this.serialBusy = false; }
  }

  async disconnectSerial() {
    clearInterval(this.demoTimer);
    this.demoTimer = null;
    if (this.serialBridge && !this.serialBridge.dead) await this.serialBridge.request('close');
    this.state.serial = { ...this.state.serial, connected: false, demo: false };
    return this.changed();
  }

  async setDemo(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid demo mode.');
    if (this.state.build.running || this.serialBusy) throw new Error('Wait for the current operation to finish.');
    await this.disconnectSerial();
    if (enabled) {
      this.state.serial = { connected: true, port: 'DEMO', baud: 9600, demo: true };
      this.demoStep = 0;
      this.demoStopped = false;
      this.changed();
      this.event({ type: 'serial-line', line: 'DEMO: Simulated telemetry. No hardware is connected.' });
      const tick = () => {
        const active = this.demoStopped ? -1 : this.demoStep++ % 16;
        this.event({ type: 'serial-line', line: 'STATUS:' + Array.from({ length: 16 }, (_, i) => Number(i === active)).join(',') });
      };
      tick();
      this.demoTimer = setInterval(tick, 400);
      this.demoTimer.unref?.();
    }
    return this.changed();
  }

  async sendSerial(command) {
    if (typeof command !== 'string' || !/^[\x20-\x7e]{1,120}$/.test(command)) throw new Error('Use 1–120 printable ASCII characters with no line breaks.');
    if (!this.state.serial.connected) throw new Error('Connect a serial port first.');
    if (this.state.serial.demo) {
      if (command === 'EMERGENCY_STOP') this.demoStopped = true;
      if (['RESUME', 'CALIBRATE_PINS', 'EMBOSS_LINE'].includes(command)) this.demoStopped = false;
      this.event({ type: 'serial-line', line: `DEMO ACK: ${command}` });
    } else await (await this.bridge()).request('write', { command });
    return { ok: true };
  }

  async runCommand(input) {
    if (this.state.build.running || this.serialBusy) throw new Error('Another build or connection change is in progress.');
    const args = commandArgs(input || {}, this.state.environments);
    if (input.action === 'upload' && this.state.serial.demo) throw new Error('Turn off demo mode and select a real COM port before uploading.');
    this.state.build = { running: true, action: input.action };
    this.state.environment = input.environment;
    this.cancelled = false;
    this.changed();
    try {
      await this.initialize();
      if (!this.state.pio.available) throw new Error(this.state.pio.error);
      // Reread before each command so removed/changed environments cannot launch stale targets.
      const project = readProject(this.state.projectPath);
      commandArgs(input, project.environments);
      if (input.action === 'upload') {
        const ports = await this.listPorts();
        if (!ports.some(p => p.path.toUpperCase() === input.port.toUpperCase())) throw new Error('That COM port is no longer available. Refresh the port list.');
        await this.disconnectSerial();
        this.event({ type: 'notice', message: 'Serial monitor released for upload. Reconnect after upload finishes.' });
      }
      if (this.cancelled) return { exitCode: null, cancelled: true };
      this.event({ type: 'build-output', stream: 'stdout', text: `\n> python ${args.join(' ')}\nProject: ${this.state.projectPath}\n\n` });
      const result = await new Promise((resolve, reject) => {
        let child;
        try { child = this.launch(this.state.pio.python, args, { cwd: this.state.projectPath, windowsHide: true, shell: false, env: { ...process.env, PYTHONUNBUFFERED: '1', PLATFORMIO_FORCE_COLOR: 'false' } }); }
        catch (e) { reject(e); return; }
        this.buildChild = child;
        child.stdout.on('data', b => this.event({ type: 'build-output', stream: 'stdout', text: String(b) }));
        child.stderr.on('data', b => this.event({ type: 'build-output', stream: 'stderr', text: String(b) }));
        child.once('error', reject);
        child.once('close', code => resolve({ exitCode: code, cancelled: this.cancelled }));
      });
      return result;
    } finally {
      this.buildChild = null;
      this.state.build = { running: false, action: '' };
      this.changed();
    }
  }

  async cancelBuild() {
    if (!this.state.build.running) return { ok: true };
    this.cancelled = true;
    if (this.buildChild?.pid) {
      const child = this.buildChild;
      if (process.platform === 'win32') {
        await new Promise(resolve => {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false });
          const timer = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 5000);
          killer.on('error', () => { clearTimeout(timer); child.kill(); resolve(); });
          killer.on('close', () => { clearTimeout(timer); resolve(); });
        });
      } else child.kill('SIGTERM');
    }
    return { ok: true };
  }

  async dispose() {
    clearInterval(this.demoTimer);
    await this.cancelBuild();
    await this.serialBridge?.dispose();
  }
}
module.exports = { WorkspaceService };
