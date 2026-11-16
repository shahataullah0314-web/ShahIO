'use strict';
const fs = require('node:fs');
const path = require('node:path');

const INVALID_NAME = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
const ENVIRONMENT_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const INI_VALUE = /^[A-Za-z0-9_.+-]+$/;

function projectName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80 || value !== value.trim() || value === '.' || value === '..' || INVALID_NAME.test(value) || RESERVED_NAME.test(value) || /[. ]$/.test(value)) {
    throw new Error('Project name must contain 1–80 valid Windows folder characters, with no slashes, reserved names, or trailing spaces/dots.');
  }
  return value;
}

function selectedSettings(board, environment, framework) {
  if (!board || typeof board.id !== 'string' || typeof board.platform !== 'string' || !INI_VALUE.test(board.id) || !INI_VALUE.test(board.platform)) throw new Error('Select a valid board from the PlatformIO catalog.');
  const frameworks = Array.isArray(board.frameworks) ? board.frameworks.filter(item => typeof item === 'string') : [];
  if (framework === undefined) framework = frameworks.includes('arduino') ? 'arduino' : frameworks[0] || '';
  if (typeof framework !== 'string' || (framework && (!INI_VALUE.test(framework) || !frameworks.includes(framework))) || (!framework && frameworks.length)) throw new Error('Select a framework supported by this board.');
  if (environment === undefined || environment === '') environment = board.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'project';
  if (typeof environment !== 'string' || !ENVIRONMENT_NAME.test(environment)) throw new Error('Environment name must contain 1–64 letters, numbers, underscores, or hyphens.');
  return { board, environment, framework };
}

function sourceFiles(framework, name) {
  if (framework === 'arduino') return {
    'src/main.cpp': '#include <Arduino.h>\n\n#if defined(LED_BUILTIN)\nconstexpr uint8_t LED_PIN = LED_BUILTIN;\n#else\nconstexpr uint8_t LED_PIN = 13; // Change this for your board or external LED.\n#endif\n\nvoid setup() {\n  pinMode(LED_PIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_PIN, HIGH);\n  delay(500);\n  digitalWrite(LED_PIN, LOW);\n  delay(500);\n}\n'
  };
  if (framework === 'espidf') return {
    'src/main.c': '#include "freertos/FreeRTOS.h"\n#include "freertos/task.h"\n\nvoid app_main(void) {\n  while (1) {\n    // Add your application code here.\n    vTaskDelay(pdMS_TO_TICKS(1000));\n  }\n}\n',
    'src/CMakeLists.txt': 'idf_component_register(SRCS "main.c" INCLUDE_DIRS ".")\n',
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.16.0)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(' + name.replace(/[^A-Za-z0-9_]/g, '_') + ')\n'
  };
  if (framework === 'mbed') return {
    'src/main.cpp': '#include <mbed.h>\n#include <chrono>\n\nint main() {\n  while (true) {\n    // Add your application code here.\n    ThisThread::sleep_for(std::chrono::milliseconds(1000));\n  }\n}\n'
  };
  return {
    'src/main.cpp': '// Starter source. Adapt the entry point and includes to your selected framework.\n\nint main() {\n  while (true) {\n    // Add your application code here.\n  }\n}\n'
  };
}

function createProject({ parentDirectory, name, board, environment, framework } = {}) {
  name = projectName(name);
  const selected = selectedSettings(board, environment, framework);
  if (typeof parentDirectory !== 'string' || !parentDirectory || parentDirectory.includes('\0') || !path.isAbsolute(parentDirectory)) throw new Error('Choose an absolute parent folder for the project.');
  fs.mkdirSync(parentDirectory, { recursive: true });
  const parent = fs.realpathSync.native(parentDirectory);
  if (!fs.statSync(parent).isDirectory()) throw new Error('The project parent must be a folder.');
  const projectPath = path.join(parent, name);
  if (path.dirname(projectPath) !== parent) throw new Error('The project must be a direct child of the selected folder.');
  try {
    fs.lstatSync(projectPath);
    throw new Error('A file or folder with this project name already exists. Choose a different name.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const lines = ['[platformio]', 'default_envs = ' + selected.environment, '', '[env:' + selected.environment + ']', 'platform = ' + board.platform, 'board = ' + board.id];
  if (selected.framework) lines.push('framework = ' + selected.framework);
  if (selected.framework === 'arduino') lines.push('monitor_speed = 9600');
  if (selected.framework === 'espidf') lines.push('monitor_speed = 115200');
  const files = {
    'platformio.ini': lines.join('\n') + '\n',
    '.gitignore': '.pio/\n.vscode/\n',
    'include/README': 'Put project header files in this folder.\n',
    'lib/README': 'Put project-specific libraries in this folder. Declare registry libraries using lib_deps in platformio.ini.\n',
    'test/README': 'Put PlatformIO unit tests in this folder.\n',
    'README.md': '# ' + name + '\n\nBoard: ' + (board.name || board.id) + ' (`' + board.id + '`)\n\nPlatform: `' + board.platform + '`\n\nFramework: ' + (selected.framework ? '`' + selected.framework + '`' : 'bare metal / none') + '\n\nEdit the source in `src`, then use **Install dependencies** or **Build**. PlatformIO downloads the selected board tools and declared libraries when needed. Select a real COM port before **Upload**.\n\n' + (selected.framework === 'arduino' ? 'The example blinks the board-defined LED pin or falls back to GPIO 13. Check the pin for your hardware before uploading.\n' : selected.framework === 'espidf' ? 'The ESP-IDF example uses `app_main` and includes the required root/component CMake files.\n' : selected.framework === 'mbed' ? 'The Mbed example supplies a sleeping main loop. Add your board logic in `src/main.cpp`.\n' : 'The generic starter supplies a main loop. Your framework may require a different entry point, headers, build files, or board-specific initialization; adjust these before building.\n'),
    ...sourceFiles(selected.framework, name)
  };

  // mkdir is exclusive, so another process cannot turn a colliding name into
  // an overwrite between the existence check and project creation.
  try { fs.mkdirSync(projectPath); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('A file or folder with this project name already exists. Choose a different name.'); throw error; }
  for (const directory of ['src', 'include', 'lib', 'test']) fs.mkdirSync(path.join(projectPath, directory));
  try {
    for (const [relative, content] of Object.entries(files)) fs.writeFileSync(path.join(projectPath, ...relative.split('/')), content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    throw new Error('Project creation could not finish in ' + projectPath + '. Its files were kept: ' + error.message);
  }
  return { projectPath, environment: selected.environment, files: Object.keys(files) };
}

module.exports = { createProject };
