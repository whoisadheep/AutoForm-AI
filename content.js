function createLoadingOverlay() {
    const existing = document.getElementById('ai-form-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ai-form-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.6); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        backdrop-filter: blur(2px);
    `;
    
    overlay.innerHTML = `
        <div style="background: white; padding: 32px; border-radius: 8px; text-align: center; max-width: 380px; border: 1px solid #e8e8e8;">
            <h3 id="ai-status-text" style="margin: 0 0 8px; color: #1a1a1a; font-size: 16px; font-weight: 600;">Processing Form</h3>
            <p style="color: #6b7280; font-size: 13px; margin: 0;">AI is filling out the form</p>
            <div id="progress-bar" style="margin-top: 20px; background: #f3f4f6; height: 3px; border-radius: 2px; overflow: hidden;">
                <div style="background: #1a1a1a; height: 100%; width: 0%; animation: progress 2s ease-in-out infinite;"></div>
            </div>
            <style>
                @keyframes progress {
                    0% { width: 0%; }
                    50% { width: 70%; }
                    100% { width: 100%; }
                }
            </style>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function showNotification(message, type = 'success') {
    const colors = {
        success: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
        error: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
        warning: { bg: '#fffbeb', text: '#92400e', border: '#fde68a' }
    };
    
    const color = colors[type] || colors.success;
    
    const notif = document.createElement('div');
    notif.textContent = message;
    notif.style.cssText = `
        position: fixed; top: 20px; right: 20px; 
        background: ${color.bg}; 
        color: ${color.text};
        border: 1px solid ${color.border};
        padding: 12px 16px; border-radius: 6px; z-index: 10001; 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        font-size: 13px;
        font-weight: 500;
        animation: slideIn 0.3s ease-out;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 5000);
}

function getQuestions() {
    const blocks = document.querySelectorAll('.Qr7Oae');
    const questions = [];

    blocks.forEach((block, index) => {
        const qText = block.querySelector('.M7eMe')?.innerText?.trim();
        if (!qText) return;

        const optionsList = [...block.querySelectorAll('label')];
        const choices = optionsList.map(label => {
            let span = label.querySelector("span.aDTYNe.snByac.kTYmRb.OIC90c");
            if (!span) span = label.querySelector("span[role='radio']");
            if (!span) span = label.querySelector("span[role='checkbox']");
            if (!span) span = label.querySelector("span");
            return span ? span.innerText?.trim() : null;
        }).filter(c => c !== null && c !== "");

        const type = optionsList.length > 0 ? "multiple_choice" : "text_input";

        questions.push({
            id: index,
            question: qText,
            type: type,
            choices: choices,
            block: block
        });
    });
    
    return questions;
}

function scrollToBlock(index) {
    const blocks = document.querySelectorAll('.Qr7Oae');
    if (blocks[index]) {
        blocks[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        blocks[index].style.transition = "box-shadow 0.3s, border-color 0.3s";
        blocks[index].style.boxShadow = "0 0 0 2px #1a1a1a";
        setTimeout(() => {
            blocks[index].style.boxShadow = "none";
        }, 1500);
    }
}

function isBlockFilled(block) {
    const textInputs = block.querySelectorAll('input[type="text"], textarea, input[type="email"], input[type="number"]');
    for (const input of textInputs) {
        if (input.value && input.value.trim().length > 0) return true;
    }
    const checkedInputs = block.querySelectorAll('input:checked');
    if (checkedInputs.length > 0) return true;
    const ariaChecked = block.querySelectorAll('[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"]');
    if (ariaChecked.length > 0) return true;
    
    return false;
}

function findMatchingOption(block, answer) {
    const options = [...block.querySelectorAll('label')];
    
    const normalize = (text) => {
        if (!text) return '';
        return text.toLowerCase().replace(/\s+/g, '').replace(/[^\w]|_/g, '');
    };
    
    const normalizedAnswer = normalize(answer);
    
    const getLabelText = (label) => {
        const span = label.querySelector("span.aDTYNe.snByac.kTYmRb.OIC90c") || 
                     label.querySelector("span[role='radio']") ||
                     label.querySelector("span[role='checkbox']") ||
                     label.querySelector("span") || label; 
        return span.innerText || "";
    };

    let target = options.find(label => normalize(getLabelText(label)) === normalizedAnswer);
    if (target) return target;
    
    target = options.find(label => {
        const opt = normalize(getLabelText(label));
        if (opt.length < 3 || normalizedAnswer.length < 3) return false;
        return opt.includes(normalizedAnswer) || normalizedAnswer.includes(opt);
    });
    
    return target || null;
}

async function clickOption(label, maxRetries = 3) {
    let input = label.querySelector('input[type="checkbox"], input[type="radio"]');
    let mode = 'standard';

    if (!input) {
        input = label.querySelector('[role="radio"], [role="checkbox"]');
        if (input) mode = 'aria';
    }

    const isChecked = () => {
        if (!input) return false; 
        if (mode === 'standard') return input.checked;
        return input.getAttribute('aria-checked') === 'true';
    };

    if (isChecked()) return true;

    for (let i = 0; i < maxRetries; i++) {
        try {
            if (input) {
                input.click();
                await new Promise(r => setTimeout(r, 100));
                if (isChecked()) return true;
            }

            label.click();
            await new Promise(r => setTimeout(r, 100));
            if (isChecked()) return true;

            const target = input || label; 
            const opts = { bubbles: true, cancelable: true, view: window };
            target.dispatchEvent(new MouseEvent('mousedown', opts));
            target.dispatchEvent(new MouseEvent('mouseup', opts));
            target.dispatchEvent(new MouseEvent('click', opts));
            
            await new Promise(r => setTimeout(r, 150));
            if (isChecked()) return true;
        } catch (e) { }
    }
    
    if (!input) return true; 
    return false;
}

async function fillTextInput(block, answer) {
    const inputs = [
        block.querySelector('input[type="text"]'),
        block.querySelector('textarea'),
        block.querySelector('input:not([type="checkbox"]):not([type="radio"])')
    ];
    
    for (const input of inputs) {
        if (input) {
            input.focus();
            input.value = answer;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
            return true;
        }
    }
    return false;
}

async function processQuestionQueue(questions) {
    const overlay = createLoadingOverlay();
    const statusText = document.getElementById('ai-status-text');
    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < questions.length; i++) {
        if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
            if (overlay) overlay.remove();
            alert("Extension updated. Please refresh this page.");
            throw new Error("Extension context invalidated");
        }

        const q = questions[i];
        const currentBlock = document.querySelectorAll('.Qr7Oae')[q.id];
        
        if (isBlockFilled(currentBlock)) {
            console.log(`Skipping Q${i+1}`);
            statusText.innerText = `Skipping Question ${i + 1} (Already filled)`;
            skippedCount++;
            await new Promise(r => setTimeout(r, 200)); 
            continue; 
        }

        statusText.innerText = `Processing ${i + 1} of ${questions.length}`;
        scrollToBlock(q.id);
        
        try {
            const answer = await new Promise((resolve, reject) => {
                try {
                    chrome.runtime.sendMessage({ 
                        action: "SOLVE_SINGLE_QUESTION", 
                        data: q 
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error("Extension Disconnected"));
                        } else if (response?.success) {
                            resolve(response.answer);
                        } else {
                            reject(new Error(response?.error || "Unknown error"));
                        }
                    });
                } catch (e) {
                    reject(new Error("Extension Context Lost"));
                }
            });

            const block = document.querySelectorAll('.Qr7Oae')[q.id];
            let filled = false;

            if (q.type === 'multiple_choice') {
                const target = findMatchingOption(block, answer);
                if (target) filled = await clickOption(target);
            } else {
                filled = await fillTextInput(block, answer);
            }

            if (filled) successCount++;
            else failureCount++;

            await new Promise(r => setTimeout(r, 2000)); 

        } catch (err) {
            console.error(`Q${i+1} Error:`, err.message);
            
            if (err.message.includes("Extension") || err.message.includes("Context")) {
                overlay.remove();
                showNotification("Extension reloaded. Please refresh page.", "warning");
                return;
            }
            failureCount++;
        }
    }

    overlay.remove();
    let message = `Completed: ${successCount} filled, ${skippedCount} skipped`;
    showNotification(message, 'success');
}

function runFormSolver() {
    console.log("Starting AI Solver...");
    const questions = getQuestions();
    
    if (questions.length === 0) {
        showNotification("No questions found on this page", "error");
        return;
    }
    processQuestionQueue(questions);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_SOLVING") {
        runFormSolver();
        sendResponse({ success: true });
    }
});

function createFloatingButton() {
    if (document.getElementById('ai-floating-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ai-floating-btn';
    btn.innerHTML = 'AI Fill';
    btn.style.cssText = `
        position: fixed; bottom: 30px; right: 30px; z-index: 9999;
        background: #1a1a1a; color: white; border: none; padding: 12px 20px;
        border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 13px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        transition: all 0.2s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    btn.onmouseover = () => {
        btn.style.background = "#2d2d2d";
        btn.style.transform = "translateY(-2px)";
        btn.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
    };
    btn.onmouseout = () => {
        btn.style.background = "#1a1a1a";
        btn.style.transform = "translateY(0)";
        btn.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.15)";
    };
    btn.onclick = runFormSolver;
    document.body.appendChild(btn);
}

setTimeout(() => {
    if (document.querySelector('.Qr7Oae')) createFloatingButton();
}, 2000);