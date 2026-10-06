/**
 * @file src/popup/popup.js
 * @description AutoForm AI v2.0 Popup Controller.
 * Handles active tab analysis, server health checks, solving triggers, and preferences persistence.
 * Zero-config, clean, minimal implementation.
 */

const DEFAULT_SERVER_URL = "https://autoform-ai.onrender.com";

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
const previewBeforeFill = document.getElementById('previewBeforeFill');
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
const fabVisibilitySelect = document.getElementById('fabVisibilitySelect');
const siteExclusionRow = document.getElementById('siteExclusionRow');
const siteExclusionHost = document.getElementById('siteExclusionHost');
const siteExclusionBtn = document.getElementById('siteExclusionBtn');
const siteStatusDot = document.getElementById('siteStatusDot');
let currentTabHost = '';
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
            popupProgressStatus.innerText = `Filling Question ${currentQ} of ${totalQ}`;
        } else {
            popupProgressStatus.innerText = 'Filling questions...';
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
                refreshAuthAndSubscriptionStatus();
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
        // Handle announcement / maintenance banners
        const banner = document.getElementById('announcementBanner');
        if (banner) {
            if (res?.maintenance) {
                banner.textContent = res.maintenanceMessage || 'AutoForm AI is under maintenance. AI form filling may be temporarily unavailable.';
                banner.className = 'announcement-banner maintenance';
                banner.style.display = 'block';
            } else if (res?.announcement) {
                banner.textContent = res.announcement;
                banner.className = 'announcement-banner info';
                banner.style.display = 'block';
            } else {
                banner.style.display = 'none';
            }
        }

        // Update footer provider names dynamically
        const footerProviders = document.getElementById('footerProviders');

        if (!chrome.runtime.lastError && res && res.success) {
            connectionPill.className = 'connection-pill status-online';
            const providers = res.data?.activeProviders || [];
            const count = providers.length || 1;
            connectionText.innerHTML = `${count} <span class="engine-word">Engine${count > 1 ? 's' : ''}</span>`;
            const providerNames = providers.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' • ');
            connectionPill.title = `AI Engines Online: ${providerNames || 'Active'} (Connected to ${res.serverUrl || 'Cloud'})`;
            if (footerProviders) footerProviders.textContent = providerNames || 'Connected';
        } else {
            connectionPill.className = 'connection-pill status-offline';
            connectionText.innerText = 'Offline';
            connectionPill.title = 'Backend proxy server offline or unreachable';
            if (quotaBadge) quotaBadge.style.display = 'none';
            if (footerProviders) footerProviders.textContent = 'Offline';
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

            if (quotaFooterText && !window._hasMonthlyQuotaRendered) {
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
            if (siteExclusionRow) siteExclusionRow.style.display = 'none';
            formStatusTitle.innerText = "System Page";
            formStatusDesc.innerText = "Open a form or job application to use AutoForm";
            solveBtn.disabled = true;
            if (instantAutofillBtn) instantAutofillBtn.disabled = true;
            questionBadge.style.display = 'none';
            hidePopupProgress();
            return;
        }

        try {
            if (url.startsWith('http')) {
                currentTabHost = new URL(url).hostname;
                updateSiteExclusionUI(currentTabHost);
            } else {
                if (siteExclusionRow) siteExclusionRow.style.display = 'none';
            }
        } catch (_) {
            if (siteExclusionRow) siteExclusionRow.style.display = 'none';
        }

        // Check if current site is excluded
        chrome.storage.local.get(['excludedDomains'], (data) => {
            const excluded = data.excludedDomains || [];
            const isExcluded = currentTabHost && excluded.some(d => d && (currentTabHost.toLowerCase() === d.toLowerCase() || currentTabHost.toLowerCase().endsWith('.' + d.toLowerCase())));

            if (isExcluded) {
                formStatusTitle.innerText = "Site Disabled";
                formStatusDesc.innerText = `AutoForm is paused on ${currentTabHost}`;
                solveBtn.disabled = true;
                if (instantAutofillBtn) instantAutofillBtn.disabled = true;
                questionBadge.style.display = 'none';
                hidePopupProgress();
                return;
            }

            querySolverStatus();
        });

        function querySolverStatus(retried = false) {
            chrome.tabs.sendMessage(activeTab.id, { action: "GET_SOLVER_STATUS" }, (res) => {
                if (chrome.runtime.lastError) {
                    const scriptingApi = (typeof browser !== 'undefined' && browser.scripting) ? browser.scripting : (chrome.scripting || null);
                    if (!retried && scriptingApi) {
                        // Attempt on-demand script injection
                        scriptingApi.executeScript({
                            target: { tabId: activeTab.id },
                            files: ['src/services/resumeExtractor.js', 'src/services/memoryRetriever.js', 'src/services/formAdapters.js', 'src/content/content.js']
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
    });
}

/**
 * Updates site exclusion bar state for active tab hostname.
 * @param {string} hostname 
 */
function updateSiteExclusionUI(hostname) {
    if (!siteExclusionRow || !siteExclusionHost || !siteExclusionBtn || !hostname) return;
    siteExclusionRow.style.display = 'flex';
    siteExclusionHost.textContent = hostname;

    chrome.storage.local.get(['excludedDomains'], (data) => {
        const excluded = data.excludedDomains || [];
        const isExcluded = excluded.some(d => d && (hostname.toLowerCase() === d.toLowerCase() || hostname.toLowerCase().endsWith('.' + d.toLowerCase())));

        if (isExcluded) {
            if (siteStatusDot) siteStatusDot.className = 'site-status-dot site-dot-disabled';
            siteExclusionBtn.textContent = 'Enable AutoForm';
            siteExclusionBtn.className = 'site-exclusion-btn is-disabled';
            siteExclusionBtn.title = 'Re-enable AutoForm detection on this domain';
        } else {
            if (siteStatusDot) siteStatusDot.className = 'site-status-dot site-dot-active';
            siteExclusionBtn.textContent = 'Disable on this site';
            siteExclusionBtn.className = 'site-exclusion-btn';
            siteExclusionBtn.title = 'Disable AutoForm floating button and detection on this domain';
        }
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
        'fillPacing',
        'previewBeforeFill',
        'fabVisibility'
    ], (stored) => {
        if (stored.tone) toneSelect.value = stored.tone;
        if (stored.customContext) customContext.value = stored.customContext;
        if (stored.fillPacing && pacingSelect) pacingSelect.value = (stored.fillPacing === 'stealth' ? 'slow' : stored.fillPacing);
        if (stored.fabVisibility && fabVisibilitySelect) fabVisibilitySelect.value = stored.fabVisibility;
        if (previewBeforeFill) {
            // Default to true if not set
            previewBeforeFill.checked = stored.previewBeforeFill !== false;
        }
    });

    checkServerHealth();
    fetchClientQuota();
    analyzeActiveTab();
    loadMemoryCount();
    refreshAuthAndSubscriptionStatus();
});

// Auto-refresh when popup is focused or becomes visible
window.addEventListener('focus', () => {
    refreshAuthAndSubscriptionStatus();
    fetchClientQuota();
});

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.authUser || changes.quota)) {
            refreshAuthAndSubscriptionStatus();
        }
    });
}

