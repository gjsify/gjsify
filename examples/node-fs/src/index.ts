import '@gjsify/node-globals';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, rmdirSync, mkdtempSync, statSync } from 'fs';
import path from 'path';

console.log('=== @gjsify/fs example ===\n');

// existsSync
console.log('--- existsSync ---');
console.log('existsSync("package.json"):', existsSync('package.json'));
console.log('existsSync("nonexistent.file"):', existsSync('nonexistent.file'));

// Create a temp directory to work in
const tmpDir = mkdtempSync('gjsify-fs-example-');
console.log('\n--- mkdtempSync ---');
console.log('Created temp dir:', tmpDir);

// writeFileSync & readFileSync
console.log('\n--- writeFileSync / readFileSync ---');
const testFile = path.join(tmpDir, 'test.txt');
writeFileSync(testFile, 'Hello from gjsify!');
const content = readFileSync(testFile, 'utf8');
console.log('Wrote and read back:', content);

// statSync
console.log('\n--- statSync ---');
const stat = statSync(testFile);
console.log('File size:', stat.size, 'bytes');
console.log('Is file:', stat.isFile());
console.log('Is directory:', stat.isDirectory());

// mkdirSync & readdirSync
console.log('\n--- mkdirSync / readdirSync ---');
const subDir = path.join(tmpDir, 'subdir');
mkdirSync(subDir);
writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
writeFileSync(path.join(tmpDir, 'b.txt'), 'b');
const files = readdirSync(tmpDir);
console.log('Files in temp dir:', files);

// Cleanup
console.log('\n--- Cleanup ---');
unlinkSync(path.join(tmpDir, 'a.txt'));
unlinkSync(path.join(tmpDir, 'b.txt'));
unlinkSync(testFile);
rmdirSync(subDir);
rmdirSync(tmpDir);
console.log('Temp dir removed:', !existsSync(tmpDir));

console.log('\n=== fs example complete ===');
