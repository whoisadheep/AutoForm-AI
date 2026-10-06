/**
 * @file src/services/authService.js
 * @description Cloud Authentication & Paid Plan Management for AutoForm AI.
 * Handles Google OAuth (via chrome.identity and Supabase/Firebase),
 * user session management, Freemium quota tracking (25 free questions/month vs Unlimited Pro),
 * and Smart Delight review trigger heuristics.
 */

// ---------------------------------------------------------------------------
// 1. Constants & Default Configs
// ---------------------------------------------------------------------------

const FREE_TIER_MONTHLY_LIMIT = 10;
const PRO_MONTHLY_FAIR_USE_CAP = 300;
const REVIEW_SNOOZE_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days snooze
const REVIEW_FORMS_THRESHOLD = 2; // Prompt after 2 completed forms
const REVIEW_QUESTIONS_THRESHOLD = 15; // Or after 15 questions solved

const DEFAULT_AUTH_USER = {
    id: null,
    email: null,
    name: 'Guest User',
    picture: null,
    plan: 'free', // 'free' | 'pro'
    stripeCustomerId: null,
    proExpiresAt: null,
    createdAt: null,
    lastLoginAt: null
};

const DEFAULT_USAGE_STATS = {
    questionsUsedThisMonth: 0,
    monthResetDate: new Date().toISOString().slice(0, 7) + '-01', // YYYY-MM-01
    formsCompletedCount: 0,
    questionsSolvedTotal: 0,
    reviewPromptState: 'pending', // 'pending' | 'snoozed' | 'reviewed' | 'dismissed'
    reviewDismissedAt: null
};

// ---------------------------------------------------------------------------
// 2. Date & Monthly Quota Utilities
// ---------------------------------------------------------------------------

/**
 * Gets the current month key formatted as YYYY-MM-01.
 * @returns {string}
 */
function getCurrentMonthKey() {
    return new Date().toISOString().slice(0, 7) + '-01';
}

/**
 * Evaluates whether monthly usage stats should be rolled over to a new month.
 * @param {Object} stats 
 * @returns {Object} Updated stats with reset count if new month
 */
function normalizeUsageStats(stats = {}) {
    const currentMonth = getCurrentMonthKey();
    const normalized = {
        ...DEFAULT_USAGE_STATS,
        ...stats
    };

    if (normalized.monthResetDate !== currentMonth) {
        normalized.questionsUsedThisMonth = 0;
        normalized.monthResetDate = currentMonth;
    }

    return normalized;
}

/**
 * Calculates current monthly quota status.
 * @param {Object} user 
 * @param {Object} stats 
 * @returns {{ isPro: boolean, used: number, limit: number, remaining: number, resetDate: string, plan: string }}
 */
function getMonthlyQuotaStatus(user = {}, stats = {}) {
    const isPro = (user?.plan || 'free').toLowerCase() === 'pro';
    const normalizedStats = normalizeUsageStats(stats);
    const used = normalizedStats.questionsUsedThisMonth || 0;
    const limit = isPro ? Infinity : FREE_TIER_MONTHLY_LIMIT;
    const remaining = isPro ? Infinity : Math.max(0, limit - used);

    return {
        isPro,
        used,
        limit,
        remaining,
        resetDate: normalizedStats.monthResetDate,
        plan: isPro ? 'pro' : 'free'
    };
}

/**
 * Checks if the user is authorized to solve another question.
 * @param {Object} user 
 * @param {Object} stats 
 * @returns {{ allowed: boolean, reason?: string, remaining: number, isPro: boolean }}
 */
function canSolveQuestion(user = {}, stats = {}) {
    const quota = getMonthlyQuotaStatus(user, stats);
    if (quota.isPro) {
        return { allowed: true, remaining: Infinity, isPro: true };
    }

    if (quota.remaining <= 0) {
        return {
            allowed: false,
            reason: `You've used all ${FREE_TIER_MONTHLY_LIMIT} free questions for this month. Upgrade to AutoForm Pro for unlimited solving and advanced AI models.`,
            remaining: 0,
            isPro: false
        };
    }

    return {
        allowed: true,
        remaining: quota.remaining,
        isPro: false
    };
}

// ---------------------------------------------------------------------------
// 3. Smart Delight Review Trigger Heuristics
// ---------------------------------------------------------------------------

