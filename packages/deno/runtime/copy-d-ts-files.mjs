import fg from 'fast-glob';
import fs from 'fs';
import path from 'path';

const dtsFiles = fg.sync('src/**/*.d.ts');
for (const dtsFile of dtsFiles) {
    const dest = dtsFile.replace(/^src\//, "lib/");
    // console.info(`${dtsFile} -> ${dest}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(dtsFile, dest);
}
