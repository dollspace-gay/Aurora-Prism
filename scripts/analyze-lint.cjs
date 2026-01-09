const fs = require('fs');
const output = fs.readFileSync('lint-output.txt', 'utf8');
const lines = output.split('\n');
const counts = {};
let currentFile = null;
for (const line of lines) {
  if (line.match(/^[A-Z]:/)) {
    currentFile = line;
    counts[currentFile] = (counts[currentFile] || 0);
  } else if (line.includes('warning') && currentFile) {
    counts[currentFile]++;
  }
}
const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 25);
for (const [file, count] of sorted) {
  const shortName = file.split('\\').pop().split('/').pop();
  console.log(count.toString().padStart(4), shortName);
}