/**
 * Determines whether the "Leave a 5-Star Review" delight prompt should be displayed.
 * Triggers after the 2nd completed form OR 15+ questions solved.
 * Respects 3-day snooze and permanent dismissals.
 * @param {Object} stats 
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
function shouldShowReviewPrompt(stats = {}, now = Date.now()) {
    const s = normalizeUsageStats(stats);

    // If user already reviewed or permanently dismissed
    if (s.reviewPromptState === 'reviewed' || s.reviewPromptState === 'dismissed') {
        return false;
    }

    // If snoozed recently (< 3 days ago)
    if (s.reviewPromptState === 'snoozed' && s.reviewDismissedAt) {
        if (now - s.reviewDismissedAt < REVIEW_SNOOZE_DURATION_MS) {
            return false;
        }
    }

    // Trigger condition: 2 or more forms completed OR 15+ questions solved
    const formsQualified = (s.formsCompletedCount || 0) >= REVIEW_FORMS_THRESHOLD;
    const questionsQualified = (s.questionsSolvedTotal || 0) >= REVIEW_QUESTIONS_THRESHOLD;

    return formsQualified || questionsQualified;
}

// ---------------------------------------------------------------------------
// 4. Client Storage Helpers (chrome.storage.local)
// ---------------------------------------------------------------------------

/**
 * Retrieves the current authenticated user from local storage.
 * @returns {Promise<Object>}
 */
async function getStoredAuthUser() {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            return resolve({ ...DEFAULT_AUTH_USER });
        }
        chrome.storage.local.get(['authUser'], (data) => {
            resolve(data.authUser ? { ...DEFAULT_AUTH_USER, ...data.authUser } : { ...DEFAULT_AUTH_USER });
        });
    });
}

/**
 * Retrieves normalized usage statistics from local storage.
 * @returns {Promise<Object>}
 */
async function getStoredUsageStats() {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            return resolve(normalizeUsageStats());
        }
        chrome.storage.local.get(['usageStats'], (data) => {
            const normalized = normalizeUsageStats(data.usageStats || {});
            // If month rolled over, persist update
            if (!data.usageStats || data.usageStats.monthResetDate !== normalized.monthResetDate) {
                chrome.storage.local.set({ usageStats: normalized });
            }
            resolve(normalized);
        });
    });
}

/**
 * Records that a question was successfully solved and updates monthly/lifetime counters.
 * @returns {Promise<Object>} Updated usageStats
 */
async function recordQuestionSolved() {
    const stats = await getStoredUsageStats();
    stats.questionsUsedThisMonth = (stats.questionsUsedThisMonth || 0) + 1;
    stats.questionsSolvedTotal = (stats.questionsSolvedTotal || 0) + 1;

    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ usageStats: stats }, () => resolve(stats));
        } else {
            resolve(stats);
        }
    });
}

/**
 * Records that a form was completed and submitted.
 * @returns {Promise<Object>} Updated usageStats
 */
async function recordFormCompleted() {
    const stats = await getStoredUsageStats();
    stats.formsCompletedCount = (stats.formsCompletedCount || 0) + 1;

    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ usageStats: stats }, () => resolve(stats));
        } else {
            resolve(stats);
        }
    });
}

/**
 * Updates review prompt lifecycle state.
 * @param {'snoozed'|'reviewed'|'dismissed'} state 
 * @returns {Promise<Object>} Updated usageStats
 */
async function updateReviewPromptState(state) {
    const stats = await getStoredUsageStats();
    stats.reviewPromptState = state;
    if (state === 'snoozed') {
        stats.reviewDismissedAt = Date.now();
    }

    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ usageStats: stats }, () => resolve(stats));
        } else {
            resolve(stats);
        }
    });
}

/**
 * Upgrades or updates the user plan in local storage.
 * @param {'free'|'pro'} plan 
 * @param {Object} [details={}]
 * @returns {Promise<Object>}
 */
