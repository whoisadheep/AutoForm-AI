/**
 * @file src/content/content.js
 * @description AutoForm AI v2.0 Content Script.
 * High-performance DOM parser, question solver runner, modern overlay UI,
 * and multi-input automation engine for Google Forms.
 */

// ---------------------------------------------------------------------------
// Global State & Cancellation
// ---------------------------------------------------------------------------

let isSolving = false;
let cancelRequested = false;

/**
 * Cancels an ongoing form solving process.
 */
function cancelFormSolver() {
    if (!isSolving) return;
    cancelRequested = true;

    const statusText = document.getElementById('ai-status-text');
    if (statusText) statusText.innerText = 'Stopping...';

    const cancelBtn = document.getElementById('ai-cancel-btn');
    if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.innerText = 'Stopping...';
        cancelBtn.style.opacity = '0.6';
    }

    const floatBtn = document.getElementById('ai-floating-btn');
    if (floatBtn) floatBtn.textContent = 'Stopping...';
}

// ---------------------------------------------------------------------------
// Advanced DOM Selectors & Question Extraction
// ---------------------------------------------------------------------------

/**
 * Queries all question card containers on the page.
 * @returns {NodeListOf<HTMLElement>}
 */
function getQuestionBlocks() {
    const blocks = document.querySelectorAll('.Qr7Oae');
    if (blocks.length > 0) return blocks;
    return document.querySelectorAll('div[role="listitem"]');
}

/**
 * Extracts question title text.
 * @param {HTMLElement} block 
 * @returns {string|null}
 */
function getQuestionTitle(block) {
    const el = block.querySelector('.M7eMe') ||
               block.querySelector('[role="heading"] span') ||
               block.querySelector('div[role="heading"]');
    return el?.innerText?.trim() || null;
}

/**
 * Extracts option label text from an option element.
 * @param {HTMLElement} label 
 * @returns {string|null}
 */
function getOptionText(label) {
    // 1. data-value on ARIA widget
    const widget = label.querySelector('[role="radio"], [role="checkbox"]');
    if (widget) {
        const val = widget.getAttribute('data-value');
        if (val && val.trim()) return val.trim();
    }

    // 2. Semantic dir="auto" span
    const autoSpan = label.querySelector('span[dir="auto"]');
    if (autoSpan && autoSpan.innerText?.trim()) return autoSpan.innerText.trim();

    // 3. Single-class fallback spans
    const singleSpan = label.querySelector('span.aDTYNe') || label.querySelector('span.snByac');
    if (singleSpan && singleSpan.innerText?.trim()) return singleSpan.innerText.trim();

    // 4. Any span fallback
    const anySpan = label.querySelector('span');
    return anySpan ? anySpan.innerText?.trim() || null : null;
}

/**
 * Detects the question type from a question card block.
 * @param {HTMLElement} block 
 * @returns {'checkbox'|'multiple_choice'|'dropdown'|'scale'|'text_input'}
 */
function detectQuestionType(block) {
    if (block.querySelector('[role="checkbox"]')) return 'checkbox';
    if (block.querySelector('[role="listbox"]') || block.querySelector('.MocG8c')) return 'dropdown';
    if (block.querySelector('[role="radiogroup"]') && block.querySelectorAll('[role="radio"]').length > 5) return 'scale';
    if (block.querySelector('[role="radio"]') || block.querySelectorAll('label').length > 0) return 'multiple_choice';
    return 'text_input';
}

/**
 * Scrapes Google Forms DOM and extracts all questions with their inferred input format.
 * @returns {Array<{ id: number, question: string, type: string, choices: string[] }>}
 */
function getQuestions() {
    const blocks = getQuestionBlocks();
    const questions = [];

    blocks.forEach((block, index) => {
        const qText = getQuestionTitle(block);
        if (!qText) return;

        const type = detectQuestionType(block);
        const choices = [];

        if (type === 'multiple_choice' || type === 'checkbox') {
            const labels = [...block.querySelectorAll('label')];
            labels.forEach(label => {
                const txt = getOptionText(label);
                if (txt && !choices.includes(txt)) choices.push(txt);
            });

            // Standalone ARIA widgets
            if (choices.length === 0) {
                const widgets = [...block.querySelectorAll('[role="radio"], [role="checkbox"]')];
                widgets.forEach(w => {
                    const val = w.getAttribute('data-value');
                    if (val && val.trim() && !choices.includes(val.trim())) choices.push(val.trim());
                });
            }
        } else if (type === 'dropdown') {
            const dropdownOptions = [...block.querySelectorAll('[role="option"], .MocG8c')];
            dropdownOptions.forEach(opt => {
                const txt = opt.getAttribute('data-value') || opt.innerText?.trim();
                if (txt && !choices.includes(txt) && txt !== 'Choose') choices.push(txt);
            });
        }

        questions.push({
            id: index,
            question: qText,
            type: type,
            choices: choices
        });
    });

    return questions;
}

