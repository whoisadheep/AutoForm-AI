/**
 * @file src/popup/popup.js
 * @description AutoForm AI v2.0 Popup Controller.
 * Handles active tab analysis, server health checks, solving triggers, and preferences persistence.
 * Zero-config, clean, minimal implementation.
 */

const DEFAULT_SERVER_URL = "https://web-production-d1895.up.railway.app";

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
const instantAutofillBtn = document.getElementById('instantAutofillBtn');
const pacingSelect = document.getElementById('pacingSelect');
const toneSelect = document.getElementById('toneSelect');
const customContext = document.getElementById('customContext');
const popupStatus = document.getElementById('popupStatus');
const popupProgressCard = document.getElementById('popupProgressCard');
const popupProgressStatus = document.getElementById('popupProgressStatus');
const popupProgressPercent = document.getElementById('popupProgressPercent');
const popupProgressBar = document.getElementById('popupProgressBar');
const quotaBadge = document.getElementById('quotaBadge');
const quotaCount = document.getElementById('quotaCount');
const quotaFooterText = document.getElementById('quotaFooterText');
const memoryCountEl = document.getElementById('memoryCount');
const openMemoryBtn = document.getElementById('openMemoryBtn');
let progressPollTimer = null;

/**
 * Updates the live progress card in the popup.
 * @param {number} percent 
 * @param {number} currentQ 
 * @param {number} totalQ 
 */
function updatePopupProgress(percent = 0, currentQ = 0, totalQ = 0) {
    if (!popupProgressCard) return;
    popupProgressCard.style.display = 'flex';
    if (popupProgressBar) popupProgressBar.style.width = `${percent}%`;
    if (popupProgressPercent) popupProgressPercent.innerText = `${percent}%`;
    if (popupProgressStatus) {
        if (totalQ > 0) {
            popupProgressStatus.innerText = `Solving Question ${currentQ} of ${totalQ}`;
        } else {
            popupProgressStatus.innerText = 'Solving questions...';
        }
    }
}

/**
 * Hides popup progress card and clears interval.
 */
function hidePopupProgress() {
    if (popupProgressCard) popupProgressCard.style.display = 'none';
    if (progressPollTimer) {
        clearInterval(progressPollTimer);
        progressPollTimer = null;
    }
}

/**
 * Polls solver progress while popup is open.
 * @param {number} tabId 
 */
function startProgressPolling(tabId) {
    if (progressPollTimer) clearInterval(progressPollTimer);
    progressPollTimer = setInterval(() => {
        chrome.tabs.sendMessage(tabId, { action: "GET_SOLVER_STATUS" }, (res) => {
            if (chrome.runtime.lastError || !res) {
                hidePopupProgress();
                return;
            }
            if (res.isSolving) {
                setSolvingButtonState(true);
                updatePopupProgress(res.percent || 0, res.currentQuestion || 0, res.questionCount || 0);
            } else {
                setSolvingButtonState(false);
                hidePopupProgress();
                fetchClientQuota();
            }
        });
    }, 350);
}


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
        if (!chrome.runtime.lastError && res && res.success) {
            connectionPill.className = 'connection-pill status-online';
            // AutoForm AI features 4 multi-provider engines: Groq, Gemini, OpenRouter, NVIDIA
            connectionText.innerText = '4 Engines';
            connectionPill.title = '4 AI Engines Online: Groq • Gemini • OpenRouter • NVIDIA (Auto-Failover)';
        } else {
            connectionPill.className = 'connection-pill status-offline';
            connectionText.innerText = 'Offline';
            connectionPill.title = 'Backend proxy server offline or unreachable';
            if (quotaBadge) quotaBadge.style.display = 'none';
        }
    });
}

/**
 * Fetches client rate limit quota from the backend proxy and updates the UI.
 */
function fetchClientQuota() {
    chrome.runtime.sendMessage({ action: "GET_CLIENT_QUOTA" }, (res) => {
        if (!chrome.runtime.lastError && res && res.success && res.data) {
            const { remaining, limit, resetMinutes, used = 0 } = res.data;
            if (quotaBadge && quotaCount) {
                quotaBadge.style.display = 'inline-flex';
                quotaCount.innerText = `${remaining}/${limit}`;
                
                const resetMsg = resetMinutes > 0 
                    ? ` (next reset in ~${resetMinutes}m)` 
                    : ' (resets hourly)';
                quotaBadge.title = `${remaining} of ${limit} questions remaining this hour. Usage slots roll over 1 hour after each question${resetMsg}`;

                quotaBadge.classList.remove('quota-low', 'quota-exhausted');
                if (remaining === 0) {
                    quotaBadge.classList.add('quota-exhausted');
                } else if (remaining <= 25) {
                    quotaBadge.classList.add('quota-low');
                }
            }

            if (quotaFooterText) {
                if (used === 0 || remaining === limit) {
                    quotaFooterText.innerText = `${limit} Qs/hr • Resets hourly`;
                } else if (resetMinutes > 0) {
                    quotaFooterText.innerText = `${remaining}/${limit} Qs • Reset in ~${resetMinutes}m`;
                } else {
                    quotaFooterText.innerText = `${remaining}/${limit} Qs • Resets hourly`;
                }
            }
        } else {
            if (quotaBadge) quotaBadge.style.display = 'none';
        }
    });
}

