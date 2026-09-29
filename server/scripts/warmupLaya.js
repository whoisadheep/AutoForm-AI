/**
 * @file server/scripts/warmupLaya.js
 * @description Utility script to download, verify, and benchmark Laya ONNX weights locally.
 */

const { Laya, defaultCacheDir, BUNDLE_FILES } = require('@receptron/laya');
const fs = require('fs');
const path = require('path');

async function main() {
    console.log('====================================================');
    console.log('  AutoForm AI — Laya System-1 Model Warmup & Test');
    console.log('====================================================');
    console.log('Cache Directory:', defaultCacheDir());

    console.log('\n[1/3] Loading Laya model into memory (will download if not cached)...');
    const startTime = Date.now();

    let lastLoggedMb = 0;
    const laya = await Laya.load({
        onProgress: ({ file, received, total }) => {
            if (total) {
                const mb = Math.floor(received / (1024 * 1024));
                if (mb > lastLoggedMb + 50 || received === total) {
                    lastLoggedMb = mb;
                    const totalMb = Math.floor(total / (1024 * 1024));
                    const pct = ((received / total) * 100).toFixed(1);
                    process.stdout.write(`\r[Downloading ${file}] ${mb}MB / ${totalMb}MB (${pct}%)`);
                }
            }
        }
    });

    console.log(`\n Laya loaded in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

    console.log('\n[2/3] Running benchmark inference on a sample form question...');
    const inferStart = Date.now();

    const sampleState = {
        question: "What is your primary development stack?",
        userContext: "Kishan is a developer experienced in Python, JavaScript, Express, and AI automation."
    };

    const questions = {
        techStack: {
            type: "choice",
            instructions: "Select the closest development stack matching the candidate's profile.",
            criteria: [
                "Python & Backend Automation",
                "Swift & iOS Mobile Apps",
                "Ruby on Rails & PHP",
                "Embedded C & Hardware Firmware"
            ]
        }
    };

    const result = await laya.systemOne(sampleState, questions);
    const elapsed = Date.now() - inferStart;

    console.log(' Inference Output:');
    console.log(' - Selected Choice:', result.answers.techStack.choice);
    console.log(' - Confidence Score:', (result.answers.techStack.confidence * 100).toFixed(1) + '%');
    console.log(' - Inference Latency:', elapsed + 'ms');
    console.log(' - Probabilities:', result.answers.techStack.probabilities);

    console.log('\n[3/3] Closing model session...');
    await laya.close();
    console.log(' Laya warmup and verification completed successfully!\n');
}

main().catch(err => {
    console.error('\n❌ Warmup failed:', err.message);
    process.exit(1);
});