// Save preferences on change
if (previewBeforeFill) {
    previewBeforeFill.addEventListener('change', () => {
        chrome.storage.local.set({ previewBeforeFill: previewBeforeFill.checked });
    });
}

if (fabVisibilitySelect) {
    fabVisibilitySelect.addEventListener('change', () => {
        chrome.storage.local.set({ fabVisibility: fabVisibilitySelect.value });
    });
}

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

// Site Exclusion Toggle Button Handler
if (siteExclusionBtn) {
    siteExclusionBtn.addEventListener('click', () => {
        if (!currentTabHost) return;
        chrome.storage.local.get(['excludedDomains'], (data) => {
            let excluded = data.excludedDomains || [];
            const isExcluded = excluded.some(d => d && (currentTabHost.toLowerCase() === d.toLowerCase() || currentTabHost.toLowerCase().endsWith('.' + d.toLowerCase())));

            if (isExcluded) {
                // Remove from excluded list
                excluded = excluded.filter(d => d && d.toLowerCase() !== currentTabHost.toLowerCase());
                showStatus(`Re-enabled AutoForm on ${currentTabHost}`, 'success');
            } else {
                // Add to excluded list
                if (!excluded.includes(currentTabHost)) excluded.push(currentTabHost);
                showStatus(`Disabled AutoForm on ${currentTabHost}`, 'info');
            }

            chrome.storage.local.set({ excludedDomains: excluded }, () => {
                updateSiteExclusionUI(currentTabHost);
                analyzeActiveTab();
            });
        });
    });
}

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
    formStatusCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            formStatusTitle.innerText = 'Scanning tab...';
            formStatusDesc.innerText = 'Checking for inputs and form fields...';
            analyzeActiveTab();
        }
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
    chrome.storage.local.get(['memoryProfile', 'storedResume'], (stored) => {
        // Handle stored resume indicator
        const resumeRow = document.getElementById('resumeStatusRow');
        const resumeName = document.getElementById('popupResumeName');
        if (resumeRow && resumeName) {
            if (stored.storedResume && stored.storedResume.fileName) {
                resumeName.textContent = stored.storedResume.fileName;
                resumeRow.style.display = 'flex';
            } else {
                resumeRow.style.display = 'none';
            }
        }

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
                files: ['src/services/resumeExtractor.js', 'src/services/memoryRetriever.js', 'src/services/formAdapters.js', 'src/content/content.js']
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

        // New users can complete two guest trial forms before sign-in is needed.
        chrome.storage.local.get(['useDirectKey'], () => {
            // Trigger Solve
            solveBtn.disabled = true;
            solveBtnText.innerText = "Starting...";
            solveSpinner.style.display = 'block';

            chrome.scripting.executeScript({
                target: { tabId },
                files: ['src/services/resumeExtractor.js', 'src/services/memoryRetriever.js', 'src/services/formAdapters.js', 'src/content/content.js']
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
                        showStatus('Filling form questions...', 'success');
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
});

// ---------------------------------------------------------------------------
// Auth, Subscription & Paid Plan Controller
// ---------------------------------------------------------------------------

const loggedOutView = document.getElementById('loggedOutView');
const loggedInView = document.getElementById('loggedInView');
const btnGoogleSignIn = document.getElementById('btnGoogleSignIn');
const btnSignOut = document.getElementById('btnSignOut');
const planBadgeGuest = document.getElementById('planBadgeGuest');
const monthlyQuotaDisplayGuest = document.getElementById('monthlyQuotaDisplayGuest');
const btnUpgradeProGuest = document.getElementById('btnUpgradeProGuest');
const userAvatar = document.getElementById('userAvatar');
const userNameDisplay = document.getElementById('userNameDisplay');
const userPlanBadge = document.getElementById('userPlanBadge');
const userMonthlyQuotaText = document.getElementById('userMonthlyQuotaText');
const btnUpgradeProUser = document.getElementById('btnUpgradeProUser');
const upgradeModalBackdrop = document.getElementById('upgradeModalBackdrop');
const btnCloseUpgradeModal = document.getElementById('btnCloseUpgradeModal');
const razorpayPaymentIdInput = document.getElementById('razorpayPaymentIdInput');
const btnVerifyPayment = document.getElementById('btnVerifyPayment');
const paymentVerifyStatus = document.getElementById('paymentVerifyStatus');

/**
 * Fetches the latest authentication and subscription quota status from background.
 */
function refreshAuthAndSubscriptionStatus() {
    chrome.runtime.sendMessage({ action: "GET_AUTH_STATUS" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success) return;
        renderAuthUI(res.user, res.stats, res.quota, res.guestTrialCompletedForms);
    });
}

/**
 * Updates popup UI elements with authenticated user info and plan status.
 * @param {Object} user 
 * @param {Object} stats 
 * @param {Object} quota 
 */
function renderAuthUI(user = {}, stats = {}, quota = {}, guestTrialCompletedForms = 0) {
    const isPro = Boolean(quota.isPro || (user?.plan === 'pro'));
    const isGuest = !user?.id;
    const limit = quota.limit !== undefined ? quota.limit : (isPro ? 300 : 10);
    const remaining = quota.remaining !== undefined ? quota.remaining : (isPro ? 300 : 10);

    if (isGuest) {
        if (loggedOutView) loggedOutView.style.display = 'flex';
        if (loggedInView) loggedInView.style.display = 'none';

        if (planBadgeGuest) {
            planBadgeGuest.textContent = 'FREE';
            planBadgeGuest.className = 'plan-tag-badge plan-badge-free';
        }
        if (monthlyQuotaDisplayGuest) {
            monthlyQuotaDisplayGuest.textContent = `${Math.max(0, 2 - guestTrialCompletedForms)} of 2 free trials left`;
        }
        if (btnUpgradeProGuest) {
            btnUpgradeProGuest.style.display = 'none';
        }
    } else {
        if (loggedOutView) loggedOutView.style.display = 'none';
        if (loggedInView) loggedInView.style.display = 'flex';

        if (userNameDisplay) {
            userNameDisplay.textContent = user.name || user.email || 'User';
            userNameDisplay.title = user.email || '';
        }
        if (userAvatar) {
            if (user.picture) {
                userAvatar.textContent = '';
                userAvatar.style.backgroundImage = `url("${user.picture}")`;
            } else {
                userAvatar.style.backgroundImage = 'none';
                const initial = (user.name || user.email || 'U').charAt(0).toUpperCase();
                userAvatar.textContent = initial;
            }
        }
        if (userPlanBadge) {
            userPlanBadge.textContent = isPro ? 'PRO' : 'FREE';
            userPlanBadge.className = `plan-tag-badge ${isPro ? 'plan-badge-pro' : 'plan-badge-free'}`;
        }
        if (userMonthlyQuotaText) {
            userMonthlyQuotaText.textContent = isPro 
                ? 'Unlimited Forms' 
                : `${remaining} of ${limit} forms left this month`;
        }
        const paymentsEnabled = quota.paymentsEnabled !== false;
        if (btnUpgradeProUser) {
            btnUpgradeProUser.style.display = (isPro || !paymentsEnabled) ? 'none' : 'inline-flex';
        }
    }

    window._hasMonthlyQuotaRendered = true;
    if (quotaFooterText) {
        if (isGuest) {
            quotaFooterText.innerText = '10 free forms/month with Google account';
        } else if (isPro) {
            quotaFooterText.innerText = 'Pro: Unlimited forms (Fair-use 300/mo)';
        } else {
            quotaFooterText.innerText = `${remaining} of ${limit} forms left this month`;
        }
    }
}

// Google Sign-In button
if (btnGoogleSignIn) {
    btnGoogleSignIn.addEventListener('click', () => {
        // Run permission request synchronously inside user click handler before any await or message
        const consentPromise = (typeof AutoFormAuth !== 'undefined' && typeof AutoFormAuth.requestOptionalDataConsent === 'function')
            ? AutoFormAuth.requestOptionalDataConsent('authenticationInfo')
            : Promise.resolve({ granted: true });

        btnGoogleSignIn.disabled = true;
        btnGoogleSignIn.style.opacity = '0.7';

        consentPromise.then((consent) => {
            if (!consent.granted) {
                btnGoogleSignIn.disabled = false;
                btnGoogleSignIn.style.opacity = '1';
                showStatus(consent.error || 'Permission to access authentication info was declined.', 'error');
                return;
            }

            chrome.runtime.sendMessage({ action: "SIGN_IN_GOOGLE" }, (res) => {
                btnGoogleSignIn.disabled = false;
                btnGoogleSignIn.style.opacity = '1';
                if (chrome.runtime.lastError) {
                    showStatus(`Sign-in error: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                if (!res || !res.success) {
                    if (res?.code === 'IDENTITY_API_UNSUPPORTED') {
                        const syncBox = document.getElementById('deviceSyncBox');
                        if (syncBox) syncBox.style.display = 'block';
                        const syncMsg = document.getElementById('popupSyncMsg');
                        if (syncMsg) {
                            syncMsg.textContent = res.error;
                            syncMsg.className = 'device-sync-msg error';
                            syncMsg.style.display = 'block';
                        }
                    }
                    showStatus(res?.error || 'Sign-in cancelled or window closed', 'error');
                    return;
                }
                renderAuthUI(res.user, res.stats, res.quota);
                showStatus(`Welcome, ${res.user?.name || 'User'}!`, 'success');
            });
        });
    });
}

// ---------------------------------------------------------------------------
// Mobile Device Sync Handlers (Firefox Android & Cross-Device)
// ---------------------------------------------------------------------------

const btnToggleSyncPopup = document.getElementById('btnToggleSyncPopup');
const deviceSyncBox = document.getElementById('deviceSyncBox');
const btnCloseDeviceSync = document.getElementById('btnCloseDeviceSync');
const btnApplySyncCode = document.getElementById('btnApplySyncCode');
const popupSyncCodeInput = document.getElementById('popupSyncCodeInput');
const popupSyncMsg = document.getElementById('popupSyncMsg');

if (btnToggleSyncPopup && deviceSyncBox) {
    btnToggleSyncPopup.addEventListener('click', () => {
        const isShown = deviceSyncBox.style.display === 'block';
        deviceSyncBox.style.display = isShown ? 'none' : 'block';
        if (!isShown && popupSyncCodeInput) {
            popupSyncCodeInput.focus();
        }
    });
}

if (btnCloseDeviceSync && deviceSyncBox) {
    btnCloseDeviceSync.addEventListener('click', () => {
        deviceSyncBox.style.display = 'none';
        if (popupSyncMsg) popupSyncMsg.style.display = 'none';
    });
}

if (btnApplySyncCode && popupSyncCodeInput) {
    btnApplySyncCode.addEventListener('click', () => {
        const code = popupSyncCodeInput.value.trim();
        if (!code) {
            if (popupSyncMsg) {
                popupSyncMsg.textContent = 'Please enter a 6-digit sync code or token.';
                popupSyncMsg.className = 'device-sync-msg error';
                popupSyncMsg.style.display = 'block';
            }
            return;
        }

        btnApplySyncCode.disabled = true;
        btnApplySyncCode.textContent = 'Linking...';

        chrome.runtime.sendMessage({ action: "LINK_ACCOUNT_TOKEN", code }, (res) => {
            btnApplySyncCode.disabled = false;
            btnApplySyncCode.textContent = 'Link';

            if (chrome.runtime.lastError || !res || !res.success) {
                if (popupSyncMsg) {
                    popupSyncMsg.textContent = res?.error || 'Failed to link account. Please check the code.';
                    popupSyncMsg.className = 'device-sync-msg error';
                    popupSyncMsg.style.display = 'block';
                }
                return;
            }

            if (deviceSyncBox) deviceSyncBox.style.display = 'none';
            renderAuthUI(res.user, {}, res.quota);
            showStatus(`Account linked successfully! Welcome, ${res.user?.name || res.user?.email || 'User'}!`, 'success');
        });
    });
}

// Laptop / Desktop: Share pairing code with mobile
const btnShareSyncCode = document.getElementById('btnShareSyncCode');
const deviceSyncShareBox = document.getElementById('deviceSyncShareBox');
const btnCloseShareSync = document.getElementById('btnCloseShareSync');
const popupShareCodeDigits = document.getElementById('popupShareCodeDigits');
const btnCopyShareCode = document.getElementById('btnCopyShareCode');
let activeShareCode = '';

if (btnShareSyncCode && deviceSyncShareBox) {
    btnShareSyncCode.addEventListener('click', () => {
        const isShown = deviceSyncShareBox.style.display === 'block';
        if (isShown) {
            deviceSyncShareBox.style.display = 'none';
            return;
        }

        deviceSyncShareBox.style.display = 'block';
        if (popupShareCodeDigits) popupShareCodeDigits.textContent = 'Generating...';

        chrome.runtime.sendMessage({ action: "CREATE_DEVICE_PAIR_CODE" }, (res) => {
            if (res && res.success) {
                if (res.code) {
                    const formatted = `${res.code.slice(0, 3)} ${res.code.slice(3)}`;
                    activeShareCode = res.code;
                    if (popupShareCodeDigits) popupShareCodeDigits.textContent = formatted;
                } else if (res.token) {
                    activeShareCode = res.token;
                    if (popupShareCodeDigits) popupShareCodeDigits.textContent = 'TOKEN READY';
                }
            } else {
                if (popupShareCodeDigits) popupShareCodeDigits.textContent = 'ERR';
                showStatus(res?.error || 'Could not generate sync code', 'error');
            }
        });
    });
}

if (btnCloseShareSync && deviceSyncShareBox) {
    btnCloseShareSync.addEventListener('click', () => {
        deviceSyncShareBox.style.display = 'none';
    });
}

if (btnCopyShareCode) {
    btnCopyShareCode.addEventListener('click', () => {
        if (!activeShareCode) return;
        navigator.clipboard.writeText(activeShareCode).then(() => {
            btnCopyShareCode.textContent = 'Copied!';
            setTimeout(() => { btnCopyShareCode.textContent = 'Copy'; }, 2000);
        }).catch(() => {
            showStatus('Failed to copy to clipboard', 'error');
        });
    });
}

// Sign-Out button
if (btnSignOut) {
    btnSignOut.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "SIGN_OUT" }, (res) => {
            if (chrome.runtime.lastError || !res || !res.success) return;
            renderAuthUI(res.user, res.stats, res.quota);
            showStatus('Signed out', 'info');
        });
    });
}

// Upgrade Modal controls
function openUpgradeModal() {
    if (upgradeModalBackdrop) {
        upgradeModalBackdrop.style.display = 'flex';
    }
}

function closeUpgradeModal() {
    if (upgradeModalBackdrop) {
        upgradeModalBackdrop.style.display = 'none';
    }
}

if (btnUpgradeProGuest) btnUpgradeProGuest.addEventListener('click', openUpgradeModal);
if (btnUpgradeProUser) btnUpgradeProUser.addEventListener('click', openUpgradeModal);
if (btnCloseUpgradeModal) btnCloseUpgradeModal.addEventListener('click', closeUpgradeModal);

const btnCheckoutPro = document.getElementById('btnCheckoutPro');
let selectedPopupPlan = 'pass_30d';
const passOptionButtons = document.querySelectorAll('.pass-option-btn');
passOptionButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        passOptionButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedPopupPlan = btn.dataset.plan || 'pass_30d';
        if (btnCheckoutPro) {
            const planNames = {
                'pass_14d': '14-Day Pass (₹99)',
                'pass_30d': '30-Day Pass (₹149)',
                'pass_90d': '90-Day Pass (₹349)'
            };
            btnCheckoutPro.innerHTML = `<span>⭐ Get ${planNames[selectedPopupPlan] || 'Pass'}</span>`;
        }
    });
});

if (btnCheckoutPro) {
    btnCheckoutPro.addEventListener('click', () => {
        // Run permission request synchronously inside user click handler before any await or message
        const consentPromise = (typeof AutoFormAuth !== 'undefined' && typeof AutoFormAuth.requestOptionalDataConsent === 'function')
            ? AutoFormAuth.requestOptionalDataConsent('financialAndPaymentInfo')
            : Promise.resolve({ granted: true });

        consentPromise.then((consent) => {
            if (!consent.granted) {
                showStatus(consent.error || 'Permission to process payment info was declined.', 'error');
                return;
            }

            chrome.runtime.sendMessage({ action: "OPEN_CHECKOUT_PAGE", plan: selectedPopupPlan }, () => {
                closeUpgradeModal();
            });
        });
    });
}

if (upgradeModalBackdrop) {
    upgradeModalBackdrop.addEventListener('click', (e) => {
        if (e.target === upgradeModalBackdrop) {
            closeUpgradeModal();
        }
    });
}

// Production Razorpay Payment ID Verification & Activation
function handleRazorpayActivation() {
    const paymentId = razorpayPaymentIdInput?.value?.trim();
    if (!paymentId) {
        if (paymentVerifyStatus) {
            paymentVerifyStatus.textContent = 'Please enter your Razorpay Payment ID.';
            paymentVerifyStatus.className = 'payment-verify-status error';
            paymentVerifyStatus.style.display = 'block';
        }
        return;
    }

    if (!paymentId.startsWith('pay_')) {
        if (paymentVerifyStatus) {
            paymentVerifyStatus.textContent = 'Invalid ID. Razorpay Payment IDs start with "pay_".';
            paymentVerifyStatus.className = 'payment-verify-status error';
            paymentVerifyStatus.style.display = 'block';
        }
        return;
    }

    if (btnVerifyPayment) {
        btnVerifyPayment.disabled = true;
        btnVerifyPayment.textContent = 'Verifying...';
    }
    if (paymentVerifyStatus) paymentVerifyStatus.style.display = 'none';

    // Run permission request synchronously inside user click handler before any await or message
    const consentPromise = (typeof AutoFormAuth !== 'undefined' && typeof AutoFormAuth.requestOptionalDataConsent === 'function')
        ? AutoFormAuth.requestOptionalDataConsent('financialAndPaymentInfo')
        : Promise.resolve({ granted: true });

    consentPromise.then((consent) => {
        if (!consent.granted) {
            if (btnVerifyPayment) {
                btnVerifyPayment.disabled = false;
                btnVerifyPayment.textContent = 'Activate';
            }
            if (paymentVerifyStatus) {
                paymentVerifyStatus.textContent = consent.error || 'Permission to process payment info was declined.';
                paymentVerifyStatus.className = 'payment-verify-status error';
                paymentVerifyStatus.style.display = 'block';
            }
            return;
        }

        chrome.runtime.sendMessage({
            action: "VERIFY_PAYMENT",
            paymentId
        }, (res) => {
        if (btnVerifyPayment) {
            btnVerifyPayment.disabled = false;
            btnVerifyPayment.textContent = 'Activate';
        }

        if (chrome.runtime.lastError || !res || !res.success) {
            if (paymentVerifyStatus) {
                paymentVerifyStatus.textContent = res?.error || 'Verification failed. Please check the ID.';
                paymentVerifyStatus.className = 'payment-verify-status error';
                paymentVerifyStatus.style.display = 'block';
            }
            return;
        }

        if (paymentVerifyStatus) {
            paymentVerifyStatus.textContent = '✓ Payment verified! AutoForm Pro Activated!';
            paymentVerifyStatus.className = 'payment-verify-status success';
            paymentVerifyStatus.style.display = 'block';
        }

        renderAuthUI(res.user, res.stats, res.quota);
        showStatus('AutoForm Pro Activated! ⭐', 'success');

        setTimeout(() => {
            closeUpgradeModal();
        }, 1600);
    });
    });
}

if (btnVerifyPayment) {
    btnVerifyPayment.addEventListener('click', handleRazorpayActivation);
}

if (razorpayPaymentIdInput) {
    razorpayPaymentIdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleRazorpayActivation();
        }
    });
}