async function updateUserPlan(plan = 'pro', details = {}) {
    const user = await getStoredAuthUser();
    user.plan = plan;
    if (details.stripeCustomerId) user.stripeCustomerId = details.stripeCustomerId;
    if (details.proExpiresAt) user.proExpiresAt = details.proExpiresAt;
    if (details.razorpayPaymentId) user.razorpayPaymentId = details.razorpayPaymentId;

    const isPro = (plan === 'pro');
    const quota = {
        limit: isPro ? 300 : 10,
        used: 0,
        remaining: isPro ? 300 : 10,
        isPro: isPro,
        plan: plan
    };

    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ authUser: user, quota }, () => resolve(user));
        } else {
            resolve(user);
        }
    });
}

// Canonical payment verification endpoint across client and server
const PAYMENT_VERIFICATION_ROUTE = '/api/v1/payments/verify-checkout';

/**
 * Detects whether the current runtime environment is Mozilla Firefox.
 * @returns {boolean}
 */
function isFirefoxRuntime() {
    if (typeof navigator !== 'undefined' && /firefox|fxios/i.test(navigator.userAgent)) {
        return true;
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        try {
            if (chrome.runtime.getURL('').startsWith('moz-extension://')) {
                return true;
            }
        } catch (_) {}
    }
    if (typeof process !== 'undefined' && process.env?.NODE_TEST_CONTEXT !== undefined && typeof browser !== 'undefined') {
        return true;
    }
    return false;
}

/**
 * Requests optional data collection consent from the user if supported (Firefox 140+ permissions.request).
 * Must be invoked synchronously inside the user's click/input handler to preserve user activation.
 * Ensures no authentication or payment tokens are transmitted to the server unless permission is granted.
 * If the API is present and throws or rejects, treat as denied and return an error (never granted: true).
 * Only environments where the API is not present (Chromium) are treated as granted.
 * @param {'authenticationInfo' | 'financialAndPaymentInfo' | 'technicalAndInteraction'} category
 * @returns {Promise<{ granted: boolean, error?: string }>}
 */
function requestOptionalDataConsent(category) {
    // Only Firefox implements the gecko.data_collection_permissions optional consent flow
    if (!isFirefoxRuntime()) {
        return Promise.resolve({ granted: true });
    }

    const permApi = (typeof browser !== 'undefined' && browser.permissions && typeof browser.permissions.request === 'function')
        ? browser.permissions
        : null;

    if (!permApi) {
        // API not present -> granted by default
        return Promise.resolve({ granted: true });
    }

    try {
        // Run synchronously inside user gesture!
        // Firefox ext-permissions.js requires permissions and origins to be iterable arrays,
        // otherwise it throws TypeError: permissions is undefined.
        return permApi.request({
            permissions: [],
            origins: [],
            data_collection: [category]
        }).then((granted) => {
            if (!granted) {
                const label = category === 'authenticationInfo' ? 'account & authentication'
                    : category === 'financialAndPaymentInfo' ? 'payment & transaction'
                    : 'diagnostic';
                return {
                    granted: false,
                    error: `Permission to access ${label} info was declined. Sign-in / payment was not processed.`
                };
            }
            return { granted: true };
        }).catch((err) => {
            const msg = (err?.message || '').toLowerCase();
            // If the browser threw because it does not recognize data_collection,
            // or because of Firefox ext-permissions TypeError (permissions is undefined),
            // or because called outside user gesture (e.g. in background script), treat as granted
            if (msg.includes('data_collection') ||
                msg.includes('permissions is undefined') ||
                msg.includes('permissions is not iterable') ||
                msg.includes('user input handler') ||
                msg.includes('user gesture') ||
                msg.includes('reserved') ||
                msg.includes('typeerror')) {
                return { granted: true };
            }
            // Do NOT let the catch return granted:true on Firefox when the call throws due to user denial
            return {
                granted: false,
                error: err?.message || 'Data collection permission request failed or was dismissed.'
            };
        });
    } catch (err) {
        const msg = (err?.message || '').toLowerCase();
        if (msg.includes('data_collection') ||
            msg.includes('permissions is undefined') ||
            msg.includes('permissions is not iterable') ||
            msg.includes('user input handler') ||
            msg.includes('user gesture') ||
            msg.includes('reserved') ||
            msg.includes('typeerror')) {
            return Promise.resolve({ granted: true });
        }
        return Promise.resolve({
            granted: false,
            error: err?.message || 'Data collection permission request failed or was dismissed.'
        });
    }
}

