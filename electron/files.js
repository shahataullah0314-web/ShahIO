'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const MAX_FILE_SIZE = 256 * 1024 * 1024;
const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024;
const BINARY_PREVIEW_SIZE = 4096;
const MAX_CHUNK_SIZE = 65536;
const TEXT_LIMIT_MESSAGE = 'This text file is larger than the 256 MiB editing limit. Split it into smaller files before editing.';
const GENERATED_DIRECTORIES = new Set(['.git', '.pio', 'node_modules', 'dist', '.embosser-control', '.shahio', '__pycache__']);
const BINARY_EXTENSIONS = new Set(['.exe', '.dll', '.node', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf', '.zip', '.7z', '.gz', '.tar', '.rar', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.mp4', '.webm', '.mov', '.bin', '.elf', '.o', '.a', '.pyc']);
const LANGUAGES = { '.c': 'cpp', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.h': 'cpp', '.hpp': 'cpp', '.ino': 'cpp', '.json': 'json', '.ini': 'ini', '.py': 'python', '.md': 'markdown', '.js': 'javascript', '.cjs': 'javascript', '.mjs': 'javascript', '.ts': 'typescript', '.html': 'html', '.css': 'css', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml' };

function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function hashFile(filename) {
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(filename, 'r');
  try {
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return digest.digest('hex');
}

function decode(buffer) {
  if (buffer.includes(0)) throw new Error('This is a binary file. The editor opens UTF-8 text files only.');
  try {
    // Keep a UTF-8 BOM in the editable content as well as the returned metadata.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw new Error('This file is not valid UTF-8 text. Convert its encoding before editing.');
  }
}

function encodingInfo(content) {
  // Inspect line endings without creating another document-sized string.
  let lf = content.indexOf('\n');
  if (lf < 0) return { bom: content.startsWith('\uFEFF'), eol: content.includes('\r') ? '\r' : null };
  let onlyCRLF = true;
  for (; lf >= 0; lf = content.indexOf('\n', lf + 1)) {
    if (lf === 0 || content.charCodeAt(lf - 1) !== 13) { onlyCRLF = false; break; }
  }
  if (onlyCRLF) for (let cr = content.indexOf('\r'); cr >= 0; cr = content.indexOf('\r', cr + 1)) {
    if (content.charCodeAt(cr + 1) !== 10) { onlyCRLF = false; break; }
  }
  const eol = onlyCRLF ? '\r\n' : '\n';
  return { bom: content.startsWith('\uFEFF'), eol };
}

function textDocument(normalized, content, version, size) {
  return {
    path: normalized, name: path.posix.basename(normalized), kind: 'text', size,
    largeFile: size > LARGE_FILE_THRESHOLD, content, version,
    language: LANGUAGES[path.extname(normalized).toLowerCase()] || 'text',
    ...encodingInfo(content)
  };
}

function inspectTextFile(filename) {
  const descriptor = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const digest = crypto.createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let bom = false, first = true, pendingCR = false, crlf = false, bareLF = false, bareCR = false;
  try {
    const initial = fs.fstatSync(descriptor);
    if (!initial.isFile()) throw new Error('Choose a text file to edit.');
    if (initial.size > MAX_FILE_SIZE) throw new Error(TEXT_LIMIT_MESSAGE);
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      const chunk = buffer.subarray(0, count);
      if (chunk.includes(0)) throw new Error('Binary files are read-only. Open them in the binary preview.');
      try { decoder.decode(chunk, { stream: true }); }
      catch { throw new Error('Binary files are read-only. This file is not valid UTF-8 text.'); }
      digest.update(chunk);
      if (first) { bom = count >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf; first = false; }
      for (const byte of chunk) {
        if (pendingCR) {
          pendingCR = false;
          if (byte === 10) { crlf = true; continue; }
          bareCR = true;
        }
        if (byte === 13) pendingCR = true;
        else if (byte === 10) bareLF = true;
      }
    }
    try { decoder.decode(); }
    catch { throw new Error('Binary files are read-only. This file is not valid UTF-8 text.'); }
    if (pendingCR) bareCR = true;
    const current = fs.fstatSync(descriptor);
    if (current.size !== initial.size || current.mtimeMs !== initial.mtimeMs) throw new Error('This file changed on disk while reading. Reload it before saving.');
    return { version: digest.digest('hex'), bom, size: current.size, eol: crlf && !bareLF && !bareCR ? '\r\n' : bareLF || crlf ? '\n' : bareCR ? '\r' : null };
  } finally { fs.closeSync(descriptor); }
}

