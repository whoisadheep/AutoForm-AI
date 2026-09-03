/**
 * @file scripts/package_extension.js
 * @description Bundles browser extension packages for Chrome, Edge, and Firefox stores.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const tmpDir = path.join(distDir, '.tmp_pkg');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Clean up old dist files
['autoform-ai.zip', 'autoform-ai-edge.zip', 'autoform-ai-chrome.zip', 'autoform-ai-firefox.zip'].forEach(f => {
    const fp = path.join(distDir, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
});

const baseManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));

console.log('📦 Building Multi-Browser Extension Packages...\n');

try {
    // ---------------------------------------------------------------------------
    // 1. Edge & Chrome (Chromium MV3: Strict service_worker, no scripts array)
    // ---------------------------------------------------------------------------
    const chromiumManifest = {
        ...baseManifest,
        background: {
            service_worker: "src/background/background.js"
        }
    };
    // Ensure no gecko settings in chromium bundle
    delete chromiumManifest.browser_specific_settings;

    const edgeZip = path.join(distDir, 'autoform-ai-edge.zip');
    const chromeZip = path.join(distDir, 'autoform-ai-chrome.zip');
    const universalZip = path.join(distDir, 'autoform-ai.zip');

    // Create temporary staging folder for chromium
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    // Copy src and assets/icons
    execSync(`cp -r src/ "${tmpDir}/src"`, { cwd: rootDir });
    fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
    execSync(`cp -r assets/icons/ "${tmpDir}/assets/icons"`, { cwd: rootDir });
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(chromiumManifest, null, 2));

    // Zip chromium package
    execSync(`zip -r "${edgeZip}" manifest.json assets/icons/ src/ -x "*.DS_Store*"`, { cwd: tmpDir, stdio: 'pipe' });
    fs.copyFileSync(edgeZip, chromeZip);
    fs.copyFileSync(edgeZip, universalZip);

    console.log(`✅ Edge / Chrome Package:   dist/autoform-ai-edge.zip`);
    console.log(`✅ Universal Default:        dist/autoform-ai.zip`);

    // ---------------------------------------------------------------------------
    // 2. Firefox (Gecko MV3: background scripts & data collection permissions)
    // ---------------------------------------------------------------------------
    const firefoxManifest = {
        ...baseManifest,
        background: {
            scripts: ["src/background/background.js"]
        },
        browser_specific_settings: {
            gecko: {
                id: "autoform-ai@whoisadheep.dev",
                strict_min_version: "142.0",
                data_collection_permissions: {
                    required: ["none"]
                }
            }
        }
    };

    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(firefoxManifest, null, 2));
    const firefoxZip = path.join(distDir, 'autoform-ai-firefox.zip');
    execSync(`zip -r "${firefoxZip}" manifest.json assets/icons/ src/ -x "*.DS_Store*"`, { cwd: tmpDir, stdio: 'pipe' });

    // Also create unpacked dist/firefox folder for easy local testing via about:debugging
    const firefoxUnpackedDir = path.join(distDir, 'firefox');
    if (fs.existsSync(firefoxUnpackedDir)) fs.rmSync(firefoxUnpackedDir, { recursive: true, force: true });
    fs.cpSync(tmpDir, firefoxUnpackedDir, { recursive: true });

    console.log(`✅ Firefox AMO Package:      dist/autoform-ai-firefox.zip`);
    console.log(`✅ Firefox Local Unpacked:   dist/firefox/manifest.json`);

    // Clean staging
    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log(`\n🎉 All packages created successfully in dist/!`);
} catch (e) {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    console.error('❌ Failed to package extension:', e.message);
    process.exit(1);
}
