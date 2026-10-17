import { cpSync, readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const [major, minor, patch] = version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + patch;
const gradlePath = 'android/app/build.gradle';
const gradle = readFileSync(gradlePath, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${versionCode}`)
    .replace(/versionName "[^"]+"/, `versionName "${version}"`);

cpSync('resources/android/res', 'android/app/src/main/res', { recursive: true });
writeFileSync(gradlePath, gradle);