class WorkspaceFiles {
  constructor(root) {
    if (typeof root !== 'string' || !root || root.includes('\0')) throw new Error('Choose a valid project folder.');
    this.root = fs.realpathSync.native(path.resolve(root));
    if (!fs.statSync(this.root).isDirectory()) throw new Error('The project path must be a folder.');
  }

  normalize(relativePath = '', allowRoot = false) {
    if (typeof relativePath !== 'string' || relativePath.includes('\0') || relativePath.includes(':') || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)) {
      throw new Error('Use a file path inside the project folder.');
    }
    const parts = relativePath.replace(/\\/g, '/').split('/').filter(part => part !== '' && part !== '.');
    if (parts.some(part => part === '..' || /[<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
      throw new Error('The path must stay inside the project and use valid file names.');
    }
    if (!parts.length && !allowRoot) throw new Error('Choose a file or folder inside the project.');
    return parts.join('/');
  }

  assertInside(realPath) {
    const relative = path.relative(this.root, realPath);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('This path points outside the project folder.');
    return realPath;
  }

  resolveExisting(relativePath, allowRoot = false) {
    const normalized = this.normalize(relativePath, allowRoot);
    const lexical = path.resolve(this.root, ...normalized.split('/'));
    this.assertInside(lexical);
    const real = fs.realpathSync.native(lexical);
    this.assertInside(real);
    return { normalized, real };
  }

  resolveNew(relativePath) {
    const normalized = this.normalize(relativePath);
    const parentPath = path.posix.dirname(normalized);
    const parent = this.resolveExisting(parentPath === '.' ? '' : parentPath, true);
    if (!fs.statSync(parent.real).isDirectory()) throw new Error('The parent path is not a folder.');
    const real = path.join(parent.real, path.posix.basename(normalized));
    this.assertInside(real);
    // lstat also notices broken links. Creating a file must never follow one.
    try {
      fs.lstatSync(real);
      throw new Error('A file or folder already exists at that path.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { normalized, real };
  }

  list(relativePath = '', { includeHiddenGenerated = false } = {}) {
    const folder = this.resolveExisting(relativePath, true);
    if (!fs.statSync(folder.real).isDirectory()) throw new Error('Choose a folder to browse its files.');
    const result = [];
    for (const entry of fs.readdirSync(folder.real, { withFileTypes: true })) {
      if (!includeHiddenGenerated && GENERATED_DIRECTORIES.has(entry.name)) continue;
      const relative = folder.normalized ? folder.normalized + '/' + entry.name : entry.name;
      try {
        const target = this.resolveExisting(relative);
        const stat = fs.statSync(target.real);
        if (!stat.isDirectory() && !stat.isFile()) continue;
        const type = stat.isDirectory() ? 'directory' : 'file';
        result.push({
          name: entry.name, path: relative, type, size: type === 'file' ? stat.size : 0,
          editable: type === 'file' && stat.size <= MAX_FILE_SIZE && !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        });
      } catch {
        // Broken or escaping links cannot be browsed through this workspace.
      }
    }
    return result.sort((a, b) => (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  read(relativePath) {
    const target = this.resolveExisting(relativePath);
    const stat = fs.statSync(target.real);
    if (!stat.isFile()) throw new Error('Choose a file to open in the editor.');
    // Never read or hash an entire executable just to open its first page.
    if (BINARY_EXTENSIONS.has(path.extname(target.normalized).toLowerCase())) return this.binaryDocument(target, stat);
    const sample = this.readChunk({ path: target.normalized, length: BINARY_PREVIEW_SIZE });
    const sampleBuffer = Buffer.from(sample.bytes, 'base64');
    let binary = sampleBuffer.includes(0);
    if (!binary) {
      try { new TextDecoder('utf-8', { fatal: true }).decode(sampleBuffer, { stream: sample.hasMore }); }
      catch { binary = true; }
    }
    if (binary) return this.binaryDocument(target, stat, sample);
    if (stat.size > MAX_FILE_SIZE) throw new Error(TEXT_LIMIT_MESSAGE);
    const buffer = fs.readFileSync(target.real);
    if (buffer.length > MAX_FILE_SIZE) throw new Error(TEXT_LIMIT_MESSAGE);
    let content;
    try { content = decode(buffer); }
    catch { return this.binaryDocument(target, fs.statSync(target.real), sample); }
    return textDocument(target.normalized, content, hash(buffer), buffer.length);
  }

  binaryDocument(target, stat, preview) {
    return {
      path: target.normalized, name: path.posix.basename(target.normalized), kind: 'binary', size: stat.size,
      content: '', language: 'binary', readOnly: true, version: `${stat.size}:${stat.mtimeMs}`,
      preview: preview || this.readChunk({ path: target.normalized, length: BINARY_PREVIEW_SIZE })
    };
  }

  readChunk({ path: relativePath, offset = 0, length = BINARY_PREVIEW_SIZE } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Choose a non-negative whole-byte offset.');
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_CHUNK_SIZE) throw new Error('Read between 1 and 65536 bytes per binary page.');
    const target = this.resolveExisting(relativePath);
    const descriptor = fs.openSync(target.real, 'r');
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile()) throw new Error('Choose a file for binary preview.');
      const start = Math.min(offset, stat.size);
      const buffer = Buffer.allocUnsafe(Math.min(length, stat.size - start));
      let count = 0;
      while (count < buffer.length) {
        const read = fs.readSync(descriptor, buffer, count, buffer.length - count, start + count);
        if (!read) break;
        count += read;
      }
      return { offset: start, bytes: buffer.subarray(0, count).toString('base64'), length: count, totalSize: stat.size, hasMore: start + count < stat.size };
    } finally { fs.closeSync(descriptor); }
  }

  encode(content, original) {
    if (typeof content !== 'string') throw new Error('File content must be text.');
    let encoded = content;
    if (original?.bom && !encoded.startsWith('\uFEFF')) encoded = '\uFEFF' + encoded;
    if (original?.eol === '\r\n' && /(?<!\r)\n|\r(?!\n)/.test(encoded)) encoded = encoded.replace(/\r\n|\r|\n/g, '\r\n');
    if (Buffer.byteLength(encoded, 'utf8') > MAX_FILE_SIZE) throw new Error(TEXT_LIMIT_MESSAGE);
    if (encoded.includes('\0')) throw new Error('Binary files are read-only. Create a UTF-8 text file for editing.');
    const buffer = Buffer.from(encoded, 'utf8');
    return { buffer, content: encoded };
  }

  write({ path: relativePath, content, version, force = false } = {}) {
    const target = this.resolveExisting(relativePath);
    if (BINARY_EXTENSIONS.has(path.extname(target.normalized).toLowerCase())) throw new Error('Binary files are read-only. Open them in the binary preview.');
    const original = inspectTextFile(target.real);
    if (force !== true && version !== original.version) throw new Error('This file changed on disk. Reload it before saving, or explicitly overwrite the newer version.');
    const encoded = this.encode(content, original);
    const buffer = encoded.buffer;
    const temporary = path.join(path.dirname(target.real), '.' + path.basename(target.real) + '.shahio-' + process.pid + '-' + crypto.randomBytes(8).toString('hex') + '.tmp');
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', fs.statSync(target.real).mode);
      fs.writeFileSync(descriptor, buffer);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      // Recheck after writing the temporary file, before replacing user content.
      const currentTarget = this.resolveExisting(relativePath);
      if (currentTarget.real !== target.real || (force !== true && (fs.statSync(currentTarget.real).size !== original.size || hashFile(currentTarget.real) !== original.version))) {
        throw new Error('This file changed on disk while saving. Reload it before trying again.');
      }
      fs.renameSync(temporary, target.real);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      // Only remove our unique temporary file, never the user's file.
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return textDocument(target.normalized, encoded.content, hash(buffer), buffer.length);
  }

  createFile({ path: relativePath, content = '' } = {}) {
    const target = this.resolveNew(relativePath);
    if (BINARY_EXTENSIONS.has(path.extname(target.normalized).toLowerCase())) throw new Error('Create a UTF-8 text file for editing.');
    const encoded = this.encode(content);
    const buffer = encoded.buffer;
    const descriptor = fs.openSync(target.real, 'wx');
    try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    return textDocument(target.normalized, encoded.content, hash(buffer), buffer.length);
  }

  createDirectory(relativePath) {
    const target = this.resolveNew(relativePath);
    fs.mkdirSync(target.real);
    return { path: target.normalized };
  }
}

module.exports = { WorkspaceFiles, MAX_FILE_SIZE, LARGE_FILE_THRESHOLD };