/**
 * Detects whether active tab contains a Google Form, Job Application, or Web Form,
 * and synchronizes the popup interface with the active questions and solver state.
 */
function analyzeActiveTab() {
    function getActiveTab(callback) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].id) {
                return callback(tabs[0]);
            }
            // Fallback for Firefox detached popups / multi-window contexts
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (fallbackTabs) => {
                if (fallbackTabs && fallbackTabs.length > 0 && fallbackTabs[0].id) {
                    return callback(fallbackTabs[0]);
                }
                callback(null);
            });
        });
    }

    getActiveTab((activeTab) => {
        if (!activeTab || !activeTab.id) {
            setNoFormState();
            return;
        }

        const url = activeTab.url || '';
        // Ignore internal browser system pages
        if (url && (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:'))) {
            formStatusTitle.innerText = "System Page";
            formStatusDesc.innerText = "Open a form or job application to use AutoForm";
            solveBtn.disabled = true;
            if (instantAutofillBtn) instantAutofillBtn.disabled = true;
            questionBadge.style.display = 'none';
            hidePopupProgress();
            return;
        }

        function querySolverStatus(retried = false) {
            chrome.tabs.sendMessage(activeTab.id, { action: "GET_SOLVER_STATUS" }, (res) => {
                if (chrome.runtime.lastError) {
                    const scriptingApi = (typeof browser !== 'undefined' && browser.scripting) ? browser.scripting : (chrome.scripting || null);
                    if (!retried && scriptingApi) {
                        // Attempt on-demand script injection
                        scriptingApi.executeScript({
                            target: { tabId: activeTab.id },
                            files: ['src/services/memoryRetriever.js', 'src/services/formAdapters.js', 'src/content/content.js']
                        }).then(() => {
                            setTimeout(() => querySolverStatus(true), 350);
                        }).catch(() => {
                            setNoFormState();
                        });
                        return;
                    }
                    setNoFormState();
                    return;
                }

                if (res && res.detected && res.questionCount > 0) {
                    const typeLabel = res.formType || (url.includes('docs.google.com/forms') ? 'Google Form' : 'Form');
                    formStatusTitle.innerText = `${typeLabel} Detected`;
                    formStatusDesc.innerText = res.formTitle 
                        ? `"${res.formTitle.slice(0, 38)}${res.formTitle.length > 38 ? '...' : ''}"`
                        : "Ready to analyze & auto-fill questions";
                    solveBtn.disabled = false;
                    if (instantAutofillBtn) instantAutofillBtn.disabled = false;

                    questionBadge.innerText = `${res.questionCount} Questions`;
                    questionBadge.style.display = 'inline-block';

                    if (res.isSolving) {
                        setSolvingButtonState(true);
                        updatePopupProgress(res.percent || 0, res.currentQuestion || 0, res.questionCount || 0);
                        startProgressPolling(activeTab.id);
                    }
                } else {
                    setNoFormState();
                }
            });
        }

        function setNoFormState() {
            formStatusTitle.innerText = "No Form Detected";
            formStatusDesc.innerText = "Click here to re-scan page for fields";
            solveBtn.disabled = true;
            if (instantAutofillBtn) instantAutofillBtn.disabled = true;
            questionBadge.style.display = 'none';
            hidePopupProgress();
        }

        querySolverStatus();
    });
}

/**
 * Sets SVG icon on the button safely without innerHTML.
 * @param {'play'|'stop'} type 
 */
function setButtonIcon(type) {
    solveBtnIcon.textContent = '';
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    if (type === 'stop') {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", "6");
        rect.setAttribute("y", "6");
        rect.setAttribute("width", "12");
        rect.setAttribute("height", "12");
        rect.setAttribute("rx", "2");
        svg.appendChild(rect);
    } else {
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", "13 2 3 14 12 14 11 22 21 10 12 10 13 2");
        svg.appendChild(poly);
    }

    solveBtnIcon.appendChild(svg);
}

/**
 * Toggles the solve button between Start and Stop states.
 * @param {boolean} isSolving 
 */
function setSolvingButtonState(isSolving) {
    if (isSolving) {
        solveBtnText.textContent = "Stop Form Filling";
        setButtonIcon('stop');
        solveBtn.classList.add("btn-danger");
        solveBtn.disabled = false;
        solveSpinner.style.display = 'none';
        solveBtn.setAttribute('aria-label', 'Stop Form Filling');
    } else {
        solveBtnText.textContent = "Fill Current Form";
        setButtonIcon('play');
        solveBtn.classList.remove("btn-danger");
        solveBtn.disabled = false;
        solveSpinner.style.display = 'none';
        solveBtn.setAttribute('aria-label', 'Fill Current Form');
        hidePopupProgress();
    }
}