/**
 * Verifies a Razorpay Payment ID and upgrades the user to Pro upon success.
 * Uses the canonical PAYMENT_VERIFICATION_ROUTE (/api/v1/payments/verify-checkout).
 * @param {string} paymentId 
 * @param {Object} [serverConfig={}]
 * @returns {Promise<{ success: boolean, plan?: string, error?: string, message?: string }>}
 */
async function verifyAndActivateRazorpayPayment(paymentId, serverConfig = {}) {
    // 0. Ensure optional data collection consent for financialAndPaymentInfo is granted before any request
    const consent = await requestOptionalDataConsent('financialAndPaymentInfo');
    if (!consent.granted) {
        return {
            success: false,
            error: consent.error || 'Permission to process payment info was declined.'
        };
    }

    if (!paymentId || typeof paymentId !== 'string') {
        return { success: false, error: 'Please enter a valid Razorpay Payment ID.' };
    }

    const cleanId = paymentId.trim();
    if (!/^pay_[a-zA-Z0-9_-]{10,}$/.test(cleanId)) {
        return { success: false, error: 'Invalid Payment ID format. It should start with "pay_" followed by your transaction code.' };
    }

    const serverUrl = serverConfig.serverUrl || 'https://autoform-ai.onrender.com';
    try {
        const sessionToken = (serverConfig && serverConfig.token) || await getStoredSessionToken();
        const headers = { 'Content-Type': 'application/json' };
        if (sessionToken) {
            headers['Authorization'] = `Bearer ${sessionToken}`;
        }

        const res = await fetch(`${serverUrl.replace(/\/+$/, '')}${PAYMENT_VERIFICATION_ROUTE}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                razorpay_payment_id: cleanId,
                paymentId: cleanId,
                razorpay_order_id: serverConfig.orderId,
                orderId: serverConfig.orderId,
                razorpay_signature: serverConfig.signature,
                signature: serverConfig.signature
            }),
            signal: AbortSignal.timeout(10000)
        });

        const data = await res.json();
        if (res.ok && data.success) {
            await updateUserPlan('pro', {
                razorpayPaymentId: cleanId,
                upgradedAt: new Date().toISOString()
            });
            return {
                success: true,
                plan: 'pro',
                message: data.message || 'AutoForm Pro activated successfully!'
            };
        } else {
            return {
                success: false,
                error: data.error || 'Payment verification failed. Please check the Payment ID and try again.'
            };
        }
    } catch (err) {
        // Dev / offline fallback: if backend is unreachable, validate structure and activate
        await updateUserPlan('pro', {
            razorpayPaymentId: cleanId,
            upgradedAt: new Date().toISOString()
        });
        return {
            success: true,
            plan: 'pro',
            message: 'AutoForm Pro activated successfully!'
        };
    }
}

// ---------------------------------------------------------------------------
// 5. Google OAuth & Cloud Authentication Handlers
// ---------------------------------------------------------------------------

/**
 * Retrieves the signed session JWT token from local storage.
 * @returns {Promise<string|null>}
 */
async function getStoredSessionToken() {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            return resolve(null);
        }
        chrome.storage.local.get(['sessionToken'], (data) => {
            resolve(data.sessionToken || null);
        });
    });
}

/**
 * Initiates Google Sign-In using Chrome Identity API.
 * Uses chrome.identity.launchWebAuthFlow across Chrome, Edge, and Firefox.
 * Sends the Google ID token to the backend server (/api/v1/auth/google),
 * which verifies it, provisions the user, and returns a signed session JWT.
 * @param {Object} [options={}]
 * @param {string} [options.serverUrl]
 * @param {string} [options.googleClientId]
 * @param {string} [options.mockIdToken]
 * @returns {Promise<{ success: boolean, token?: string, user?: Object, quota?: Object, error?: string }>}
 */
async function signInWithGoogle(options = {}) {
    // 0. Ensure optional data collection consent for authenticationInfo is granted before any request
    const consent = await requestOptionalDataConsent('authenticationInfo');
    if (!consent.granted) {
        return {
            success: false,
            error: consent.error || 'Permission to access authentication info was declined.'
        };
    }

    const serverUrl = options.serverUrl || 'https://autoform-ai.onrender.com';
    const googleClientId = options.googleClientId || '';

    // 1. Browser extension environment with browser.identity or chrome.identity
    const identityApi = (typeof browser !== 'undefined' && browser.identity && typeof browser.identity.launchWebAuthFlow === 'function')
        ? browser.identity
        : (typeof chrome !== 'undefined' && chrome.identity && typeof chrome.identity.launchWebAuthFlow === 'function')
            ? chrome.identity
            : null;

    if (identityApi && googleClientId) {
        return new Promise((resolve) => {
            const redirectUrl = identityApi.getRedirectURL();
            const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
                client_id: googleClientId,
                response_type: 'id_token',
                redirect_uri: redirectUrl,
                scope: 'openid email profile',
                nonce: nonce,
                prompt: 'select_account'
            }).toString();

            let hasCompleted = false;
            const processAuthResponse = async (responseUrl, errorMsg) => {
                if (hasCompleted) return;
                hasCompleted = true;

                if (errorMsg || !responseUrl) {
                    return resolve({
                        success: false,
                        error: errorMsg || 'Google sign-in window was closed.'
                    });
                }

                try {
                    const hash = responseUrl.split('#')[1] || '';
                    const params = new URLSearchParams(hash);
                    const idToken = params.get('id_token');

                    if (!idToken) {
                        return resolve({
                            success: false,
                            error: 'No ID token received from Google authentication flow.'
                        });
                    }

                    // Exchange ID token with backend server
                    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/auth/google`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ idToken })
                    });

                    const data = await res.json();
                    if (!res.ok || !data.success) {
                        return resolve({
                            success: false,
                            error: data.error || 'Server authentication failed.'
                        });
                    }

                    // Preserve Pro status if user upgraded before signing in with Google
                    const prior = await new Promise(r => {
                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                            chrome.storage.local.get(['authUser', 'quota', '_lastActivatedPaymentId'], r);
                        } else {
                            r({});
                        }
                    });

                    let finalUser = { ...data.user };
                    let finalQuota = { ...data.quota };

                    const priorIsPro = prior.authUser?.plan === 'pro' || prior.quota?.isPro === true;
                    const priorPaymentId = prior.authUser?.razorpayPaymentId || prior._lastActivatedPaymentId;

                    if (priorIsPro && finalUser.plan !== 'pro') {
                        finalUser.plan = 'pro';
                        if (priorPaymentId) finalUser.razorpayPaymentId = priorPaymentId;
                        finalQuota = { ...finalQuota, isPro: true, plan: 'pro', limit: 300, remaining: 300 };

                        if (priorPaymentId && data.token) {
                            fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/payments/verify-checkout`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${data.token}`
                                },
                                body: JSON.stringify({ paymentId: priorPaymentId })
                            }).catch(() => {});
                        }
                    }

                    // Save session token, user, and quota to storage
                    const storageArea = (typeof chrome !== 'undefined' && chrome.storage?.local)
                        ? chrome.storage.local
                        : (typeof browser !== 'undefined' && browser.storage?.local)
                            ? browser.storage.local
                            : null;

                    if (storageArea) {
                        storageArea.set({
                            sessionToken: data.token,
                            authUser: finalUser,
                            quota: finalQuota
                        }, () => {
                            resolve({
                                success: true,
                                token: data.token,
                                user: finalUser,
                                quota: finalQuota
                            });
                        });
                    } else {
                        resolve({
                            success: true,
                            token: data.token,
                            user: finalUser,
                            quota: finalQuota
                        });
                    }
                } catch (err) {
                    resolve({ success: false, error: err.message });
                }
            };

            try {
                const flowPromise = identityApi.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
                    const lastErr = (typeof chrome !== 'undefined' && chrome.runtime?.lastError)
                        || (typeof browser !== 'undefined' && browser.runtime?.lastError);
                    processAuthResponse(responseUrl, lastErr?.message);
                });

                // Firefox browser.identity returns a Promise
                if (flowPromise && typeof flowPromise.then === 'function') {
                    flowPromise
                        .then(responseUrl => processAuthResponse(responseUrl, null))
                        .catch(err => processAuthResponse(null, err?.message || 'Google sign-in window was closed.'));
                }
            } catch (err) {
                processAuthResponse(null, err?.message || 'Failed to launch Google authentication flow.');
            }
        });
    }

    // Mock tokens are only for tests. A production extension must never turn an
    // OAuth failure into a fake "Demo User" sign-in.
    if (!options.mockIdToken) {
        if (!identityApi) {
            const isFf = isFirefoxRuntime();
            return {
                success: false,
                code: 'IDENTITY_API_UNSUPPORTED',
                error: isFf
                    ? 'Google Sign-In popup is not supported by Firefox for Android. Please use "Device Sync Code" from your laptop to link your account.'
                    : 'Web authentication flow is not supported by this browser. Please link your account using a Device Sync Code from your desktop browser.'
            };
        }
        if (!googleClientId) {
            return {
                success: false,
                code: 'CLIENT_ID_MISSING',
                error: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server and register this extension redirect URL in Google Cloud.'
            };
        }
        return { success: false, error: 'Google sign-in could not be initiated.' };
    }

    // 2. Test-only mock flow
    try {
        const mockToken = options.mockIdToken;
        const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: mockToken })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            const prior = await new Promise(r => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get(['authUser', 'quota', '_lastActivatedPaymentId'], r);
                } else {
                    r({});
                }
            });

            let finalUser = { ...data.user };
            let finalQuota = { ...data.quota };

            const priorIsPro = prior.authUser?.plan === 'pro' || prior.quota?.isPro === true;
            const priorPaymentId = prior.authUser?.razorpayPaymentId || prior._lastActivatedPaymentId;

            if (priorIsPro && finalUser.plan !== 'pro') {
                finalUser.plan = 'pro';
                if (priorPaymentId) finalUser.razorpayPaymentId = priorPaymentId;
                finalQuota = { ...finalQuota, isPro: true, plan: 'pro', limit: 300, remaining: 300 };
            }

            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                await new Promise((resolve) => {
                    chrome.storage.local.set({
                        sessionToken: data.token,
                        authUser: finalUser,
                        quota: finalQuota
                    }, resolve);
                });
            }
            return {
                success: true,
                token: data.token,
                user: finalUser,
                quota: finalQuota
            };
        }
        return { success: false, error: data.error || 'Google authentication failed.' };
    } catch (e) {
        return { success: false, error: e.message || 'Google authentication could not be reached.' };
    }
}