// ---------------------------------------------------------------------------
// Modern UI Overlay & Floating Actions
// ---------------------------------------------------------------------------

/**
 * Creates SVG elements programmatically without innerHTML.
 * @param {'spark'|'stop'|'check'|'error'|'warning'|'info'} type 
 * @returns {SVGElement}
 */
function createContentSvg(type) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    if (type === 'spark') {
        svg.setAttribute('width', '15');
        svg.setAttribute('height', '15');
        svg.setAttribute('stroke-width', '2.2');
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', '13 2 3 14 12 14 11 22 21 10 12 10 13 2');
        svg.appendChild(poly);
    } else if (type === 'stop') {
        svg.setAttribute('width', '13');
        svg.setAttribute('height', '13');
        svg.setAttribute('stroke-width', '2.2');
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '6');
        rect.setAttribute('y', '6');
        rect.setAttribute('width', '12');
        rect.setAttribute('height', '12');
        rect.setAttribute('rx', '2');
        svg.appendChild(rect);
    } else if (type === 'check') {
        svg.setAttribute('width', '15');
        svg.setAttribute('height', '15');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke', '#7241ff');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M22 11.08V12a10 10 0 1 1-5.93-9.14');
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly.setAttribute('points', '22 4 12 14.01 9 11.01');
        svg.appendChild(path);
        svg.appendChild(poly);
    } else if (type === 'error') {
        svg.setAttribute('width', '15');
        svg.setAttribute('height', '15');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke', '#e11d48');
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '10');
        const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l1.setAttribute('x1', '15'); l1.setAttribute('y1', '9'); l1.setAttribute('x2', '9'); l1.setAttribute('y2', '15');
        const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l2.setAttribute('x1', '9'); l2.setAttribute('y1', '9'); l2.setAttribute('x2', '15'); l2.setAttribute('y2', '15');
        svg.appendChild(circle);
        svg.appendChild(l1);
        svg.appendChild(l2);
    } else if (type === 'warning') {
        svg.setAttribute('width', '15');
        svg.setAttribute('height', '15');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke', '#d97706');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z');
        const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l1.setAttribute('x1', '12'); l1.setAttribute('y1', '9'); l1.setAttribute('x2', '12'); l1.setAttribute('y2', '13');
        const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l2.setAttribute('x1', '12'); l2.setAttribute('y1', '17'); l2.setAttribute('x2', '12.01'); l2.setAttribute('y2', '17');
        svg.appendChild(path);
        svg.appendChild(l1);
        svg.appendChild(l2);
    } else if (type === 'info') {
        svg.setAttribute('width', '15');
        svg.setAttribute('height', '15');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke', '#7241ff');
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '10');
        const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l1.setAttribute('x1', '12'); l1.setAttribute('y1', '16'); l1.setAttribute('x2', '12'); l1.setAttribute('y2', '12');
        const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l2.setAttribute('x1', '12'); l2.setAttribute('y1', '8'); l2.setAttribute('x2', '12.01'); l2.setAttribute('y2', '8');
        svg.appendChild(circle);
        svg.appendChild(l1);
        svg.appendChild(l2);
    }
    return svg;
}

/**
 * Creates and renders the modern progress modal overlay without innerHTML.
 * @param {number} totalQuestions
 * @returns {HTMLDivElement}
 */
