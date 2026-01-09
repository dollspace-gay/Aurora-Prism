/**
 * Script to fix common `any` type patterns across the codebase
 * Run with: node scripts/fix-any-types.cjs
 */

const fs = require('fs');
const path = require('path');

// Patterns to replace
const replacements = [
  // catch blocks: (error: any) -> (error: unknown)
  { from: /catch\s*\(\s*(\w+)\s*:\s*any\s*\)/g, to: 'catch ($1: unknown)' },
  // catch blocks: catch (error) { -> catch (error: unknown) {
  { from: /catch\s*\(\s*(\w+)\s*\)\s*\{/g, to: 'catch ($1: unknown) {' },
  // Unused error: catch (error -> catch (_error
  { from: /catch\s*\(\s*error\s*:\s*unknown\s*\)\s*\{\s*\n\s*\/\//g, to: 'catch (_error: unknown) {\n    //' },
];

// Files to process
const files = [];

function walkDir(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (!['node_modules', 'dist', '.stryker-tmp', 'coverage', '.git'].includes(item)) {
        walkDir(fullPath);
      }
    } else if (item.endsWith('.ts') || item.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
}

// Walk directories
walkDir(path.join(__dirname, '..', 'server'));
walkDir(path.join(__dirname, '..', 'client'));
walkDir(path.join(__dirname, '..', 'data-plane'));
walkDir(path.join(__dirname, '..', 'shared'));
walkDir(path.join(__dirname, '..', 'tests'));
walkDir(path.join(__dirname, '..', 'osprey-bridge'));
walkDir(path.join(__dirname, '..', 'microcosm-bridge'));

let totalChanges = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  for (const { from, to } of replacements) {
    const newContent = content.replace(from, to);
    if (newContent !== content) {
      content = newContent;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, content);
    console.log(`Updated: ${file}`);
    totalChanges++;
  }
}

console.log(`\nTotal files updated: ${totalChanges}`);
