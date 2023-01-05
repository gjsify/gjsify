import { describe, it, expect } from '@gjsify/unit';
// import { join, dirname } from 'path';
// import { fileURLToPath } from "url";

// const __filename = fileURLToPath(import.meta.url)
// const __dirname = dirname(__filename)

import { symlink as symlinkCb, mkdtempSync, lstatSync } from 'fs';
import { symlink, rmdir, unlink } from 'fs/promises';

export default async () => {
	await describe('fs.symlink', async () => {

		await it('ASYNC: no callback function results in Error', () => {
			expect(() => {
                // @ts-ignore
                symlinkCb("some/path", "some/other/path", "dir");
            }).toThrow(Error)
		});

        // TODO FIXME
		// await it('ASYNC: create symlink point to a dir', async () => {

        //     const tmpDir = mkdtempSync('test_tmp_');
        //     const linkedTmpDir = tmpDir + ".link";

        //     await symlink(tmpDir, linkedTmpDir)
        //     const stat = lstatSync(linkedTmpDir);

        //     expect(stat.isSymbolicLink).toBeTruthy();

        //     await rmdir(tmpDir);
        //     await unlink(linkedTmpDir);
		// });
	});


}