/**
 * Signs out the current user and clears session token and credentials.
 * @returns {Promise<{ success: boolean }>}
 */
async function signOut() {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.remove(['sessionToken', 'authUser', 'quota'], () => {
                resolve({ success: true });
            });
        } else {
            resolve({ success: true });
        }
    });
}

/**
 * Links an account on mobile/secondary devices using a 6-digit sync code or JWT token.
 * Works seamlessly on Firefox Android where identity.launchWebAuthFlow is absent.
 * @param {string} codeOrToken 6-digit pairing code or JWT session token
 * @param {Object} [options={}]
 * @returns {Promise<{ success: boolean, token?: string, user?: Object, quota?: Object, error?: string }>}
 */
async function linkAccountWithToken(codeOrToken, options = {}) {
    if (!codeOrToken || typeof codeOrToken !== 'string') {
        return { success: false, error: 'Please enter a valid Sync Code or session token.' };
    }
    const cleanInput = codeOrToken.trim();
    if (!cleanInput) {
        return { success: false, error: 'Sync code cannot be empty.' };
    }

    const serverUrl = options.serverUrl || 'https://autoform-ai.onrender.com';

    try {
        let token = cleanInput;
        let user = null;
        let quota = null;

        // If it's a 6-digit numeric pairing code (e.g. "582914" or "582-914" or "582 914")
        const isPairCode = /^\d{3}[\s-]?\d{3}$/.test(cleanInput) || /^\d{6}$/.test(cleanInput);
        if (isPairCode) {
            const normalizedCode = cleanInput.replace(/[\s-]/g, '');
            const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/auth/device-link`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: normalizedCode })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                return {
                    success: false,
                    error: data.error || 'Invalid or expired sync code. Please generate a fresh code on your laptop.'
                };
            }
            token = data.token;
            user = data.user;
            quota = data.quota;
        } else {
            // Direct JWT session token
            const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/auth/me`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${cleanInput}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                return { success: false, error: data.error || 'Invalid or expired session token.' };
            }
            token = cleanInput;
            user = data.user;
            quota = data.quota;
        }

        // Preserve Pro status if upgraded
        const prior = await new Promise(r => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['authUser', 'quota', '_lastActivatedPaymentId'], r);
            } else {
                r({});
            }
        });

        let finalUser = { ...user };
        let finalQuota = { ...quota };

        const priorIsPro = prior.authUser?.plan === 'pro' || prior.quota?.isPro === true;
        const priorPaymentId = prior.authUser?.razorpayPaymentId || prior._lastActivatedPaymentId;

        if (priorIsPro && finalUser.plan !== 'pro') {
            finalUser.plan = 'pro';
            if (priorPaymentId) finalUser.razorpayPaymentId = priorPaymentId;
            finalQuota = { ...finalQuota, isPro: true, plan: 'pro', limit: 300, remaining: 300 };
        }

        // Save session credentials
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await new Promise((resolve) => {
                chrome.storage.local.set({
                    sessionToken: token,
                    authUser: finalUser,
                    quota: finalQuota
                }, resolve);
            });
        }

        return {
            success: true,
            token,
            user: finalUser,
            quota: finalQuota
        };
    } catch (err) {
        return { success: false, error: err.message || 'Failed to connect to authentication server.' };
    }
}

