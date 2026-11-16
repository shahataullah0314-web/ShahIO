'use strict';
const fs = require('node:fs');
const path = require('node:path');

function existingFolders(candidates) {
  const seen = new Set();
  return candidates.filter(root => {
    if (typeof root !== 'string' || !root) return false;
    try {
      if (!fs.statSync(root).isDirectory()) return false;
      const real = fs.realpathSync(root);
      const key = process.platform === 'win32' ? real.toLowerCase() : real;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    } catch { return false; }
  });
}

function startupProjects({ requested, saved = {}, packaged = false, sourceRoot, starterSource, documentsPath }) {
  if (requested) return existingFolders([requested]);
  const previous = existingFolders([...(Array.isArray(saved.workspaceFolders) ? saved.workspaceFolders : []), saved.projectPath]);
  if (previous.length) return previous;
  if (!packaged && fs.existsSync(path.join(sourceRoot, 'platformio.ini'))) return [sourceRoot];
  if (!starterSource || !fs.existsSync(starterSource)) return [];
  const projects = path.join(documentsPath, 'ShahIO Projects');
  fs.mkdirSync(projects, { recursive: true });
  // Only create a fresh directory; an existing example may contain user edits.
  let destination = path.join(projects, 'ShahIO Example');
  let suffix = 2;
  while (fs.existsSync(destination)) destination = path.join(projects, `ShahIO Example ${suffix++}`);
  fs.cpSync(starterSource, destination, { recursive: true, errorOnExist: true, force: false });
  return [destination];
}
module.exports = { existingFolders, startupProjects };
