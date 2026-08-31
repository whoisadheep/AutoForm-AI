/**
 * @file src/popup/popup.js
 * @description AutoForm AI v2.0 Popup Controller.
 * Handles active tab analysis, server health checks, solving triggers, and preferences persistence.
 * Zero-config, clean, minimal implementation.
 */

const DEFAULT_SERVER_URL = "https://autoform-ai-production.up.railway.app";

// DOM Elements
const connectionPill = document.getElementById('connectionPill');
const connectionText = document.getElementById('connectionText');
const formStatusTitle = document.getElementById('formStatusTitle');
const formStatusDesc = document.getElementById('formStatusDesc');
const questionBadge = document.getElementById('questionBadge');
const solveBtn = document.getElementById('solveBtn');
const solveBtnText = document.getElementById('solveBtnText');
const solveBtnIcon = document.getElementById('solveBtnIcon');
const solveSpinner = document.getElementById('solveSpinner');
const toneSelect = document.getElementById('toneSelect');
const customContext = document.getElementById('customContext');
const popupStatus = document.getElementById('popupStatus');

// SVG Icon Templates (NO emojis)
const ICONS = {
    play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    stop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`
};

/**
 * Displays a temporary status notification toast in the popup.
 * @param {string} msg 
 * @param {'success'|'error'|'info'} type 
 */
function showStatus(msg, type = 'info') {
    popupStatus.innerText = msg;
    popupStatus.className = `status-msg ${type}`;
    popupStatus.style.display = 'block';
    setTimeout(() => { popupStatus.style.display = 'none'; }, 3500);
}

/**
 * Checks backend server health and updates the header pill indicator.
 */
async function checkServerHealth() {
    chrome.runtime.sendMessage({ action: "CHECK_SERVER_HEALTH" }, (res) => {
        if (res && res.success) {
            connectionPill.className = 'connection-pill status-online';
            const active = res.data?.activeProviders?.length || 0;
            connectionText.innerText = active > 0 ? `${active} Engines` : 'Ready';
        } else {
            connectionPill.className = 'connection-pill status-offline';
            connectionText.innerText = 'Offline';
        }
    });
}

/**
 * Detects whether active tab is a Google Form and queries solver status.
 */
function analyzeActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.url) return;

        const isGoogleForm = activeTab.url.includes('docs.google.com/forms');

        if (isGoogleForm) {
            formStatusTitle.innerText = "Google Form Detected";
            formStatusDesc.innerText = "Ready to analyze & auto-fill questions";
            solveBtn.disabled = false;

            // Query active question count and solver state from content script
            chrome.tabs.sendMessage(activeTab.id, { action: "GET_SOLVER_STATUS" }, (res) => {
                if (!chrome.runtime.lastError && res) {
                    if (res.questionCount !== undefined) {
                        questionBadge.innerText = `${res.questionCount} Questions`;
                        questionBadge.style.display = 'inline-block';
                    }
                    if (res.isSolving) {
                        setSolvingButtonState(true);
                    }
                }
            });
        } else {
            formStatusTitle.innerText = "No Form Detected";
            formStatusDesc.innerText = "Open a Google Form tab to use AutoForm";
            solveBtn.disabled = true;
            questionBadge.style.display = 'none';
        }
    });
}

/**
 * Toggles the solve button between Start and Stop states.
 * @param {boolean} isSolving 
 */
function setSolvingButtonState(isSolving) {
    if (isSolving) {
        solveBtnText.innerText = "Stop Form Filling";
        solveBtnIcon.innerHTML = ICONS.stop;
        solveBtn.classList.add("btn-danger");
        solveBtn.disabled = false;
        solveSpinner.style.display = 'none';
        solveBtn.setAttribute('aria-label', 'Stop Form Filling');
    } else {
        solveBtnText.innerText = "Fill Current Form";
        solveBtnIcon.innerHTML = ICONS.play;
        solveBtn.classList.remove("btn-danger");
        solveBtn.disabled = false;
        solveSpinner.style.display = 'none';
        solveBtn.setAttribute('aria-label', 'Fill Current Form');
    }
}

// ---------------------------------------------------------------------------
// Event Listeners & Initialization
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    // Load stored preferences
    chrome.storage.local.get([
        'tone',
        'customContext'
    ], (stored) => {
        if (stored.tone) toneSelect.value = stored.tone;
        if (stored.customContext) customContext.value = stored.customContext;
    });

    checkServerHealth();
    analyzeActiveTab();
});

// Save preferences on change
toneSelect.addEventListener('change', () => {
    chrome.storage.local.set({ tone: toneSelect.value });
});

customContext.addEventListener('input', () => {
    chrome.storage.local.set({ customContext: customContext.value.trim() });
});

// Main Solve / Stop Button Click Handler
solveBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) return;

        // If currently in Stop state
        if (solveBtn.classList.contains('btn-danger')) {
            chrome.tabs.sendMessage(tabId, { action: "STOP_SOLVING" }, () => {
                setSolvingButtonState(false);
                showStatus('Stopped form solving', 'info');
            });
            return;
        }

        // Trigger Solve
        solveBtn.disabled = true;
        solveBtnText.innerText = "Starting...";
        solveSpinner.style.display = 'block';

        chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/content/content.js']
        }).then(() => {
            setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { action: "START_SOLVING" }, (res) => {
                    solveSpinner.style.display = 'none';
                    if (chrome.runtime.lastError) {
                        setSolvingButtonState(false);
                        showStatus('Refresh the form page and try again', 'error');
                    } else {
                        setSolvingButtonState(true);
                        showStatus('Solving form questions...', 'success');
                        setTimeout(() => window.close(), 1200);
                    }
                });
            }, 300);
        }).catch((err) => {
            solveSpinner.style.display = 'none';
            setSolvingButtonState(false);
            showStatus('Cannot inject script into this tab', 'error');
        });
    });
});
