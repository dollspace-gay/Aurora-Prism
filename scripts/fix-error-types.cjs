/**
 * Fix common error type patterns across the codebase
 * Transforms `catch (error: any)` to `catch (error: unknown)` with proper helpers
 */

const fs = require('fs');
const path = require('path');

const targetDirs = ['server', 'data-plane', 'osprey-bridge'];

function findTsFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.includes('node_modules')) {
      files.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  let needsImport = false;
  const usedHelpers = new Set();

  // Pattern 1: catch (error: any) { ... error.message ... }
  // Only if error.message is used (not error.status or other properties)
  const catchMessagePattern = /catch\s*\(\s*error\s*:\s*any\s*\)\s*\{([^}]*error\.message[^}]*)\}/g;

  // Count matches first
  const messageMatches = content.match(catchMessagePattern);

  if (messageMatches && messageMatches.length > 0) {
    // Replace error.message with getErrorMessage(error) in catch blocks
    content = content.replace(
      /catch\s*\(\s*error\s*:\s*any\s*\)\s*\{/g,
      'catch (error: unknown) {'
    );

    // Now replace error.message with getErrorMessage(error) - but only in contexts where it makes sense
    // This is tricky because we need context. Let's do a simpler approach:
    // Replace patterns like: error.message in console/smartConsole calls
    content = content.replace(
      /(\s*(?:console|smartConsole)\.(?:log|warn|error|info)\s*\([^)]*?)error\.message/g,
      '$1getErrorMessage(error)'
    );

    needsImport = true;
    usedHelpers.add('getErrorMessage');
    modified = true;
  }

  // Pattern 2: error.status === 404 or error.status === number patterns
  if (content.includes('error.status')) {
    content = content.replace(
      /error\.status\s*===\s*(\d+)/g,
      'hasErrorStatus(error, $1)'
    );
    usedHelpers.add('hasErrorStatus');
    needsImport = true;
    modified = true;
  }

  // Add import if needed
  if (needsImport && !content.includes("from '../utils/error-utils'") && !content.includes("from '../../utils/error-utils'")) {
    // Determine relative path
    const relPath = path.relative(path.dirname(filePath), path.join(__dirname, '../server/utils'));
    let importPath = relPath.replace(/\\/g, '/');
    if (!importPath.startsWith('.')) importPath = './' + importPath;
    importPath += '/error-utils';

    // Find a good place to add the import (after other imports)
    const helpers = Array.from(usedHelpers).join(', ');
    const importStatement = `import { ${helpers} } from '${importPath}';\n`;

    // Add after the last import statement
    const lastImportMatch = content.match(/^import[^;]+;/gm);
    if (lastImportMatch) {
      const lastImport = lastImportMatch[lastImportMatch.length - 1];
      const lastImportIndex = content.lastIndexOf(lastImport) + lastImport.length;
      content = content.slice(0, lastImportIndex) + '\n' + importStatement + content.slice(lastImportIndex);
    } else {
      content = importStatement + content;
    }
  }

  if (modified) {
    console.log(`Modified: ${filePath}`);
    fs.writeFileSync(filePath, content);
    return 1;
  }
  return 0;
}

let totalModified = 0;
for (const dir of targetDirs) {
  const files = findTsFiles(dir);
  for (const file of files) {
    totalModified += processFile(file);
  }
}

console.log(`\nTotal files modified: ${totalModified}`);