function createLoadingOverlay(totalQuestions) {
    const existing = document.getElementById('ai-form-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ai-form-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(14, 14, 14, 0.4); z-index: 100000;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
        background: #ffffff;
        border: 1px solid #ebecef;
        border-radius: 14px;
        padding: 28px 30px;
        width: 90%;
        max-width: 380px;
        box-shadow: 0 20px 48px -10px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.05);
        text-align: center;
        position: relative;
        color: #0e0e0e;
    `;

    // Header Badge
    const badgeWrap = document.createElement('div');
    badgeWrap.style.cssText = 'display: inline-flex; align-items: center; padding: 3px 10px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 9999px; margin-bottom: 14px;';
    const badgeText = document.createElement('span');
    badgeText.id = 'ai-provider-badge';
    badgeText.style.cssText = 'font-size: 11px; font-weight: 600; color: #4b5563; text-transform: uppercase; letter-spacing: 0.5px;';
    badgeText.textContent = 'AutoForm AI Active';
    badgeWrap.appendChild(badgeText);
    card.appendChild(badgeWrap);

    // Title
    const title = document.createElement('h3');
    title.id = 'ai-status-text';
    title.style.cssText = 'margin: 0 0 6px; color: #0e0e0e; font-size: 16px; font-weight: 700; letter-spacing: -0.3px;';
    title.textContent = 'Solving Form Questions...';
    card.appendChild(title);

    // Subtitle
    const subtext = document.createElement('p');
    subtext.id = 'ai-status-subtext';
    subtext.style.cssText = 'color: #6b7280; font-size: 13px; margin: 0 0 20px; line-height: 1.5; min-height: 20px; word-break: break-word;';
    subtext.textContent = 'Initializing solver...';
    card.appendChild(subtext);

    // Progress counter row
    const counterRow = document.createElement('div');
    counterRow.style.cssText = 'margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;';
    const counter = document.createElement('span');
    counter.id = 'ai-progress-counter';
    counter.style.cssText = 'font-size: 12px; font-weight: 600; color: #4b5563;';
    counter.textContent = `Question 0 of ${totalQuestions}`;
    const percent = document.createElement('span');
    percent.id = 'ai-progress-percent';
    percent.style.cssText = 'font-size: 12px; font-weight: 700; color: #7241ff;';
    percent.textContent = '0%';
    counterRow.appendChild(counter);
    counterRow.appendChild(percent);
    card.appendChild(counterRow);

    // Progress Bar Track
    const track = document.createElement('div');
    track.style.cssText = 'background: #f3f4f6; border: 1px solid #e5e7eb; height: 8px; border-radius: 9999px; overflow: hidden; position: relative;';
    const bar = document.createElement('div');
    bar.id = 'ai-progress-bar';
    bar.style.cssText = 'background: #7241ff; height: 100%; width: 0%; border-radius: 9999px; transition: width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);';
    track.appendChild(bar);
    card.appendChild(track);

    // Cancel Button Container
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin-top: 20px; display: flex; justify-content: center;';
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'ai-cancel-btn';
    cancelBtn.style.cssText = `
        padding: 8px 16px;
        background: #ffffff;
        color: #4b5563;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: background-color 0.15s, color 0.15s, border-color 0.15s;
        font-family: inherit;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    `;
    const stopIcon = createContentSvg('stop');
    const stopLabel = document.createElement('span');
    stopLabel.textContent = 'Stop & Cancel';
    cancelBtn.appendChild(stopIcon);
    cancelBtn.appendChild(stopLabel);

    cancelBtn.onmouseover = () => {
        cancelBtn.style.background = '#e11d48';
        cancelBtn.style.borderColor = '#e11d48';
        cancelBtn.style.color = '#ffffff';
    };
    cancelBtn.onmouseout = () => {
        if (!cancelRequested) {
            cancelBtn.style.background = '#ffffff';
            cancelBtn.style.borderColor = '#e5e7eb';
            cancelBtn.style.color = '#4b5563';
        }
    };
    cancelBtn.onclick = (e) => {
        e.stopPropagation();
        cancelFormSolver();
    };

    btnRow.appendChild(cancelBtn);
    card.appendChild(btnRow);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return overlay;
}

/**
 * Displays a modern toast notification on the page without innerHTML.
 * @param {string} message 
 * @param {'success'|'error'|'warning'|'info'} [type='success']
 */
function showNotification(message, type = 'success') {
    const config = {
        success: { bg: '#ffffff', text: '#0e0e0e', border: '#e5e7eb', iconType: 'check' },
        error: { bg: '#ffffff', text: '#0e0e0e', border: '#fca5a5', iconType: 'error' },
        warning: { bg: '#ffffff', text: '#0e0e0e', border: '#fde68a', iconType: 'warning' },
        info: { bg: '#ffffff', text: '#0e0e0e', border: '#e5e7eb', iconType: 'info' }
    };

    const c = config[type] || config.success;

    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background-color: ${c.bg}; color: ${c.text};
        border: 1px solid ${c.border};
        box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
        padding: 9px 15px; border-radius: 8px; z-index: 100001;
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
        font-size: 13px; font-weight: 600;
        display: flex; align-items: center; gap: 8px;
    `;

    const iconEl = createContentSvg(c.iconType);
    const textEl = document.createElement('span');
    textEl.textContent = message;

    notif.appendChild(iconEl);
    notif.appendChild(textEl);

    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 4500);
}

