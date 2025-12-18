document.addEventListener('DOMContentLoaded', () => {
    // Check if onboarding is complete
    chrome.storage.local.get(['onboardingComplete'], (result) => {
        if (!result.onboardingComplete) {
            // Redirect to onboarding
            window.location.href = 'onboarding.html';
            return;
        }
        
        // Continue with normal popup flow
        loadSavedAPIKey();
        checkCurrentTab();
    });
});

function loadSavedAPIKey() {
    chrome.storage.local.get(['geminiApiKey', 'geminiApiKeys'], (result) => {
        const apiKeyInput = document.getElementById('apiKey');
        const statusDiv = document.getElementById('keyStatus');
        
        let keys = [];
        if (result.geminiApiKeys && Array.isArray(result.geminiApiKeys)) {
            keys = result.geminiApiKeys;
        } else if (result.geminiApiKey) {
            keys = [result.geminiApiKey];
        }

        if (keys.length > 0) {
            apiKeyInput.value = keys.join(', ');
            statusDiv.innerHTML = `<span style="color:#166534">${keys.length} key${keys.length > 1 ? 's' : ''} configured</span>`;
        } else {
            statusDiv.innerHTML = `<span style="color:#92400e">No keys configured</span>`;
        }
    });
}

document.getElementById('togglePassword').addEventListener('click', () => {
    const input = document.getElementById('apiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
});

function cleanKeys(inputString) {
    return inputString.split(',')
        .map(k => k.trim())
        .map(k => k.replace(/['"]/g, ''))
        .filter(k => k.length > 10); 
}

document.getElementById('saveKey').addEventListener('click', () => {
    const rawInput = document.getElementById('apiKey').value;
    const saveBtn = document.getElementById('saveKey');
    const saveSpinner = document.getElementById('saveSpinner');
    const saveText = document.getElementById('saveKeyText');
    
    const keys = cleanKeys(rawInput);
    
    if (keys.length === 0) {
        showStatus('Invalid format. Paste keys separated by commas.', 'error');
        return;
    }

    saveBtn.disabled = true;
    saveText.style.display = 'none';
    saveSpinner.style.display = 'block';
    
    chrome.storage.local.set({ geminiApiKeys: keys }, () => {
        chrome.storage.local.remove('geminiApiKey');
        setTimeout(() => {
            saveBtn.disabled = false;
            saveText.style.display = 'block';
            saveSpinner.style.display = 'none';
            loadSavedAPIKey();
            document.getElementById('apiKey').value = keys.join(', ');
            showStatus(`Saved ${keys.length} key${keys.length > 1 ? 's' : ''}`, 'success');
        }, 500);
    });
});

document.getElementById('testKey').addEventListener('click', async () => {
    const rawInput = document.getElementById('apiKey').value;
    const testBtn = document.getElementById('testKey');
    
    const keys = cleanKeys(rawInput);
    
    if (keys.length === 0) {
        showStatus('Enter keys to test', 'error');
        return;
    }

    testBtn.disabled = true;
    testBtn.innerText = 'Testing...';
    showStatus(`Testing ${keys.length} key${keys.length > 1 ? 's' : ''}...`, 'info');

    let working = 0;
    let failed = 0;
    let errorMsg = "";

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] })
            });

            if (response.ok) {
                working++;
            } else {
                failed++;
                const errData = await response.json().catch(() => ({}));
                console.error(`Key ${i+1} Failed:`, response.status, errData);
                
                if (response.status === 400) errorMsg = "Bad Request";
                else if (response.status === 403) errorMsg = "Permission Denied";
                else if (response.status === 429) errorMsg = "Quota Exceeded";
                else errorMsg = `Error ${response.status}`;
            }
        } catch (e) {
            failed++;
            console.error(e);
            errorMsg = "Network Error";
        }
    }

    testBtn.disabled = false;
    testBtn.innerText = 'Test';

    if (failed === 0) {
        showStatus(`All ${working} key${working > 1 ? 's' : ''} working`, 'success');
    } else if (working === 0) {
        showStatus(`Failed: ${errorMsg}`, 'error');
    } else {
        showStatus(`${working} working, ${failed} failed`, 'error');
    }
});

function checkCurrentTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const solveBtn = document.getElementById('solveBtn');
        if (tabs[0]?.url?.includes('docs.google.com/forms')) {
            solveBtn.disabled = false;
        } else {
            solveBtn.disabled = true;
        }
    });
}

document.getElementById('solveBtn').addEventListener('click', () => {
    chrome.storage.local.get(['geminiApiKeys', 'geminiApiKey'], (result) => {
        const hasKeys = (result.geminiApiKeys && result.geminiApiKeys.length) || result.geminiApiKey;
        
        if (!hasKeys) {
            showStatus('Please configure API keys first', 'error');
            return;
        }

        const solveBtn = document.getElementById('solveBtn');
        const solveText = document.getElementById('solveBtnText');
        const solveSpinner = document.getElementById('solveSpinner');

        solveBtn.disabled = true;
        solveText.style.display = 'none';
        solveSpinner.style.display = 'block';

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                files: ['content.js']
            }).then(() => {
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "START_SOLVING" }, (response) => {
                        solveBtn.disabled = false;
                        solveText.style.display = 'block';
                        solveSpinner.style.display = 'none';

                        if (chrome.runtime.lastError) {
                            showStatus('Error: Refresh page', 'error');
                        } else {
                            showStatus('AI is working...', 'success');
                            setTimeout(() => window.close(), 1500);
                        }
                    });
                }, 500);
            }).catch(() => {
                solveBtn.disabled = false;
                solveText.style.display = 'block';
                solveSpinner.style.display = 'none';
                showStatus('Cannot inject script', 'error');
            });
        });
    });
});

function showStatus(msg, type) {
    const el = document.getElementById('status');
    el.innerHTML = msg;
    el.className = `status ${type}`;
    el.style.display = 'block';
    
    const time = type === 'error' ? 5000 : 3000;
    setTimeout(() => { el.style.display = 'none'; }, time);
}

document.querySelectorAll('a[target="_blank"]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: link.href });
    });
});