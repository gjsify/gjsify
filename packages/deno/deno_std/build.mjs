// Credits: https://github.com/dzearing/transform-typed-imports

import {
    ModuleResolutionKind,
    Project,
  } from "ts-morph";
import { join, dirname, extname } from 'path';
import { existsSync } from 'fs';
import { writeFile, rm, readdir, lstat, rename } from 'fs/promises';
import cpy from 'cpy';
import { fileURLToPath } from "url";
import { build as _build } from 'esbuild';

const silent = false;
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectPath = __dirname;
const divider = "--------------------------------------------------";
const targetTempDirName = 'temp';
const targetTempDirPath = join(projectPath, targetTempDirName);

const log = (...messages) => {
    if (!silent) {
      console.log(...messages);
    }
};

/**
 *
 * @param {string} dir
 * @param {RegExp} include
 * @param {RegExp} excludes
 * @returns
 */
 const readDirRecursive = async (dir, include, exclude) => {
    let files = [];

    if(exclude?.test(dir)) {
        log("exclude", dir)
        return files;
    }

    const stat = await lstat(dir);
    if (!stat.isDirectory()) {
        return files;
    }

    const dirFiles = await readdir(dir);

    for (let file of dirFiles) {
        const filePath = join(dir, file);

        if(exclude?.test(filePath)) {
            continue
        }

        const stat = await lstat(filePath);

        if (stat.isDirectory()) {
            const nestedFiles = await readDirRecursive(filePath, include, exclude);
            files = files.concat(nestedFiles);
        } else if (stat.isFile()) {
            if (include.test(file)) {
                files.push(filePath);
            }
        }
    };

    return files;
}

const copy = async () => {

    // Remove old temporary dir
    if (existsSync(targetTempDirPath)) {
        await rm(targetTempDirPath, { recursive: true, force: true })
    }

    await cpy([
        join(projectPath, "original/**/*.ts"),
        join(projectPath, "original/**/*.mts"),
        join(projectPath, "original/**/*.tsx"),
        join(projectPath, "original/**/*.js"),
        join(projectPath, "original/**/*.mjs"),
        join(projectPath, "original/**/*.jsx"),
        '!' + join(projectPath, "http/_mock_conn.ts"),
        '!' + join(projectPath, "original/node/integrationtest"),
        '!' + join(projectPath, "original/node/_tools/test"),
        '!' + join(projectPath, "original/node/_module/cjs"),
        '!' + join(projectPath, "original/node/_module/example.js"),
        '!' + join(projectPath, "original/encoding/testdata"),
    ], targetTempDirPath);
}

/**
 * Rename .mjs to .js
 */
const renameFiles = async () => {
    
    const mjsFiles = await readDirRecursive(targetTempDirPath, ['.mjs'], []);
    for (const mjsFile of mjsFiles) {
        await rename(mjsFile, mjsFile.replace(/\.mjs$/, '.js'));
    }
}

const build = async () => {
    
    const mjsFiles = await readDirRecursive(targetTempDirPath, /\.(ts|js|mjs|mts)$/, /\.d\.ts$/);

    await _build({
        entryPoints: mjsFiles,
        bundle: false,
        minify: false,
        sourcemap: false,
        platform: "browser",
        // external: mjsFiles,
        format: 'esm',
        outdir: 'lib-js-2',
    });
}

const transform = async () => {
    
    const tsConfigFilePath = join(
        projectPath,
        "tsconfig.json"
    );

    if (!existsSync(tsConfigFilePath)) {
        throw new Error('tsconfig,json not found in ' + tsConfigFilePath);
    }

    // initialize
    const project = new Project({
            // Read more: https://ts-morph.com/setup/
            tsConfigFilePath,
            skipAddingFilesFromTsConfig: true,
            compilerOptions: {
            moduleResolution: ModuleResolutionKind.NodeJs,
            jsx: 4,
        },
    });

    log("Finding source files...");

    await copy();

    // add source files
    project.addSourceFilesAtPaths([
        join(targetTempDirPath, "**/*.ts"),
        join(targetTempDirPath, "**/*.mts"),
        join(targetTempDirPath, "**/*.cts"),
        join(targetTempDirPath, "**/*.tsx"),
        join(targetTempDirPath, "**/*.js"),
        join(targetTempDirPath, "**/*.mjs"),
        join(targetTempDirPath, "**/*.cjs"),
        join(targetTempDirPath, "**/*.jsx"),
    ]);

    let filesParsed = project.getSourceFiles();

    log(
        `Processing ${filesParsed.length} file(s)${
          filesParsed.length ? ` (Total parsed: ${filesParsed.length})` : ""
        }...`
    );


    // For each source file...
    for (let source of filesParsed) {
        let fileChange = false;
        const sourceFilePath = source.getFilePath();
        log(`${divider}\nParsing source "${sourceFilePath}"`);

        for (let decl of source.getImportStringLiterals()) {
            const literalValue = decl.getLiteralValue();

            // Update module specifier
            if (/ts$/.test(literalValue)) {
                const transformedLiteralValue = literalValue.replace(/ts$/, 'js');
                log(`Transform ${literalValue} -> ${transformedLiteralValue}`)
                decl.setLiteralValue(transformedLiteralValue);
                fileChange = true;
            }

        }

        // ...Iterate through imports;
        for (let decl of source.getImportDeclarations()) {

            const moduleSpecifier = decl.getModuleSpecifierValue();

            // Update module specifier
            if (/ts$/.test(moduleSpecifier)) {
                const transformedModuleSpecifier = moduleSpecifier.replace(/ts$/, 'js');
                log(`Transform ${moduleSpecifier} -> ${transformedModuleSpecifier}`)
                decl.setModuleSpecifier(transformedModuleSpecifier);
                fileChange = true;
            }
        }

        if (fileChange) {
            // Save the source.
            log(`\nSaving source file "${sourceFilePath}"`);
            await writeFile(source.getFilePath(), `// @ts-nocheck\n` + source.getText(), 'utf8');
            // await source.save();
        }
    }

    // await renameFiles();
}

await transform();

// await build();