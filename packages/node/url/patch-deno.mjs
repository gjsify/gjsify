import { readFile, writeFile } from 'fs/promises';

const filePath = 'src/url.deno.js';
let file = await readFile(filePath, 'utf8');

file = file
    .replace(/Deno\?\.cwd/g, 'process?.cwd')
    .replace(/Deno\.cwd/g, 'process.cwd')
    .replace(/Deno\?\.build\?\.os/g, 'process?.platform')
    .replace(/Deno\.build\.os/g, 'process.platform')
    .replace(/\"windows\"/g, '"win32"')
    .replace(/typeof\sDeno\?\.env\?\.get\s\!\=\=\s\"function\"/g, "!process?.env")
    .replace(/Deno\.env\.get\(\"NODE_DEBUG\"\)/g, 'process.env.NODE_DEBUG')
    .replace(/Deno\.errors\.PermissionDenied/g, 'Error')
    .replace(/Deno\?\.core/g, 'false')
    .replace(/Deno\.core/g, 'false')
    .replace(/Deno\.core/g, 'false')
    .replace(/\sDeno\s/g, ' process ')
    
await writeFile(filePath, file);
