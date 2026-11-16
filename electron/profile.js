'use strict';
const fs = require('node:fs');
const path = require('node:path');

function readSettings(filename) {
  const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object.');
  return value;
}

// Import just workspace settings once. Projects, PlatformIO caches, and the old
// Chromium profile stay where they are; existing ShahIO settings always win.
function loadSettings({ profileRoot, legacyRoot, migrate = true }) {
  fs.mkdirSync(profileRoot, { recursive: true });
  const filename = path.join(profileRoot, 'settings.json');
  if (fs.existsSync(filename)) {
    try { return readSettings(filename); } catch { return {}; }
  }
  if (migrate && legacyRoot) {
    const previous = path.join(legacyRoot, 'settings.json');
    try {
      const settings = readSettings(previous);
      fs.writeFileSync(filename, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      return settings;
    } catch { /* A missing or invalid legacy profile must not block startup. */ }
  }
  return {};
}

module.exports = { loadSettings };
