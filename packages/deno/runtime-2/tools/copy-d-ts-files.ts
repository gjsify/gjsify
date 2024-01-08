// deno run --allow-read --allow-write tools/copy-d-ts-files.ts

import fg from 'npm:fast-glob';
import fs from 'node:fs';
import path from 'node:path';

const jsPlaceholder = `export {}`;

const dtsFiles = fg.sync('src/**/*.d.ts');
for (const dtsFile of dtsFiles) {
    const dTsDest = dtsFile.replace(/^src\//, "lib/");
    // console.info(`${dtsFile} -> ${dTsDest}`);
    fs.mkdirSync(path.dirname(dTsDest), { recursive: true });
    fs.copyFileSync(dtsFile, dTsDest);

    const jsFile = dTsDest.replace(/\.d\.ts$/, ".js");

    // Create a placeholder js file if no js file for this .d.ts not file exists.
    if (!fs.existsSync(jsFile)) {
        fs.writeFileSync(jsFile, jsPlaceholder);
    }
}