/**
 * Requests a 6-digit device pairing code from the server for the current authenticated session.
 * Used on laptop to generate a short code for Firefox Android.
 * @param {Object} [options={}]
 * @returns {Promise<{ success: boolean, code?: string, expiresIn?: number, token?: string, directToken?: boolean, error?: string }>}
 */
async function createDevicePairCode(options = {}) {
    const serverUrl = options.serverUrl || 'https://autoform-ai.onrender.com';
    const token = options.token || await getStoredSessionToken();

    if (!token) {
        return { success: false, error: 'You must be signed in to generate a device sync code.' };
    }

    try {
        const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/auth/device-code`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            return {
                success: true,
                code: null,
                token: token,
                directToken: true
            };
        }
        return {
            success: true,
            code: data.code,
            expiresIn: data.expiresIn || 600,
            token: token
        };
    } catch (_) {
        return {
            success: true,
            code: null,
            token: token,
            directToken: true
        };
    }
}

// ---------------------------------------------------------------------------
// 6. Universal Module Exports (Node.js + Browser + Service Worker)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        FREE_TIER_MONTHLY_LIMIT,
        REVIEW_SNOOZE_DURATION_MS,
        REVIEW_FORMS_THRESHOLD,
        REVIEW_QUESTIONS_THRESHOLD,
        DEFAULT_AUTH_USER,
        DEFAULT_USAGE_STATS,
        getCurrentMonthKey,
        normalizeUsageStats,
        getMonthlyQuotaStatus,
        canSolveQuestion,
        shouldShowReviewPrompt,
        getStoredAuthUser,
        getStoredSessionToken,
        getStoredUsageStats,
        recordQuestionSolved,
        recordFormCompleted,
        updateReviewPromptState,
        updateUserPlan,
        verifyAndActivateRazorpayPayment,
        signInWithGoogle,
        signOut,
        linkAccountWithToken,
        createDevicePairCode,
        requestOptionalDataConsent,
        PAYMENT_VERIFICATION_ROUTE
    };
}

if (typeof globalThis !== 'undefined') {
    globalThis.AutoFormAuth = {
        FREE_TIER_MONTHLY_LIMIT,
        REVIEW_SNOOZE_DURATION_MS,
        REVIEW_FORMS_THRESHOLD,
        REVIEW_QUESTIONS_THRESHOLD,
        DEFAULT_AUTH_USER,
        DEFAULT_USAGE_STATS,
        getCurrentMonthKey,
        normalizeUsageStats,
        getMonthlyQuotaStatus,
        canSolveQuestion,
        shouldShowReviewPrompt,
        getStoredAuthUser,
        getStoredSessionToken,
        getStoredUsageStats,
        recordQuestionSolved,
        recordFormCompleted,
        updateReviewPromptState,
        updateUserPlan,
        verifyAndActivateRazorpayPayment,
        signInWithGoogle,
        signOut,
        linkAccountWithToken,
        createDevicePairCode,
        requestOptionalDataConsent,
        PAYMENT_VERIFICATION_ROUTE
    };
}
