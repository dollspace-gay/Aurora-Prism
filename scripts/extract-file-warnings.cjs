const fs = require('fs');
const targetFile = process.argv[2];
const lines = fs.readFileSync('lint-output.txt', 'utf8').split('\n');
let currentFile = '';
let inTarget = false;
for (const line of lines) {
  if (line.match(/^[A-Z]:.*\.[tj]sx?$/i)) {
    currentFile = line.trim();
    inTarget = currentFile.toLowerCase().includes(targetFile.toLowerCase());
  } else if (inTarget && line.includes('warning')) {
    console.log(line.trim());
  }
}
