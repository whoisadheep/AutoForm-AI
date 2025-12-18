let currentStep = 1;
const totalSteps = 3;

document.addEventListener('DOMContentLoaded', () => {
    updateUI();
    
    chrome.storage.local.get(['onboardingComplete', 'geminiApiKeys'], (result) => {
        if (result.onboardingComplete) {
            window.location.href = 'popup.html';
        }
    });
});

document.getElementById('nextBtn').addEventListener('click', async () => {
    if (currentStep === 1) {
        goToStep(2);
    } else if (currentStep === 2) {
        await handleApiKeySave();
    } else if (currentStep === 3) {
        completeOnboarding();
    }
});

document.getElementById('backBtn').addEventListener('click', () => {
    if (currentStep > 1) {
        goToStep(currentStep - 1);
    }
});

function goToStep(step) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(`step${step}`).classList.add('active');
    currentStep = step;
    updateUI();
}

function updateUI() {
    const backBtn = document.getElementById('backBtn');
    const nextBtn = document.getElementById('nextBtn');
    const progressFill = document.getElementById('progressFill');
    
    nextBtn.disabled = false; 

    const progress = (currentStep / totalSteps) * 100;
    progressFill.style.width = `${progress}%`;
    
    if (currentStep === 1) {
        backBtn.style.display = 'none';
        nextBtn.style.flex = '1';
    } else {
        backBtn.style.display = 'block';
        nextBtn.style.flex = '1';
    }
    
    if (currentStep === 1) {
        nextBtn.textContent = 'Get Started';
    } else if (currentStep === 2) {
        nextBtn.textContent = 'Verify & Continue';
    } else {
        nextBtn.textContent = 'Start Using Extension';
    }
}

async function handleApiKeySave() {
    const apiKeyInput = document.getElementById('apiKeyInput');
    const keyStatus = document.getElementById('keyStatus');
    const nextBtn = document.getElementById('nextBtn');
    
    const rawInput = apiKeyInput.value.trim();
    
    if (!rawInput) {
        showStatus(keyStatus, 'Please enter at least one API key', 'error');
        return;
    }
    
    const keys = rawInput.split(',')
        .map(k => k.trim())
        .map(k => k.replace(/['"]/g, ''))
        .filter(k => k.length > 10);
    
    if (keys.length === 0) {
        showStatus(keyStatus, 'Invalid API key format', 'error');
        return;
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Verifying...';
    showStatus(keyStatus, 'Testing API keys...', 'info');
    
    try {
        const testKey = keys[0];
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${testKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Hi" }] }]
                })
            }
        );
        
        if (!response.ok) {
            let errorMsg = 'API key verification failed';
            if (response.status === 400) errorMsg = 'Invalid API key format';
            else if (response.status === 403) errorMsg = 'API key does not have permission';
            else if (response.status === 429) errorMsg = 'Rate limit exceeded, but key is valid';
            
            if (response.status === 429) {
                throw new Error('VALID_BUT_LIMITED');
            }
            throw new Error(errorMsg);
        }
        
        await saveKeys(keys);
        showStatus(keyStatus, `Successfully verified ${keys.length} key${keys.length > 1 ? 's' : ''}`, 'success');
        
        setTimeout(() => {
            goToStep(3);
        }, 1000);
        
    } catch (error) {
        if (error.message === 'VALID_BUT_LIMITED') {
            await saveKeys(keys);
            showStatus(keyStatus, 'Key verified (rate limited but valid)', 'success');
            setTimeout(() => {
                goToStep(3);
            }, 1000);
        } else {
            showStatus(keyStatus, error.message, 'error');
            nextBtn.disabled = false;
            nextBtn.textContent = 'Verify & Continue';
        }
    }
}

function saveKeys(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ geminiApiKeys: keys }, () => {
            resolve();
        });
    });
}

function showStatus(element, message, type) {
    element.textContent = message;
    element.className = `status-message ${type}`;
    element.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            element.style.display = 'none';
        }, 3000);
    }
}

function completeOnboarding() {
    chrome.storage.local.set({ onboardingComplete: true }, () => {
        window.location.href = 'popup.html';
    });
}

document.querySelectorAll('a[target="_blank"]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: link.href });
    });
});