// ---------------------------------------------------------------------------
// DOM Interaction & Automation Handlers
// ---------------------------------------------------------------------------

function scrollToBlock(index) {
    const blocks = getQuestionBlocks();
    if (blocks[index]) {
        blocks[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        blocks[index].style.transition = "box-shadow 0.3s, border-color 0.3s";
        blocks[index].style.boxShadow = "0 0 0 2px #0f172a";
        setTimeout(() => {
            blocks[index].style.boxShadow = "none";
        }, 1200);
    }
}

function isBlockFilled(block) {
    if (!block) return false;
    const textInputs = block.querySelectorAll('input[type="text"], textarea, input[type="email"], input[type="number"]');
    for (const input of textInputs) {
        if (input.value && input.value.trim().length > 0) return true;
    }
    const ariaChecked = block.querySelectorAll('[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"]');
    if (ariaChecked.length > 0) return true;
    return false;
}

function normalize(text) {
    if (!text) return '';
    return text.toLowerCase().replace(/\s+/g, '').replace(/[^\w]|_/g, '');
}

function findMatchingOption(block, answer) {
    if (!block) return null;
    const options = [...block.querySelectorAll('label')];
    const normalizedAnswer = normalize(answer);

    let target = options.find(label => normalize(getOptionText(label)) === normalizedAnswer);
    if (target) return target;

    target = options.find(label => {
        const opt = normalize(getOptionText(label));
        if (opt.length < 3 || normalizedAnswer.length < 3) return false;
        return opt.includes(normalizedAnswer) || normalizedAnswer.includes(opt);
    });
    if (target) return target;

    const widgets = [...block.querySelectorAll('[role="radio"], [role="checkbox"]')];
    const matchedWidget = widgets.find(w => {
        const val = normalize(w.getAttribute('data-value') || '');
        return val === normalizedAnswer || val.includes(normalizedAnswer) || normalizedAnswer.includes(val);
    });
    if (matchedWidget) {
        return matchedWidget.closest('label') || matchedWidget.parentElement || matchedWidget;
    }
    return null;
}

async function clickOption(label, maxRetries = 3) {
    if (!label) return false;
    let widget = label.querySelector('[role="radio"], [role="checkbox"]');
    let mode = 'aria';

    if (!widget) {
        widget = label.querySelector('input[type="checkbox"], input[type="radio"]');
        if (widget) mode = 'native';
    }

    const isChecked = () => {
        if (!widget) return false;
        if (mode === 'native') return widget.checked;
        return widget.getAttribute('aria-checked') === 'true';
    };

    if (isChecked()) return true;

    for (let i = 0; i < maxRetries; i++) {
        if (cancelRequested) return false;
        try {
            if (widget) {
                widget.click();
                await new Promise(r => setTimeout(r, 80));
                if (isChecked()) return true;
            }

            label.click();
            await new Promise(r => setTimeout(r, 80));
            if (isChecked()) return true;

            const target = widget || label;
            const opts = { bubbles: true, cancelable: true, view: window };
            target.dispatchEvent(new MouseEvent('mousedown', opts));
            target.dispatchEvent(new MouseEvent('mouseup', opts));
            target.dispatchEvent(new MouseEvent('click', opts));

            await new Promise(r => setTimeout(r, 120));
            if (isChecked()) return true;
        } catch (e) { }
    }
    return isChecked();
}

async function fillTextInput(block, answer) {
    if (!block) return false;
    const inputs = [
        block.querySelector('input[type="text"]'),
        block.querySelector('textarea'),
        block.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])')
    ];

    for (const input of inputs) {
        if (input) {
            input.focus();
            input.value = answer;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Main Solver Pipeline
// ---------------------------------------------------------------------------

function setFloatingButtonDOM(btn, isSolvingState, count) {
    btn.textContent = '';
    const icon = createContentSvg(isSolvingState ? 'stop' : 'spark');
    const label = document.createElement('span');
    label.textContent = isSolvingState ? 'Stop' : 'AutoForm';
    btn.appendChild(icon);
    btn.appendChild(label);

    if (!isSolvingState && count) {
        const badge = document.createElement('span');
        badge.style.cssText = 'padding: 1px 6px; background: rgba(255, 255, 255, 0.2); border-radius: 9999px; font-size: 11px; font-weight: 700; color: #ffffff; margin-left: 2px;';
        badge.textContent = String(count);
        btn.appendChild(badge);
    }
}

function updateFloatingButtonState(questionCount) {
    const btn = document.getElementById('ai-floating-btn');
    if (!btn) return;

    if (isSolving) {
        setFloatingButtonDOM(btn, true);
        btn.style.background = '#e11d48';
        btn.style.color = '#ffffff';
        btn.style.boxShadow = '0 4px 14px 0 rgba(225, 29, 72, 0.35)';
        btn.title = 'Stop form filling';
    } else {
        setFloatingButtonDOM(btn, false, questionCount);
        btn.style.background = '#7241ff';
        btn.style.color = '#ffffff';
        btn.style.boxShadow = '0 4px 14px rgba(114, 65, 255, 0.35)';
        btn.title = 'Fill form with AutoForm';
    }
}

async function responsiveSleep(ms) {
    const chunks = Math.ceil(ms / 100);
    for (let c = 0; c < chunks; c++) {
        if (cancelRequested) break;
        await new Promise(r => setTimeout(r, 100));
    }
}

async function processQuestionQueue(questions) {
    isSolving = true;
    cancelRequested = false;
    updateFloatingButtonState(questions.length);

    const overlay = createLoadingOverlay(questions.length);
    const statusText = document.getElementById('ai-status-text');
    const statusSubtext = document.getElementById('ai-status-subtext');
    const progressBar = document.getElementById('ai-progress-bar');
    const progressCounter = document.getElementById('ai-progress-counter');
    const progressPercent = document.getElementById('ai-progress-percent');
    const providerBadge = document.getElementById('ai-provider-badge');

    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    try {
        for (let i = 0; i < questions.length; i++) {
            if (cancelRequested) break;

            if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
                overlay.remove();
                alert("Extension updated. Please refresh this page.");
                throw new Error("Extension context invalidated");
            }

            const q = questions[i];
            const currentBlock = getQuestionBlocks()[q.id];

            // Update Progress UI
            const percent = Math.round((i / questions.length) * 100);
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressPercent) progressPercent.innerText = `${percent}%`;
            if (progressCounter) progressCounter.innerText = `Question ${i + 1} of ${questions.length}`;

            if (isBlockFilled(currentBlock)) {
                if (statusText) statusText.innerText = `Skipping Question ${i + 1}`;
                if (statusSubtext) statusSubtext.innerText = `Already answered`;
                skippedCount++;
                await responsiveSleep(150);
                continue;
            }

            if (statusText) statusText.innerText = `Solving Question ${i + 1}`;
            if (statusSubtext) statusSubtext.innerText = q.question ? `"${q.question.slice(0, 50)}${q.question.length > 50 ? '...' : ''}"` : 'Analyzing...';
            scrollToBlock(q.id);

            try {
                const solution = await new Promise((resolve, reject) => {
                    try {
                        chrome.runtime.sendMessage({
                            action: "SOLVE_SINGLE_QUESTION",
                            data: {
                                id: q.id,
                                question: q.question,
                                type: q.type,
                                choices: q.choices || []
                            }
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message || "Extension Disconnected"));
                            } else if (response?.success) {
                                resolve(response);
                            } else {
                                reject(new Error(response?.error || "AI failed to solve"));
                            }
                        });
                    } catch (e) {
                        reject(new Error(e.message || "Failed to communicate with extension"));
                    }
                });

                if (cancelRequested) break;

                // Update provider badge
                if (providerBadge && solution.provider) {
                    const latency = solution.latencyMs ? ` • ${solution.latencyMs}ms` : '';
                    providerBadge.innerText = `${solution.provider.toUpperCase()}${latency}`;
                }

                const block = getQuestionBlocks()[q.id];
                let filled = false;

                if (q.type === 'checkbox' && solution.answers && Array.isArray(solution.answers)) {
                    for (const ans of solution.answers) {
                        const target = findMatchingOption(block, ans);
                        if (target) await clickOption(target);
                    }
                    filled = true;
                } else if (q.type === 'multiple_choice' || q.type === 'checkbox' || q.type === 'scale') {
                    const target = findMatchingOption(block, solution.answer);
                    if (target) filled = await clickOption(target);
                } else {
                    filled = await fillTextInput(block, solution.answer);
                }

                if (filled) successCount++;
                else failureCount++;

                await responsiveSleep(800);

            } catch (err) {
                console.error(`Q${i + 1} Error:`, err.message);

                if (err.message.includes("Extension context invalidated") || err.message.includes("Extension Disconnected")) {
                    overlay.remove();
                    showNotification("Extension reloaded. Please refresh page.", "warning");
                    return;
                }

                showNotification(`Q${i + 1}: ${err.message}`, "error");
                failureCount++;
            }
        }

        // Final 100% update
        if (progressBar) progressBar.style.width = '100%';
        if (progressPercent) progressPercent.innerText = '100%';

    } finally {
        if (overlay) overlay.remove();
        const wasCancelled = cancelRequested;
        isSolving = false;
        cancelRequested = false;
        updateFloatingButtonState(questions.length);

        if (wasCancelled) {
            showNotification(`Stopped: ${successCount} filled before cancelling`, 'warning');
        } else {
            const message = `Done! ${successCount} filled, ${skippedCount} skipped${failureCount > 0 ? `, ${failureCount} failed` : ''}`;
            showNotification(message, successCount > 0 ? 'success' : 'info');
        }
    }
}

