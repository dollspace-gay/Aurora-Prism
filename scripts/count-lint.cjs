const fs = require('fs');
const lines = fs.readFileSync('lint-output.txt', 'utf8').split('\n');
const counts = {};
let currentFile = '';
for (const line of lines) {
  if (line.match(/^[A-Z]:.*\.[tj]sx?$/i)) {
    currentFile = line.trim().replace(/\\/g, '/').split('/').slice(-2).join('/');
  } else if (line.includes('warning') && currentFile) {
    counts[currentFile] = (counts[currentFile] || 0) + 1;
  }
}
Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0,30).forEach(([f,c]) => console.log(c, f));