// ---------------------------------------------------------------------------
// Event Listeners & Initialization
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    // Load stored preferences
    chrome.storage.local.get([
        'tone',
        'customContext',
        'fillPacing'
    ], (stored) => {
        if (stored.tone) toneSelect.value = stored.tone;
        if (stored.customContext) customContext.value = stored.customContext;
        if (stored.fillPacing && pacingSelect) pacingSelect.value = stored.fillPacing;
    });

    checkServerHealth();
    fetchClientQuota();
    analyzeActiveTab();
    loadMemoryCount();
});

// Save preferences on change
toneSelect.addEventListener('change', () => {
    chrome.storage.local.set({ tone: toneSelect.value });
});

if (pacingSelect) {
    pacingSelect.addEventListener('change', () => {
        chrome.storage.local.set({ fillPacing: pacingSelect.value });
    });
}

customContext.addEventListener('input', () => {
    chrome.storage.local.set({ customContext: customContext.value.trim() });
});

// Click status card to trigger an immediate re-scan
const formStatusCard = document.getElementById('formStatusCard');
if (formStatusCard) {
    formStatusCard.style.cursor = 'pointer';
    formStatusCard.title = 'Click to re-scan page for form fields';
    formStatusCard.addEventListener('click', () => {
        formStatusTitle.innerText = 'Scanning tab...';
        formStatusDesc.innerText = 'Checking for inputs and form fields...';
        analyzeActiveTab();
    });
}

// Memory & Profile button — opens options page in a new tab
if (openMemoryBtn) {
    openMemoryBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
}

/**
 * Loads memory snippet count from chrome.storage and displays badge.
 */
function loadMemoryCount() {
    chrome.storage.local.get(['memoryProfile'], (stored) => {
        if (!memoryCountEl) return;
        const profile = stored.memoryProfile;
        if (!profile) {
            memoryCountEl.style.display = 'none';
            return;
        }
        const snippetCount = (profile.snippets || []).length;
        const hasIdentity = profile.identity && Object.values(profile.identity).some(v => v && v.trim());
        const hasLinks = profile.links && Object.values(profile.links).some(v => v && v.trim());
        const hasEdu = profile.education && Object.values(profile.education).some(v => v && v.trim());
        const totalItems = snippetCount + (hasIdentity ? 1 : 0) + (hasLinks ? 1 : 0) + (hasEdu ? 1 : 0);

        if (totalItems > 0) {
            memoryCountEl.textContent = String(totalItems);
            memoryCountEl.style.display = 'inline-flex';
        } else {
            memoryCountEl.style.display = 'none';
        }
    });
}

// Instant Profile Autofill Button Click Handler
if (instantAutofillBtn) {
    instantAutofillBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (!tabId) return;

            instantAutofillBtn.disabled = true;
            instantAutofillBtn.style.opacity = '0.6';

            chrome.scripting.executeScript({
                target: { tabId },
                files: ['src/services/memoryRetriever.js', 'src/content/content.js']
            }).then(() => {
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, { action: "INSTANT_FILL_PROFILE" }, (res) => {
                        instantAutofillBtn.disabled = false;
                        instantAutofillBtn.style.opacity = '1';
                        if (chrome.runtime.lastError) {
                            showStatus('Please refresh the form page and try again', 'error');
                        } else if (res && res.success) {
                            if (res.filledCount > 0) {
                                showStatus(`⚡ Filled ${res.filledCount} field${res.filledCount > 1 ? 's' : ''} in 0ms!`, 'success');
                            } else {
                                showStatus('No matching profile fields detected on page', 'info');
                            }
                        }
                    });
                }, 200);
            }).catch((err) => {
                instantAutofillBtn.disabled = false;
                instantAutofillBtn.style.opacity = '1';
                showStatus('Cannot inject script into tab', 'error');
            });
        });
    });
}

// Main Solve / Stop Button Click Handler
solveBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) return;

        // If currently in Stop state
        if (solveBtn.classList.contains('btn-danger')) {
            chrome.tabs.sendMessage(tabId, { action: "STOP_SOLVING" }, () => {
                setSolvingButtonState(false);
                hidePopupProgress();
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
            files: ['src/services/memoryRetriever.js', 'src/content/content.js']
        }).then(() => {
            setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { action: "START_SOLVING" }, (res) => {
                    solveSpinner.style.display = 'none';
                    if (chrome.runtime.lastError) {
                        setSolvingButtonState(false);
                        hidePopupProgress();
                        showStatus('Refresh the form page and try again', 'error');
                    } else {
                        setSolvingButtonState(true);
                        updatePopupProgress(5, 1, 0);
                        startProgressPolling(tabId);
                        showStatus('Solving form questions...', 'success');
                    }
                });
            }, 300);
        }).catch((err) => {
            solveSpinner.style.display = 'none';
            setSolvingButtonState(false);
            hidePopupProgress();
            showStatus('Cannot inject script into this tab', 'error');
        });
    });
});