function runFormSolver() {
    if (isSolving) {
        cancelFormSolver();
        return;
    }

    const questions = getQuestions();
    if (questions.length === 0) {
        showNotification("No questions detected on this page", "error");
        return;
    }
    processQuestionQueue(questions);
}

// ---------------------------------------------------------------------------
// Event Listeners & Floating Widget Mount
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_SOLVING") {
        if (!isSolving) runFormSolver();
        sendResponse({ success: true, isSolving: true });
    } else if (request.action === "STOP_SOLVING") {
        cancelFormSolver();
        sendResponse({ success: true, isSolving: false });
    } else if (request.action === "GET_SOLVER_STATUS") {
        const questions = getQuestions();
        sendResponse({ 
            isSolving: isSolving,
            questionCount: questions.length
        });
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isSolving) cancelFormSolver();
});

function createFloatingButton() {
    if (document.getElementById('ai-floating-btn')) return;
    const questions = getQuestions();

    const btn = document.createElement('button');
    btn.id = 'ai-floating-btn';
    setFloatingButtonDOM(btn, false, questions.length);
    btn.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 99999;
        background-color: #7241ff;
        color: #ffffff; border: none; padding: 10px 16px;
        border-radius: 9999px; cursor: pointer; font-weight: 600; font-size: 13px;
        box-shadow: 0 4px 14px rgba(114, 65, 255, 0.35);
        transition: transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.15s;
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
        display: flex; align-items: center; gap: 7px;
        user-select: none;
    `;

    btn.onmouseover = () => {
        if (!isSolving) {
            btn.style.background = '#612df0';
            btn.style.transform = 'translateY(-1px)';
        }
    };
    btn.onmouseout = () => {
        if (!isSolving) {
            btn.style.background = '#7241ff';
            btn.style.transform = 'translateY(0)';
        }
    };
    btn.onmousedown = () => {
        btn.style.transform = 'translateY(1px)';
        btn.style.background = '#501ee0';
    };
    btn.onmouseup = () => {
        btn.style.transform = 'translateY(0)';
    };
    btn.onclick = () => {
        if (isSolving) cancelFormSolver();
        else runFormSolver();
    };

    document.body.appendChild(btn);
}

setTimeout(() => {
    if (getQuestionBlocks().length > 0) createFloatingButton();
}, 1500);
