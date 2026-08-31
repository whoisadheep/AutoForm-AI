/**
 * @file scripts/package_extension.js
 * @description Creates a zip archive of the extension bundle for release or distribution.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const zipFile = path.join(distDir, 'autoform-ai.zip');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
}

console.log('📦 Packaging AutoForm AI...');

try {
    execSync(`zip -r "${zipFile}" manifest.json assets/icons/ src/ -x "*.DS_Store*"`, {
        cwd: rootDir,
        stdio: 'inherit'
    });
    console.log(`\n🎉 Package created at: ${zipFile}`);
} catch (e) {
    console.error('❌ Failed to package extension:', e.message);
    process.exit(1);
}
