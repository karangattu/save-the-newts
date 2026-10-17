import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/prepare-android.mjs', import.meta.url);

test('fresh Android builds receive custom icons and the release version', () => {
    const root = mkdtempSync(join(tmpdir(), 'newt-android-'));
    try {
        mkdirSync(join(root, 'resources/android/res/mipmap-mdpi'), { recursive: true });
        mkdirSync(join(root, 'android/app/src/main/res/mipmap-mdpi'), { recursive: true });
        writeFileSync(join(root, 'resources/android/res/mipmap-mdpi/ic_launcher.png'), 'custom rescue icon');
        writeFileSync(join(root, 'android/app/src/main/res/mipmap-mdpi/ic_launcher.png'), 'default Capacitor icon');
        writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.1.1' }));
        writeFileSync(join(root, 'android/app/build.gradle'), 'versionCode 1\nversionName "1.0"\n');

        const result = spawnSync(process.execPath, [script.pathname], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(readFileSync(join(root, 'android/app/src/main/res/mipmap-mdpi/ic_launcher.png'), 'utf8'), 'custom rescue icon');
        assert.equal(readFileSync(join(root, 'android/app/build.gradle'), 'utf8'), 'versionCode 10101\nversionName "1.1.1"\n');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
