const fs = require('fs');
const lines = fs.readFileSync('lint-output.txt', 'utf8').split('\n');
let currentFile = '';
for (const line of lines) {
  if (line.match(/^[A-Z]:.*\.[tj]sx?$/i)) {
    currentFile = line.trim();
  } else if (line.includes('unused') || line.includes('never used')) {
    const match = line.match(/^\s*(\d+):\d+/);
    if (match) {
      console.log(`${currentFile}:${match[1]} - ${line.trim()}`);
    }
  }
}
