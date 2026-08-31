/**
 * @file scripts/validate_manifest.js
 * @description Validates manifest.json format and verifies that all referenced files exist.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');

console.log('🔍 Validating manifest.json...');

if (!fs.existsSync(manifestPath)) {
    console.error('❌ manifest.json not found!');
    process.exit(1);
}

let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log('✅ JSON syntax valid');
} catch (e) {
    console.error('❌ manifest.json has invalid JSON syntax:', e.message);
    process.exit(1);
}

const filesToCheck = [];

// Service worker (Chrome) and background scripts (Firefox)
if (manifest.background) {
    if (manifest.background.service_worker) {
        filesToCheck.push(manifest.background.service_worker);
    }
    if (Array.isArray(manifest.background.scripts)) {
        filesToCheck.push(...manifest.background.scripts);
    }
}

// Content scripts
if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts.forEach((cs) => {
        if (Array.isArray(cs.js)) {
            filesToCheck.push(...cs.js);
        }
        if (Array.isArray(cs.css)) {
            filesToCheck.push(...cs.css);
        }
    });
}

// Popup
if (manifest.action && manifest.action.default_popup) {
    filesToCheck.push(manifest.action.default_popup);
}

// Icons
if (manifest.icons) {
    Object.values(manifest.icons).forEach(iconPath => filesToCheck.push(iconPath));
}
if (manifest.action && manifest.action.default_icon) {
    Object.values(manifest.action.default_icon).forEach(iconPath => filesToCheck.push(iconPath));
}

let errors = 0;
filesToCheck.forEach(relPath => {
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) {
        console.error(`❌ Missing referenced file: ${relPath}`);
        errors++;
    } else {
        console.log(`✅ Found: ${relPath}`);
    }
});

if (errors > 0) {
    console.error(`\n💥 Validation failed with ${errors} error(s).`);
    process.exit(1);
} else {
    console.log('\n🎉 All manifest files validated successfully!');
}
