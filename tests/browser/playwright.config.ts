import { defineConfig, devices } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PORT = 8087;

export default defineConfig({
    testDir: './specs',
    fullyParallel: !process.env.CI,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    timeout: 30_000,
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'on-first-retry',
    },
    // Firefox is the primary browser: GJS and Firefox both use SpiderMonkey (SM128),
    // so these tests directly validate the same engine behavior as GJS.
    projects: [
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
        // Chromium as secondary — run with --project=chromium to surface engine diffs
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: `npx http-server ${REPO_ROOT} -p ${PORT} --cors -c-1 -s`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
    },
});
