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
let solverProgress = { percent: 0, currentQuestion: 0, totalQuestions: 0 };

/**
 * Cancels an ongoing form solving process.
 */
function cancelFormSolver() {
    if (!isSolving) return;
    cancelRequested = true;
    stopKeepAlive();

    const statusText = document.getElementById('ai-status-text');
    if (statusText) statusText.innerText = 'Stopping...';

    const statusSubtext = document.getElementById('ai-status-subtext');
    if (statusSubtext) statusSubtext.innerText = 'Cancelling solver...';

    const cancelBtn = document.getElementById('ai-cancel-btn');
    if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.innerText = 'Stopping...';
        cancelBtn.style.opacity = '0.6';
    }

    const floatBtn = document.getElementById('ai-floating-btn');
    if (floatBtn) floatBtn.textContent = 'Stopping...';

    if (typeof addThought === 'function') {
        addThought('⏹', 'Solver stopped by user', 'error');
    }
    if (typeof removeGhostChip === 'function') {
        removeGhostChip();
    }
}

// ---------------------------------------------------------------------------
// Advanced DOM Selectors & Question Extraction
// ---------------------------------------------------------------------------

/**
 * Resolves active FormEngine adapter or returns null.
 * @returns {Object|null}
 */
function getActiveFormAdapter() {
    if (typeof globalThis !== 'undefined' && globalThis.AutoFormEngine) {
        return globalThis.AutoFormEngine.getActiveAdapter(document, window.location.href);
    }
    return null;
}

/**
 * Scrapes form title from active adapter or Google Forms header.
 * @returns {string}
 */
function getFormTitle() {
    const adapter = getActiveFormAdapter();
    if (adapter && typeof adapter.getFormTitle === 'function') {
        return adapter.getFormTitle(document);
    }
    const titleEl = document.querySelector('div[role="heading"][aria-level="1"]') ||
                    document.querySelector('.F9vQ8a, .ahS6Le, .v1CNqd') ||
                    document.querySelector('div[role="heading"]');
    if (titleEl && titleEl.innerText && titleEl.innerText.trim()) {
        return titleEl.innerText.trim();
    }
    if (document.title) {
        return document.title.replace(/\s*-\s*Google Forms$/i, '').trim();
    }
    return 'Web Form';
}

/**
 * Scrapes form description / instructions from active adapter or Google Forms header.
 * @returns {string}
 */
function getFormDescription() {
    const adapter = getActiveFormAdapter();
    if (adapter && typeof adapter.getFormDescription === 'function') {
        return adapter.getFormDescription(document);
    }
    const descEl = document.querySelector('.cBDR0b, .freebirdFormviewerViewHeaderDescription, .D2CF4, .zAV2Fd') ||
                   document.querySelector('div[role="heading"][aria-level="1"] + div');
    return descEl?.innerText?.trim() || '';
}

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
    const adapter = getActiveFormAdapter();
    if (adapter && typeof adapter.getQuestions === 'function') {
        const detected = adapter.getQuestions(document);
        if (detected && detected.length > 0) return detected;
        if (adapter.name !== 'Google Forms') {
            return [];
        }
    }

    // Only query Google Forms question blocks if on Google Forms domain or if Google Form card markers exist
    const isGoogleForm = window.location.href.includes('docs.google.com/forms') ||
        !!(document.querySelector('.freebirdFormviewerViewFormCard, .Qr7Oae'));
    if (!isGoogleForm) return [];

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
    } else if (type === 'minimize') {
        svg.setAttribute('width', '13');
        svg.setAttribute('height', '13');
        svg.setAttribute('stroke-width', '2.5');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '5'); line.setAttribute('y1', '12'); line.setAttribute('x2', '19'); line.setAttribute('y2', '12');
        svg.appendChild(line);
    } else if (type === 'expand') {
        svg.setAttribute('width', '13');
        svg.setAttribute('height', '13');
        svg.setAttribute('stroke-width', '2.5');
        const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        p1.setAttribute('points', '15 3 21 3 21 9');
        const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l1.setAttribute('x1', '21'); l1.setAttribute('y1', '3'); l1.setAttribute('x2', '14'); l1.setAttribute('y2', '10');
        const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        p2.setAttribute('points', '9 21 3 21 3 15');
        const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l2.setAttribute('x1', '3'); l2.setAttribute('y1', '21'); l2.setAttribute('x2', '10'); l2.setAttribute('y2', '14');
        svg.appendChild(p1);
        svg.appendChild(l1);
        svg.appendChild(p2);
        svg.appendChild(l2);
    }
    return svg;
}

/**
 * Injects isolated, GPU-accelerated micro-animations into document head.
 */
function injectAutoFormStyles() {
    if (document.getElementById('autoform-motion-styles')) return;

    const style = document.createElement('style');
    style.id = 'autoform-motion-styles';
    style.textContent = `
        @keyframes autoform-fab-pulse {
            0% {
                box-shadow: 0 4px 14px rgba(114, 65, 255, 0.35), 0 0 0 0 rgba(114, 65, 255, 0.45);
            }
            70% {
                box-shadow: 0 6px 20px rgba(114, 65, 255, 0.4), 0 0 0 10px rgba(114, 65, 255, 0);
            }
            100% {
                box-shadow: 0 4px 14px rgba(114, 65, 255, 0.35), 0 0 0 0 rgba(114, 65, 255, 0);
            }
        }

        @keyframes autoform-shimmer-sweep {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
        }

        @keyframes autoform-progress-stripes {
            0% { background-position: 0 0, 0 0; }
            100% { background-position: 36px 0, -200% 0; }
        }

        @keyframes autoform-progress-glow-pulse {
            0% {
                opacity: 0.75;
                box-shadow: 0 0 10px rgba(114, 65, 255, 0.7), 0 0 4px #ffffff;
            }
            50% {
                opacity: 1;
                box-shadow: 0 0 20px rgba(167, 139, 250, 1), 0 0 8px #ffffff;
            }
            100% {
                opacity: 0.75;
                box-shadow: 0 0 10px rgba(114, 65, 255, 0.7), 0 0 4px #ffffff;
            }
        }

        @keyframes autoform-percent-pop {
            0% { transform: scale(1); }
            40% { transform: scale(1.25); color: #8b5cf6; text-shadow: 0 0 8px rgba(139, 92, 246, 0.4); }
            100% { transform: scale(1); color: #7241ff; }
        }

        @keyframes autoform-spring-scale-in {
            0% {
                opacity: 0;
                transform: scale(0.92) translateY(14px);
            }
            100% {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }

        @keyframes autoform-toast-spring-in {
            0% {
                opacity: 0;
                transform: translateY(-20px) scale(0.94);
            }
            100% {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }

        @keyframes autoform-card-spotlight {
            0% {
                box-shadow: 0 0 0 0 rgba(114, 65, 255, 0.5);
            }
            50% {
                box-shadow: 0 0 0 4px rgba(114, 65, 255, 0.35), 0 8px 24px -4px rgba(114, 65, 255, 0.15);
            }
            100% {
                box-shadow: 0 0 0 0 rgba(114, 65, 255, 0);
            }
        }

        .autoform-fab-idle {
            animation: autoform-fab-pulse 2.8s infinite cubic-bezier(0.4, 0, 0.6, 1);
        }

        .autoform-fab-dragging {
            transform: scale(1.06) !important;
            box-shadow: 0 14px 32px rgba(114, 65, 255, 0.45) !important;
            cursor: grabbing !important;
            transition: none !important;
        }

        .autoform-progress-track {
            background: #f1f2f6;
            border: 1px solid rgba(0, 0, 0, 0.08);
            height: 12px;
            border-radius: 9999px;
            overflow: hidden;
            position: relative;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
            margin-bottom: 4px;
        }

        .autoform-shimmer-bar {
            position: relative;
            height: 100%;
            width: 0%;
            border-radius: 9999px;
            background-image:
                linear-gradient(
                    -45deg,
                    rgba(255, 255, 255, 0.25) 25%,
                    transparent 25%,
                    transparent 50%,
                    rgba(255, 255, 255, 0.25) 50%,
                    rgba(255, 255, 255, 0.25) 75%,
                    transparent 75%,
                    transparent
                ),
                linear-gradient(90deg, #6366f1 0%, #7241ff 35%, #a855f7 65%, #6366f1 100%) !important;
            background-size: 28px 28px, 200% 100% !important;
            animation: autoform-progress-stripes 1.2s linear infinite, autoform-shimmer-sweep 2.2s linear infinite !important;
            box-shadow: 0 2px 10px rgba(114, 65, 255, 0.45), inset 0 1px 1px rgba(255, 255, 255, 0.4);
            transition: width 0.55s cubic-bezier(0.34, 1.25, 0.64, 1) !important;
        }

        .autoform-shimmer-bar::after {
            content: '';
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: 14px;
            background: radial-gradient(circle, rgba(255, 255, 255, 0.95) 20%, rgba(255, 255, 255, 0.6) 50%, transparent 80%);
            border-radius: 9999px;
            box-shadow: 0 0 14px #a855f7, 0 0 6px #ffffff;
            animation: autoform-progress-glow-pulse 1.2s infinite ease-in-out;
            pointer-events: none;
        }

        .autoform-percent-pop {
            animation: autoform-percent-pop 0.35s cubic-bezier(0.34, 1.4, 0.64, 1) forwards;
        }

        .autoform-progress-complete {
            background-image:
                linear-gradient(
                    -45deg,
                    rgba(255, 255, 255, 0.22) 25%,
                    transparent 25%,
                    transparent 50%,
                    rgba(255, 255, 255, 0.22) 50%,
                    rgba(255, 255, 255, 0.22) 75%,
                    transparent 75%,
                    transparent
                ),
                linear-gradient(90deg, #10b981 0%, #059669 50%, #10b981 100%) !important;
            box-shadow: 0 2px 14px rgba(16, 185, 129, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.4) !important;
        }

        .autoform-progress-complete::after {
            box-shadow: 0 0 14px #10b981, 0 0 6px #ffffff !important;
        }

        .autoform-spotlight-active {
            animation: autoform-card-spotlight 1.6s ease-in-out !important;
            border-color: #7241ff !important;
        }

        /* Floating Thought Stream HUD Container */
        .autoform-hud-container {
            position: fixed !important;
            bottom: 24px !important;
            right: 24px !important;
            z-index: 100000 !important;
            width: 360px !important;
            max-width: calc(100vw - 32px) !important;
            pointer-events: none !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif !important;
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease !important;
        }

        .autoform-hud-card {
            pointer-events: auto !important;
            background: rgba(15, 17, 23, 0.94) !important;
            backdrop-filter: blur(20px) !important;
            -webkit-backdrop-filter: blur(20px) !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            border-radius: 14px !important;
            box-shadow: 0 20px 48px -10px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.25) !important;
            color: #f3f4f6 !important;
            padding: 12px 14px 14px !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
            animation: autoform-spring-scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }

        /* Micro Accent Progress Track */
        .autoform-hud-progress-track {
            position: relative !important;
            height: 3px !important;
            background: rgba(255, 255, 255, 0.08) !important;
            border-radius: 9999px !important;
            overflow: hidden !important;
            margin-bottom: 10px !important;
        }

        .autoform-hud-progress-bar {
            position: relative !important;
            height: 100% !important;
            width: 0% !important;
            background: linear-gradient(90deg, #6366f1 0%, #7241ff 40%, #a855f7 80%, #6366f1 100%) !important;
            border-radius: 9999px !important;
            transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
            box-shadow: 0 0 8px rgba(114, 65, 255, 0.6) !important;
        }

        .autoform-hud-progress-bar.autoform-progress-complete {
            background: linear-gradient(90deg, #10b981 0%, #059669 100%) !important;
            box-shadow: 0 0 8px rgba(16, 185, 129, 0.8) !important;
        }

        /* Header */
        .autoform-hud-header {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 8px !important;
        }

        .autoform-hud-header-left {
            display: flex !important;
            align-items: center !important;
            gap: 7px !important;
            min-width: 0 !important;
        }

        .autoform-hud-orb {
            width: 12px !important;
            height: 12px !important;
            border-radius: 50% !important;
            background: radial-gradient(circle at 35% 35%, #c084fc 0%, #7241ff 60%, #4338ca 100%) !important;
            box-shadow: 0 0 10px rgba(168, 85, 247, 0.8) !important;
            animation: autoform-orb-pulse 2s infinite ease-in-out !important;
            flex-shrink: 0 !important;
        }

        @keyframes autoform-orb-pulse {
            0%, 100% {
                transform: scale(1);
                box-shadow: 0 0 8px rgba(168, 85, 247, 0.7), 0 0 14px rgba(114, 65, 255, 0.4);
            }
            50% {
                transform: scale(1.15);
                box-shadow: 0 0 14px rgba(192, 132, 252, 1), 0 0 22px rgba(168, 85, 247, 0.6);
            }
        }

        .autoform-hud-brand {
            font-size: 12.5px !important;
            font-weight: 700 !important;
            color: #ffffff !important;
            letter-spacing: -0.2px !important;
            white-space: nowrap !important;
        }

        .autoform-hud-counter {
            font-size: 11px !important;
            font-weight: 600 !important;
            padding: 2px 7px !important;
            border-radius: 9999px !important;
            background: rgba(255, 255, 255, 0.08) !important;
            color: #c4b5fd !important;
            letter-spacing: -0.1px !important;
            white-space: nowrap !important;
        }

        .autoform-hud-percent {
            font-size: 11.5px !important;
            font-weight: 700 !important;
            color: #a855f7 !important;
            font-variant-numeric: tabular-nums !important;
        }

        .autoform-hud-header-right {
            display: flex !important;
            align-items: center !important;
            gap: 5px !important;
            flex-shrink: 0 !important;
        }

        .autoform-hud-btn {
            border: none !important;
            outline: none !important;
            cursor: pointer !important;
            border-radius: 6px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 4px !important;
            font-family: inherit !important;
            transition: all 0.15s ease !important;
        }

        .autoform-hud-btn-min {
            background: rgba(255, 255, 255, 0.08) !important;
            color: #9ca3af !important;
            width: 24px !important;
            height: 24px !important;
            padding: 0 !important;
        }

        .autoform-hud-btn-min:hover {
            background: rgba(255, 255, 255, 0.16) !important;
            color: #ffffff !important;
        }

        .autoform-hud-btn-stop {
            background: rgba(225, 29, 72, 0.15) !important;
            color: #fb7185 !important;
            border: 1px solid rgba(225, 29, 72, 0.3) !important;
            padding: 4px 8px !important;
            font-size: 11px !important;
            font-weight: 600 !important;
        }

        .autoform-hud-btn-stop:hover {
            background: #e11d48 !important;
            color: #ffffff !important;
            border-color: #e11d48 !important;
        }

        /* Collapsed State */
        .autoform-hud-card.autoform-hud-collapsed .autoform-hud-body {
            display: none !important;
        }

        .autoform-hud-card.autoform-hud-collapsed {
            padding: 8px 12px !important;
            border-radius: 9999px !important;
            cursor: pointer !important;
        }

        .autoform-hud-card.autoform-hud-collapsed .autoform-hud-progress-track {
            display: none !important;
        }

        /* Body / Target Row */
        .autoform-hud-body {
            margin-top: 8px !important;
        }

        .autoform-hud-target-row {
            padding: 7px 9px !important;
            background: rgba(255, 255, 255, 0.04) !important;
            border: 1px solid rgba(255, 255, 255, 0.06) !important;
            border-radius: 8px !important;
        }

        .autoform-hud-status-title {
            font-size: 12px !important;
            font-weight: 600 !important;
            color: #f9fafb !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            line-height: 1.3 !important;
        }

        .autoform-hud-subrow {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 8px !important;
            margin-top: 4px !important;
        }

        .autoform-hud-status-subtext {
            font-size: 11px !important;
            color: #9ca3af !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            max-width: 220px !important;
        }

        .autoform-hud-provider-badge {
            font-size: 9px !important;
            font-weight: 700 !important;
            letter-spacing: 0.3px !important;
            text-transform: uppercase !important;
            padding: 1px 5px !important;
            border-radius: 4px !important;
            background: rgba(139, 92, 246, 0.18) !important;
            color: #c4b5fd !important;
            border: 1px solid rgba(139, 92, 246, 0.3) !important;
            flex-shrink: 0 !important;
        }

        /* Thought Stream Console */
        .autoform-hud-thought-stream {
            margin-top: 8px !important;
            background: rgba(0, 0, 0, 0.45) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 8px !important;
            padding: 8px 10px !important;
            height: 96px !important;
            overflow-y: auto !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 5px !important;
            font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', monospace !important;
            font-size: 10.5px !important;
            box-sizing: border-box !important;
            scroll-behavior: smooth !important;
        }

        .autoform-hud-thought-stream::-webkit-scrollbar {
            width: 4px !important;
        }
        .autoform-hud-thought-stream::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.15) !important;
            border-radius: 4px !important;
        }

        .autoform-thought-row {
            display: flex !important;
            align-items: flex-start !important;
            gap: 6px !important;
            line-height: 1.35 !important;
            animation: autoform-thought-in 0.2s ease-out forwards !important;
        }

        @keyframes autoform-thought-in {
            from {
                opacity: 0;
                transform: translateY(5px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .autoform-thought-icon {
            flex-shrink: 0 !important;
            font-size: 11px !important;
        }

        .autoform-thought-text {
            word-break: break-word !important;
        }

        .autoform-thought-info { color: #d1d5db !important; }
        .autoform-thought-intent { color: #38bdf8 !important; }
        .autoform-thought-match { color: #34d399 !important; }
        .autoform-thought-ai { color: #c084fc !important; }
        .autoform-thought-skip { color: #9ca3af !important; }
        .autoform-thought-typing { color: #fbbf24 !important; }
        .autoform-thought-success { color: #4ade80 !important; font-weight: 600 !important; }
        .autoform-thought-error { color: #f87171 !important; }

        /* In-DOM Ghosting: Spotlight on Question Card */
        .autoform-ghost-active {
            position: relative !important;
            box-shadow: 0 0 0 2px #7241ff, 0 8px 30px -4px rgba(114, 65, 255, 0.28) !important;
            border-color: #7241ff !important;
            border-radius: 8px !important;
            transition: box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s ease !important;
            animation: autoform-ghost-pulse 2.2s infinite ease-in-out !important;
        }

        @keyframes autoform-ghost-pulse {
            0%, 100% {
                box-shadow: 0 0 0 2px #7241ff, 0 8px 26px -4px rgba(114, 65, 255, 0.25);
            }
            50% {
                box-shadow: 0 0 0 3px #9333ea, 0 12px 34px -4px rgba(147, 51, 234, 0.38);
            }
        }

        /* In-DOM Ghosting: Floating Chip Attached to Card */
        .autoform-ghost-chip {
            position: absolute !important;
            top: -12px !important;
            left: 14px !important;
            z-index: 1000 !important;
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            padding: 3px 10px !important;
            border-radius: 9999px !important;
            font-size: 11px !important;
            font-weight: 600 !important;
            color: #ffffff !important;
            pointer-events: none !important;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25), 0 0 10px rgba(114, 65, 255, 0.35) !important;
            animation: autoform-ghost-chip-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
            white-space: nowrap !important;
        }

        @keyframes autoform-ghost-chip-in {
            from {
                opacity: 0;
                transform: translateY(-5px) scale(0.92);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }

        .autoform-ghost-chip-icon {
            display: inline-flex !important;
            align-items: center !important;
            font-size: 11px !important;
        }

        .autoform-ghost-chip-thinking {
            background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
        }

        .autoform-ghost-chip-direct {
            background: linear-gradient(135deg, #059669, #10b981) !important;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2), 0 0 10px rgba(16, 185, 129, 0.4) !important;
        }

        .autoform-ghost-chip-cached {
            background: linear-gradient(135deg, #0284c7, #38bdf8) !important;
        }

        .autoform-ghost-chip-typing {
            background: linear-gradient(135deg, #d97706, #f59e0b) !important;
        }

        .autoform-ghost-chip-success {
            background: linear-gradient(135deg, #059669, #10b981) !important;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2), 0 0 12px rgba(16, 185, 129, 0.5) !important;
        }

        /* Choice Option Spotlight */
        .autoform-choice-spotlight {
            position: relative !important;
            background-color: rgba(114, 65, 255, 0.12) !important;
            border-radius: 6px !important;
            transition: background-color 0.2s ease !important;
            box-shadow: 0 0 0 2px rgba(114, 65, 255, 0.3) !important;
        }

        @media (prefers-reduced-motion: reduce) {
            .autoform-fab-idle,
            .autoform-shimmer-bar,
            .autoform-shimmer-bar::after,
            .autoform-spotlight-active,
            .autoform-ghost-active,
            .autoform-percent-pop {
                animation: none !important;
                transition-duration: 0.01ms !important;
            }
        }
    `;
    document.head.appendChild(style);
}

let activeGhostTarget = null;

/**
 * Renders an in-DOM floating thought pill directly attached to the target question or field.
 * @param {HTMLElement|null} targetBlock 
 * @param {string} text 
 * @param {'thinking'|'direct'|'typing'|'success'|'cached'|'clear'} [status='thinking']
 */
function showGhostChip(targetBlock, text, status = 'thinking') {
    removeGhostChip();
    if (!targetBlock || status === 'clear' || !text) return;

    try {
        const chip = document.createElement('div');
        chip.id = 'autoform-ghost-chip';
        chip.className = `autoform-ghost-chip autoform-ghost-chip-${status}`;

        const icon = document.createElement('span');
        icon.className = 'autoform-ghost-chip-icon';
        if (status === 'direct' || status === 'success') {
            icon.appendChild(createContentSvg('check'));
        } else if (status === 'cached') {
            icon.appendChild(createContentSvg('spark'));
        } else if (status === 'typing') {
            icon.textContent = '✍️';
        } else {
            icon.textContent = '✦';
        }
        chip.appendChild(icon);

        const label = document.createElement('span');
        label.className = 'autoform-ghost-chip-text';
        label.textContent = text;
        chip.appendChild(label);

        // Ensure target container has a relative positioning context
        const comp = window.getComputedStyle(targetBlock);
        if (comp.position === 'static') {
            targetBlock.style.position = 'relative';
        }

        targetBlock.classList.add('autoform-ghost-active');
        targetBlock.appendChild(chip);
        activeGhostTarget = targetBlock;
    } catch (_) {}
}

/**
 * Removes any active ghost chip and spotlight halo from the DOM.
 */
function removeGhostChip() {
    const existing = document.getElementById('autoform-ghost-chip');
    if (existing) {
        existing.remove();
    }
    if (activeGhostTarget) {
        activeGhostTarget.classList.remove('autoform-ghost-active');
        activeGhostTarget = null;
    }
}

/**
 * Pushes a thought entry into the live thought stream console without innerHTML.
 * @param {string} icon 
 * @param {string} text 
 * @param {'info'|'intent'|'match'|'ai'|'skip'|'typing'|'success'|'error'} [type='info']
 */
function addThought(icon, text, type = 'info') {
    const stream = document.getElementById('ai-thought-stream');
    if (!stream) return;

    const row = document.createElement('div');
    row.className = `autoform-thought-row autoform-thought-${type}`;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'autoform-thought-icon';
    iconSpan.textContent = icon;
    row.appendChild(iconSpan);

    const textSpan = document.createElement('span');
    textSpan.className = 'autoform-thought-text';
    textSpan.textContent = text;
    row.appendChild(textSpan);

    stream.appendChild(row);

    // Keep scroll pinned to newest thought
    stream.scrollTop = stream.scrollHeight;
}

/**
 * Creates and renders the modern Floating Thought Stream HUD without innerHTML.
 * @param {number} totalQuestions
 * @returns {HTMLDivElement}
 */
function createLoadingOverlay(totalQuestions) {
    injectAutoFormStyles();
    const existing = document.getElementById('ai-form-overlay');
    if (existing) existing.remove();

    // Floating HUD container (docked at bottom-right, pointer-events none on backdrop)
    const overlay = document.createElement('div');
    overlay.id = 'ai-form-overlay';
    overlay.className = 'autoform-hud-container';

    // Main Card (interactive)
    const card = document.createElement('div');
    card.id = 'ai-hud-card';
    card.className = 'autoform-hud-card';

    // Accent Micro Progress Track
    const track = document.createElement('div');
    track.className = 'autoform-hud-progress-track';
    const bar = document.createElement('div');
    bar.id = 'ai-progress-bar';
    bar.className = 'autoform-hud-progress-bar';
    track.appendChild(bar);
    card.appendChild(track);

    // Header Row
    const header = document.createElement('div');
    header.className = 'autoform-hud-header';

    // Header Left: Orb + Title + Progress pills
    const headerLeft = document.createElement('div');
    headerLeft.className = 'autoform-hud-header-left';

    const orb = document.createElement('div');
    orb.className = 'autoform-hud-orb';
    headerLeft.appendChild(orb);

    const brand = document.createElement('span');
    brand.className = 'autoform-hud-brand';
    brand.textContent = 'AutoForm Copilot';
    headerLeft.appendChild(brand);

    const counter = document.createElement('span');
    counter.id = 'ai-progress-counter';
    counter.className = 'autoform-hud-counter';
    counter.textContent = `Q 0/${totalQuestions}`;
    headerLeft.appendChild(counter);

    const percent = document.createElement('span');
    percent.id = 'ai-progress-percent';
    percent.className = 'autoform-hud-percent';
    percent.textContent = '0%';
    headerLeft.appendChild(percent);

    header.appendChild(headerLeft);

    // Header Right: Minimize & Stop buttons
    const headerRight = document.createElement('div');
    headerRight.className = 'autoform-hud-header-right';

    const minBtn = document.createElement('button');
    minBtn.id = 'ai-hud-minimize-btn';
    minBtn.className = 'autoform-hud-btn autoform-hud-btn-min';
    minBtn.title = 'Minimize/Expand Thought Stream';
    minBtn.appendChild(createContentSvg('minimize'));
    minBtn.onclick = (e) => {
        e.stopPropagation();
        card.classList.toggle('autoform-hud-collapsed');
        const isCollapsed = card.classList.contains('autoform-hud-collapsed');
        minBtn.textContent = '';
        minBtn.appendChild(createContentSvg(isCollapsed ? 'expand' : 'minimize'));
    };
    headerRight.appendChild(minBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'ai-cancel-btn';
    cancelBtn.className = 'autoform-hud-btn autoform-hud-btn-stop';
    cancelBtn.title = 'Stop and cancel solving';
    cancelBtn.appendChild(createContentSvg('stop'));
    const stopText = document.createElement('span');
    stopText.textContent = 'Stop';
    cancelBtn.appendChild(stopText);
    cancelBtn.onclick = (e) => {
        e.stopPropagation();
        cancelFormSolver();
    };
    headerRight.appendChild(cancelBtn);

    header.appendChild(headerRight);
    card.appendChild(header);

    // Clicking collapsed card expands it
    card.onclick = (e) => {
        if (card.classList.contains('autoform-hud-collapsed')) {
            if (!e.target.closest('#ai-cancel-btn')) {
                card.classList.remove('autoform-hud-collapsed');
                minBtn.textContent = '';
                minBtn.appendChild(createContentSvg('minimize'));
            }
        }
    };

    // Collapsible Body
    const body = document.createElement('div');
    body.id = 'ai-hud-body';
    body.className = 'autoform-hud-body';

    // Current Target Question Row
    const targetRow = document.createElement('div');
    targetRow.className = 'autoform-hud-target-row';

    const statusTitle = document.createElement('div');
    statusTitle.id = 'ai-status-text';
    statusTitle.className = 'autoform-hud-status-title';
    statusTitle.textContent = 'Initializing Copilot...';
    targetRow.appendChild(statusTitle);

    const subRow = document.createElement('div');
    subRow.className = 'autoform-hud-subrow';

    const subtext = document.createElement('span');
    subtext.id = 'ai-status-subtext';
    subtext.className = 'autoform-hud-status-subtext';
    subtext.textContent = 'Analyzing form structure...';
    subRow.appendChild(subtext);

    const providerBadge = document.createElement('span');
    providerBadge.id = 'ai-provider-badge';
    providerBadge.className = 'autoform-hud-provider-badge';
    providerBadge.textContent = 'COPILOT ACTIVE';
    subRow.appendChild(providerBadge);

    targetRow.appendChild(subRow);
    body.appendChild(targetRow);

    // Live Thought Stream Console
    const streamContainer = document.createElement('div');
    streamContainer.id = 'ai-thought-stream';
    streamContainer.className = 'autoform-hud-thought-stream';
    body.appendChild(streamContainer);

    card.appendChild(body);
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
    injectAutoFormStyles();
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
        box-shadow: 0 12px 32px -6px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.04);
        padding: 10px 16px; border-radius: 10px; z-index: 100001;
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
        font-size: 13px; font-weight: 600;
        display: flex; align-items: center; gap: 8px;
        animation: autoform-toast-spring-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    const iconEl = createContentSvg(c.iconType);
    const textEl = document.createElement('span');
    textEl.textContent = message;

    notif.appendChild(iconEl);
    notif.appendChild(textEl);

    document.body.appendChild(notif);
    setTimeout(() => {
        notif.style.transition = 'opacity 0.3s, transform 0.3s';
        notif.style.opacity = '0';
        notif.style.transform = 'translateY(-10px) scale(0.96)';
        setTimeout(() => notif.remove(), 320);
    }, 4500);
}

// ---------------------------------------------------------------------------
// DOM Interaction & Automation Handlers
// ---------------------------------------------------------------------------

function scrollToBlock(target) {
    let el = null;
    if (target && typeof target === 'object' && target.nodeType) {
        el = target;
    } else if (typeof target === 'number') {
        const blocks = getQuestionBlocks();
        el = blocks[target];
    }
    if (el) {
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.remove('autoform-spotlight-active');
            void el.offsetWidth; // force reflow for smooth animation replay
            el.classList.add('autoform-ghost-active');
        } catch (_) {}
    }
}

function isBlockFilled(block, q = null) {
    if (q && q.platform && q.platform !== 'google_forms' && globalThis.AutoFormEngine) {
        const adapter = globalThis.AutoFormEngine.getActiveAdapter(document, window.location.href);
        if (adapter && typeof adapter.isFieldFilled === 'function') {
            return adapter.isFieldFilled(q);
        }
    }
    if (!block) return false;
    const textInputs = block.querySelectorAll('input[type="text"], textarea, input[type="email"], input[type="number"], input[type="tel"], input[type="url"]');
    for (const input of textInputs) {
        if (input.value && input.value.trim().length > 0) return true;
    }
    const ariaChecked = block.querySelectorAll('[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"], input[type="radio"]:checked, input[type="checkbox"]:checked');
    if (ariaChecked.length > 0) return true;

    // Check select element
    const select = block.tagName?.toLowerCase() === 'select' ? block : block.querySelector('select');
    if (select && select.selectedIndex > 0 && select.value) {
        const opt = select.options[select.selectedIndex];
        const txt = (opt?.text || select.value).trim().toLowerCase();
        if (!txt.match(/^(?:select|choose|--)/i)) return true;
    }

    // Google Forms Dropdown verification: check custom listbox
    const listbox = block.querySelector('[role="listbox"], .MocG8c, div[aria-haspopup="listbox"]');
    if (listbox) {
        const selectedOption = listbox.querySelector('[aria-selected="true"]');
        if (selectedOption) return true;
        const triggerEl = listbox.querySelector('.quantumWizMenuPaperselectSelectedItem, span') || listbox;
        const triggerText = triggerEl?.innerText?.trim() || '';
        const placeholders = ['choose', 'select', 'select an option', 'wählen', 'choisir', 'seleccionar', 'escolha'];
        if (triggerText && !placeholders.includes(triggerText.toLowerCase())) {
            return true;
        }
    }

    // Check custom combobox / multiselect
    const combobox = block.querySelector ? block.querySelector('.multiselect, [role="combobox"], [aria-haspopup="listbox"]') : null;
    if (combobox) {
        if (combobox.classList && (combobox.classList.contains('has-selected') || combobox.classList.contains('is-selected'))) return true;
        const selLabel = combobox.querySelector ? combobox.querySelector('.multiselect-single-label, .multiselect-tag, .select__single-value, [aria-selected="true"]') : null;
        if (selLabel && (selLabel.innerText || selLabel.textContent || '').trim().length > 0) return true;
    }

    return false;
}

/**
 * Extracts the current answer from a question block if it was already filled or pre-filled.
 * @param {HTMLElement} block
 * @param {string} [type]
 * @param {Object} [q]
 * @returns {string|null}
 */
function getBlockAnswer(block, type, q = null) {
    if (q && q.inputElements && q.inputElements.length > 0) {
        const el = q.inputElements[0];
        if (el.tagName && el.tagName.toLowerCase() === 'select' && el.selectedIndex > 0) {
            return el.options[el.selectedIndex]?.text?.trim() || el.value;
        }
        const container = (el.closest && el.closest('.multiselect, [role="combobox"], [aria-haspopup="listbox"]')) || el;
        const selectedLabel = container.querySelector ? container.querySelector('.multiselect-single-label-text, .multiselect-single-label, .select__single-value, [aria-selected="true"]') : null;
        if (selectedLabel && (selectedLabel.innerText || selectedLabel.textContent || '').trim()) {
            return (selectedLabel.innerText || selectedLabel.textContent).trim();
        }
        if (el.value && el.value.trim()) return el.value.trim();
    }
    if (!block) return null;

    // 1. Text inputs and textareas
    const textInputs = block.querySelectorAll('input[type="text"], textarea, input[type="email"], input[type="number"], input[type="tel"], input[type="url"]');
    for (const input of textInputs) {
        if (input.value && input.value.trim().length > 0) {
            return input.value.trim();
        }
    }

    // 2. Radio buttons (single choice or scale)
    const checkedRadios = block.querySelectorAll('[role="radio"][aria-checked="true"], input[type="radio"]:checked');
    if (checkedRadios.length > 0) {
        const radio = checkedRadios[0];
        const label = radio.closest('label');
        if (label) {
            const text = getOptionText(label);
            if (text) return text;
        }
        const dataVal = radio.getAttribute('data-value');
        if (dataVal && dataVal.trim()) return dataVal.trim();
        const ariaLabel = radio.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
        if (radio.value && radio.value.trim()) return radio.value.trim();
    }

    // 3. Checkboxes (multi-select)
    const checkedCheckboxes = block.querySelectorAll('[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked');
    if (checkedCheckboxes.length > 0) {
        const selected = [];
        checkedCheckboxes.forEach(cb => {
            const label = cb.closest('label');
            let text = label ? getOptionText(label) : null;
            if (!text) text = cb.getAttribute('data-value') || cb.getAttribute('aria-label') || cb.value;
            if (text && text.trim() && !selected.includes(text.trim())) {
                selected.push(text.trim());
            }
        });
        if (selected.length > 0) return selected.join(', ');
    }

    // 4. Custom Listbox / Dropdown
    const listbox = block.querySelector('[role="listbox"], .MocG8c, div[aria-haspopup="listbox"]');
    if (listbox) {
        const selectedOption = listbox.querySelector('[aria-selected="true"]');
        if (selectedOption && selectedOption.innerText && selectedOption.innerText.trim()) {
            return selectedOption.innerText.trim();
        }
        const triggerEl = listbox.querySelector('.quantumWizMenuPaperselectSelectedItem, span') || listbox;
        const triggerText = triggerEl?.innerText?.trim() || '';
        const placeholders = ['choose', 'select', 'select an option', 'wählen', 'choisir', 'seleccionar', 'escolha'];
        if (triggerText && !placeholders.includes(triggerText.toLowerCase())) {
            return triggerText;
        }
    }

    return null;
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

    // Scale question fallback: extract digits if answer contains a numeric score (e.g., "5", "Rating: 4")
    const numMatch = String(answer).match(/\b\d+\b/);
    if (numMatch) {
        const targetNum = numMatch[0];
        const numWidget = widgets.find(w => (w.getAttribute('data-value') || '').trim() === targetNum);
        if (numWidget) {
            return numWidget.closest('label') || numWidget.parentElement || numWidget;
        }
    }

    return null;
}

/**
 * Detects Google Forms "Other: [___]" custom option row in multiple choice and checkbox questions.
 * @param {HTMLElement} block 
 * @returns {{ label: HTMLElement, widget: HTMLElement|null, input: HTMLInputElement|null }|null}
 */
function findOtherOption(block) {
    if (!block) return null;
    const labels = [...block.querySelectorAll('label')];
    for (const label of labels) {
        const txt = (getOptionText(label) || label.innerText || '').toLowerCase().trim();
        if (txt.startsWith('other') || txt.startsWith('autre') || txt.startsWith('otro') || txt.startsWith('sonstiges')) {
            const widget = label.querySelector('[role="radio"], [role="checkbox"]') || label;
            const textInput = block.querySelector('input[aria-label*="Other" i], input[aria-label*="autre" i], input[aria-label*="otro" i], label input[type="text"], .Hvn9fb input[type="text"]');
            return { label, widget, input: textInput };
        }
    }
    return null;
}

async function clickOption(label, maxRetries = 3) {
    if (!label) return false;

    // Spotlight the target choice visually before clicking
    if (label.classList) {
        label.classList.remove('autoform-choice-spotlight');
        void label.offsetWidth;
        label.classList.add('autoform-choice-spotlight');
        setTimeout(() => {
            if (label && label.classList) label.classList.remove('autoform-choice-spotlight');
        }, 800);
    }

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

/**
 * Dispatches realistic input events to simulate authentic user keyboard input.
 * @param {HTMLInputElement|HTMLTextAreaElement} input 
 * @param {string} answer 
 * @returns {Promise<boolean>}
 */
async function fillSpecificInput(input, answer) {
    if (!input) return false;
    input.focus();
    input.value = answer;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise(r => setTimeout(r, 160));
    return true;
}

async function fillTextInput(block, answer) {
    if (!block) return false;
    const inputs = [
        block.querySelector('input[type="text"]'),
        block.querySelector('textarea'),
        block.querySelector('input[type="email"]'),
        block.querySelector('input[type="tel"]'),
        block.querySelector('input[type="url"]'),
        block.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])')
    ];

    for (const input of inputs) {
        if (input) {
            return await fillSpecificInput(input, answer);
        }
    }
    return false;
}

/**
 * Automates Google Forms custom Material Design dropdown widgets.
 * Clicks the listbox trigger to mount the detached menu, selects the matching option, and confirms.
 * @param {HTMLElement} block 
 * @param {string} answer 
 * @returns {Promise<boolean>}
 */
async function fillDropdown(block, answer) {
    if (!block) return false;
    const trigger = block.querySelector('[role="listbox"]') || block.querySelector('.MocG8c') || block.querySelector('div[aria-haspopup="listbox"]');
    if (!trigger) return false;

    // Open dropdown menu
    trigger.click();
    await new Promise(r => setTimeout(r, 220));

    const normalizedAnswer = normalize(answer);
    // Find all option elements currently mounted in the DOM
    const popups = document.querySelectorAll('.exportSelectPopup, .OA0qNb, [role="listbox"]');
    let targetOption = null;

    for (const popup of popups) {
        const options = [...popup.querySelectorAll('[role="option"]')];
        if (options.length === 0) continue;

        targetOption = options.find(opt => {
            const val = normalize(opt.getAttribute('data-value') || opt.innerText || '');
            return val && (val === normalizedAnswer || val.includes(normalizedAnswer) || normalizedAnswer.includes(val));
        });
        if (targetOption) break;
    }

    if (targetOption) {
        targetOption.scrollIntoView({ block: 'nearest' });
        targetOption.click();
        targetOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        targetOption.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        targetOption.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        await new Promise(r => setTimeout(r, 200));
        return true;
    }

    // Close menu if no match found
    trigger.click();
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
        btn.classList.remove('autoform-fab-idle');
        btn.style.background = '#e11d48';
        btn.style.color = '#ffffff';
        btn.style.boxShadow = '0 4px 18px 0 rgba(225, 29, 72, 0.45)';
        btn.title = 'Stop form filling';
    } else {
        setFloatingButtonDOM(btn, false, questionCount);
        btn.classList.add('autoform-fab-idle');
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

// ---------------------------------------------------------------------------
// Client-Side Session Cache & Multi-Page Navigation Helpers
// ---------------------------------------------------------------------------

const solveCache = new Map();

function getQuestionCacheKey(q) {
    const raw = `${q.question}::${q.type}::${(q.choices || []).slice().sort().join('|')}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }
    return `autoform_cache_${hash}`;
}

function getNextPageButton() {
    const buttons = [...document.querySelectorAll('div[role="button"], button')];
    return buttons.find(b => {
        const text = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase().trim();
        return (text === 'next' || text === 'suivant' || text === 'siguiente' || text === 'weiter' || text.includes('next section') || text.includes('next page')) && !b.disabled;
    });
}

function getSubmitButton() {
    const buttons = [...document.querySelectorAll('div[role="button"], button')];
    return buttons.find(b => {
        const text = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase().trim();
        return (text === 'submit' || text === 'envoyer' || text === 'enviar' || text === 'senden') && !b.disabled;
    });
}

// ---------------------------------------------------------------------------
// Resilient Messaging & Service Worker Keep-Alive
// ---------------------------------------------------------------------------

let keepAlivePort = null;

function startKeepAlive() {
    try {
        if (chrome.runtime?.connect) {
            keepAlivePort = chrome.runtime.connect({ name: 'autoform-keepalive' });
            keepAlivePort.onDisconnect.addListener(() => {
                keepAlivePort = null;
            });
        }
    } catch (_) {
        keepAlivePort = null;
    }
}

function stopKeepAlive() {
    try {
        if (keepAlivePort) {
            keepAlivePort.disconnect();
            keepAlivePort = null;
        }
    } catch (_) {
        keepAlivePort = null;
    }
}

/**
 * Resilient wrapper around chrome.runtime.sendMessage with automatic retries,
 * exponential backoff, and MV3 service worker wake-up handling.
 * @param {Object} payload 
 * @param {number} maxRetries 
 * @param {number} baseDelayMs 
 * @returns {Promise<any>}
 */
async function sendRuntimeMessageWithRetry(payload, maxRetries = 3, baseDelayMs = 350) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // First check if extension context is valid
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
            throw new Error("Extension context invalidated. Please refresh the page.");
        }

        try {
            const res = await new Promise((resolve, reject) => {
                let responded = false;
                try {
                    chrome.runtime.sendMessage(payload, (response) => {
                        responded = true;
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message || "Connection error"));
                        } else {
                            resolve(response);
                        }
                    });
                } catch (sendErr) {
                    if (!responded) reject(sendErr);
                }
            });

            return res;
        } catch (err) {
            lastError = err;
            const errMsg = (err.message || '').toLowerCase();
            const isConnectionDrop = errMsg.includes("could not establish connection") ||
                                     errMsg.includes("receiving end does not exist") ||
                                     errMsg.includes("extension disconnected") ||
                                     errMsg.includes("channel closed") ||
                                     errMsg.includes("message port closed");

            if (isConnectionDrop && attempt < maxRetries) {
                const waitTime = baseDelayMs * attempt;
                console.warn(`[AutoForm] Background service worker retry (${attempt}/${maxRetries}) in ${waitTime}ms...`);
                // Re-open keep-alive connection if dropped
                startKeepAlive();
                await responsiveSleep(waitTime);
                continue;
            }

            throw err;
        }
    }

    throw lastError || new Error("Failed to communicate with extension background service worker.");
}

async function processQuestionQueue(questions) {
    isSolving = true;
    cancelRequested = false;
    updateFloatingButtonState(questions.length);
    startKeepAlive();

    // Fast pre-flight ping to wake up background service worker if sleeping
    try {
        await sendRuntimeMessageWithRetry({ action: "PING" }, 2, 200);
    } catch (_) {}

    // Hide FAB during solving to prevent visual overlap with HUD
    const fabBtn = document.getElementById('ai-floating-btn');
    if (fabBtn) fabBtn.style.display = 'none';

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
    const priorAnswers = [];
    const usedSnippetIds = [];

    // Retrieve verified memory profile and pacing preferences
    const userSettings = await new Promise(resolve => {
        chrome.storage.local.get(['memoryProfile', 'fillPacing'], (res) => resolve(res || {}));
    });
    const memoryProfile = userSettings.memoryProfile || null;
    const fillPacing = userSettings.fillPacing || 'natural';
    let defaultDelay = 800;
    if (fillPacing === 'turbo') defaultDelay = 150;
    else if (fillPacing === 'stealth') defaultDelay = 1500;

    function updateProgressUI(stepNumber, percentValue) {
        solverProgress = {
            percent: percentValue,
            currentQuestion: stepNumber,
            totalQuestions: questions.length
        };
        if (progressBar) progressBar.style.width = `${percentValue}%`;
        if (progressPercent) {
            progressPercent.innerText = `${percentValue}%`;
            progressPercent.classList.remove('autoform-percent-pop');
            void progressPercent.offsetWidth;
            progressPercent.classList.add('autoform-percent-pop');
        }
        if (progressCounter) {
            progressCounter.innerText = `Q ${stepNumber}/${questions.length}`;
        }
    }

    // Initialize 0% progress
    updateProgressUI(0, 0);

    // Step 1: Whole-Form Understanding & Macro Synthesis
    const formTitle = getFormTitle();
    const formDesc = getFormDescription();
    const digestBuilder = (typeof buildFormDigest === 'function')
        ? buildFormDigest
        : globalThis.MemoryRetriever?.buildFormDigest;
    const formDigest = digestBuilder
        ? digestBuilder(formTitle, formDesc, questions)
        : { title: formTitle, description: formDesc, totalQuestions: questions.length };

    // Present Form Understanding to the user
    if (statusText) statusText.innerText = formTitle ? `Form: ${formTitle.slice(0, 36)}` : 'Form Analyzed';
    if (statusSubtext) statusSubtext.innerText = `${formDigest.macroIntent || 'General Form'} • ${questions.length} questions`;
    if (providerBadge) providerBadge.innerText = 'FORM ANALYZED';

    addThought('✦', `Form detected: "${(formTitle || 'Web Form').slice(0, 32)}"`, 'info');
    addThought('📋', `Macro intent: ${formDigest.macroIntent || 'General Form'} (${questions.length} Qs)`, 'intent');
    await responsiveSleep(400);

    try {
        for (let i = 0; i < questions.length; i++) {
            if (cancelRequested) break;

            if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
                removeGhostChip();
                overlay.remove();
                alert("Extension updated. Please refresh this page.");
                throw new Error("Extension context invalidated");
            }

            const q = questions[i];
            const currentBlock = q.element || getQuestionBlocks()[q.id];

            // Update Progress UI for current question starting
            const stepStartPercent = Math.round((i / questions.length) * 100);
            updateProgressUI(i + 1, stepStartPercent);

            if (isBlockFilled(currentBlock, q)) {
                const existingVal = getBlockAnswer(currentBlock, q.type, q);
                if (existingVal && q.question) {
                    priorAnswers.push({
                        question: q.question,
                        answer: existingVal,
                        type: q.type
                    });
                }
                if (statusText) statusText.innerText = `Skipping Q${i + 1}`;
                if (statusSubtext) statusSubtext.innerText = `Already answered: "${(existingVal || '').slice(0, 24)}"`;
                addThought('⏭', `[Q${i + 1}] Already answered, preserving value`, 'skip');
                showGhostChip(currentBlock, '✓ Already answered', 'success');
                skippedCount++;
                const stepSkippedPercent = Math.round(((i + 1) / questions.length) * 100);
                updateProgressUI(i + 1, stepSkippedPercent);
                await responsiveSleep(150);
                removeGhostChip();
                continue;
            }

            if (statusText) statusText.innerText = `Q${i + 1}: ${(q.question || 'Question').slice(0, 36)}`;
            if (statusSubtext) statusSubtext.innerText = `Type: ${q.type || 'text'} • Scanning...`;
            scrollToBlock(q.element || q.id);
            showGhostChip(currentBlock, 'Analyzing question...', 'thinking');
            addThought('🔍', `[Q${i + 1}] Reading: "${(q.question || 'Question').slice(0, 32)}..."`, 'info');

            // Dynamically extract runtime choices for combobox / dropdown if not already populated
            if (q.type === 'dropdown' && (!q.choices || q.choices.length === 0)) {
                if (globalThis.AutoFormEngine && typeof globalThis.AutoFormEngine.extractChoices === 'function') {
                    try {
                        const dynamicChoices = await globalThis.AutoFormEngine.extractChoices(q, document);
                        if (dynamicChoices && dynamicChoices.length > 0) {
                            q.choices = dynamicChoices;
                        }
                    } catch (_) {}
                }
            }

            // Phase 3: Check Deterministic Instant Profile Slot (0ms • 0 Quota)
            let directProfileMatch = null;
            if (memoryProfile) {
                const slotResolver = (typeof resolveDirectSlot === 'function') 
                    ? resolveDirectSlot 
                    : globalThis.MemoryRetriever?.resolveDirectSlot;
                const choiceResolver = (typeof resolveDirectChoice === 'function')
                    ? resolveDirectChoice
                    : globalThis.MemoryRetriever?.resolveDirectChoice;

                if (q.type === 'text_input' && slotResolver) {
                    const slot = slotResolver(q.question, memoryProfile);
                    if (slot && slot.value) {
                        directProfileMatch = {
                            key: slot.key,
                            answer: slot.value,
                            provider: 'instant_profile',
                            latencyMs: 0
                        };
                    }
                } else if ((q.type === 'multiple_choice' || q.type === 'dropdown') && (choiceResolver || slotResolver)) {
                    let choiceMatch = null;
                    if (choiceResolver && q.choices && q.choices.length > 0) {
                        choiceMatch = choiceResolver(q.question, q.choices, memoryProfile);
                    }
                    if (!choiceMatch && q.type === 'dropdown' && slotResolver) {
                        const slot = slotResolver(q.question, memoryProfile);
                        if (slot && slot.value) {
                            choiceMatch = {
                                key: slot.key,
                                answer: slot.value
                            };
                        }
                    }
                    if (choiceMatch && choiceMatch.answer) {
                        directProfileMatch = {
                            key: choiceMatch.key,
                            answer: choiceMatch.answer,
                            provider: 'instant_profile',
                            latencyMs: 0
                        };
                    }
                }
            }

            try {
                // Check 0ms Instant Profile first, then Session Cache, then AI backend
                const cacheKey = getQuestionCacheKey(q);
                let solution = null;

                if (directProfileMatch) {
                    solution = {
                        success: true,
                        answer: directProfileMatch.answer,
                        provider: 'instant_profile',
                        latencyMs: 0
                    };
                    if (providerBadge) {
                        providerBadge.innerText = 'INSTANT • 0ms';
                    }
                    addThought('💡', `[Q${i + 1}] Direct match: ${directProfileMatch.key} -> "${String(directProfileMatch.answer || '').slice(0, 20)}"`, 'match');
                    showGhostChip(currentBlock, `Direct Match: ${directProfileMatch.key}`, 'direct');
                } else if (solveCache.has(cacheKey)) {
                    solution = solveCache.get(cacheKey);
                    if (providerBadge) {
                        providerBadge.innerText = 'CACHED • 0ms';
                    }
                    addThought('⚡', `[Q${i + 1}] Session cache hit (0ms)`, 'match');
                    showGhostChip(currentBlock, 'Cached Answer', 'cached');
                } else {
                    const intentClassifier = (typeof classifyQuestionIntent === 'function')
                        ? classifyQuestionIntent
                        : globalThis.MemoryRetriever?.classifyQuestionIntent;
                    const detectedIntents = intentClassifier ? intentClassifier(q.question, q.type) : ['GENERAL'];
                    const primaryIntent = (detectedIntents && detectedIntents[0]) || 'GENERAL';
                    addThought('🧠', `[Q${i + 1}] Intent: ${primaryIntent} • Querying AI...`, 'intent');
                    const response = await sendRuntimeMessageWithRetry({
                        action: "SOLVE_SINGLE_QUESTION",
                        data: {
                            id: q.id,
                            question: q.question,
                            type: q.type,
                            choices: q.choices || [],
                            formDigest: formDigest,
                            priorAnswers: priorAnswers.slice(-6),
                            usedSnippetIds: [...usedSnippetIds]
                        }
                    }, 3, 350);

                    if (!response || !response.success) {
                        throw new Error(response?.error || "AI failed to solve");
                    }

                    if (response.retrievedSnippetIds && Array.isArray(response.retrievedSnippetIds)) {
                        response.retrievedSnippetIds.forEach(snipId => {
                            if (!usedSnippetIds.includes(snipId)) usedSnippetIds.push(snipId);
                        });
                    }
                    solution = response;

                    solveCache.set(cacheKey, solution);
                    addThought('⚡', `[Q${i + 1}] Solution via ${(solution.provider || 'AI').toUpperCase()} (${solution.latencyMs || 0}ms)`, 'ai');
                }

                if (cancelRequested) break;

                // Update provider badge
                if (providerBadge && solution.provider && !solveCache.has(cacheKey) && solution.provider !== 'instant_profile') {
                    const latency = solution.latencyMs ? ` • ${solution.latencyMs}ms` : '';
                    providerBadge.innerText = `${solution.provider.toUpperCase()}${latency}`;
                }

                showGhostChip(currentBlock, '✍️ Autofilling...', 'typing');

                const block = q.element || getQuestionBlocks()[q.id];
                let filled = false;

                if (q.platform && q.platform !== 'google_forms' && globalThis.AutoFormEngine) {
                    filled = await globalThis.AutoFormEngine.fillAnswer(q, solution.answers || solution.answer, document);
                } else {
                    if (q.type === 'checkbox' && solution.answers && Array.isArray(solution.answers)) {
                        for (const ans of solution.answers) {
                            const target = findMatchingOption(block, ans);
                            if (target) {
                                await clickOption(target);
                            } else {
                                const other = findOtherOption(block);
                                if (other) {
                                    await clickOption(other.widget || other.label);
                                    if (other.input) {
                                        const cleanVal = ans.replace(/^other\s*[:\-]?\s*/i, '').trim();
                                        await fillSpecificInput(other.input, cleanVal);
                                    }
                                }
                            }
                        }
                        filled = true;
                    } else if (q.type === 'dropdown') {
                        filled = await fillDropdown(block, solution.answer);
                    } else if (q.type === 'multiple_choice' || q.type === 'checkbox' || q.type === 'scale') {
                        const target = findMatchingOption(block, solution.answer);
                        if (target) {
                            filled = await clickOption(target);
                        } else {
                            const other = findOtherOption(block);
                            if (other) {
                                const clicked = await clickOption(other.widget || other.label);
                                if (other.input) {
                                    const cleanVal = solution.answer.replace(/^other\s*[:\-]?\s*/i, '').trim();
                                    await fillSpecificInput(other.input, cleanVal);
                                }
                                filled = clicked;
                            }
                        }
                    } else {
                        filled = await fillTextInput(block, solution.answer);
                    }
                }

                if (filled) {
                    successCount++;
                    const ansToRecord = (q.type === 'checkbox' && solution.answers && Array.isArray(solution.answers))
                        ? solution.answers.join(', ')
                        : (solution.answer || '');
                    if (ansToRecord && q.question) {
                        priorAnswers.push({
                            question: q.question,
                            answer: ansToRecord,
                            type: q.type
                        });
                    }
                    addThought('✓', `[Q${i + 1}] Injected answer successfully`, 'success');
                    showGhostChip(currentBlock, '✓ Injected', 'success');
                } else {
                    failureCount++;
                    addThought('✕', `[Q${i + 1}] Could not inject answer into field`, 'error');
                    showGhostChip(currentBlock, 'Field not injected', 'error');
                }

                // Advance progress after question is answered
                const stepEndPercent = Math.round(((i + 1) / questions.length) * 100);
                updateProgressUI(i + 1, stepEndPercent);

                // Dynamic pacing
                const currentDelay = (solution.provider === 'instant_profile')
                    ? Math.min(200, defaultDelay)
                    : (fillPacing === 'stealth' ? (defaultDelay + Math.floor(Math.random() * 300)) : defaultDelay);

                await responsiveSleep(currentDelay);
                removeGhostChip();

            } catch (err) {
                console.error(`Q${i + 1} Error:`, err.message);

                const isContextError = err.message.includes("Extension context invalidated") || 
                                       err.message.includes("Extension Disconnected") ||
                                       err.message.includes("Receiving end does not exist") ||
                                       err.message.includes("Could not establish connection");

                if (isContextError) {
                    removeGhostChip();
                    if (overlay) overlay.remove();
                    showNotification("Extension service worker disconnected. Please refresh the page.", "warning");
                    addThought('⚠️', `[Q${i + 1}] Service worker disconnected. Please refresh page.`, 'error');
                    return;
                }

                addThought('⚠️', `[Q${i + 1}] Error: ${err.message}`, 'error');
                showGhostChip(currentBlock, 'Error solving', 'error');
                showNotification(`Q${i + 1}: ${err.message}`, "error");
                failureCount++;
                const stepFailPercent = Math.round(((i + 1) / questions.length) * 100);
                updateProgressUI(i + 1, stepFailPercent);
                await responsiveSleep(200);
                removeGhostChip();
            }
        }

        // Final 100% completion flourish
        if (!cancelRequested) {
            updateProgressUI(questions.length, 100);
            if (progressBar) {
                progressBar.classList.add('autoform-progress-complete');
            }
            if (statusText) statusText.innerText = 'All Questions Solved!';
            if (statusSubtext) statusSubtext.innerText = 'Completed successfully ✨';
            if (providerBadge) providerBadge.innerText = 'COMPLETED 100%';
            addThought('🎉', `All ${questions.length} questions completed! ✨`, 'success');
            showGhostChip(null, '', 'clear');
            await responsiveSleep(1200); // Allow user to see full completion animation!
        }

    } finally {
        stopKeepAlive();
        removeGhostChip();
        const fabBtn = document.getElementById('ai-floating-btn');
        if (fabBtn) fabBtn.style.display = '';

        if (overlay) {
            overlay.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
            overlay.style.opacity = '0';
            overlay.style.transform = 'translateY(14px) scale(0.96)';
            setTimeout(() => {
                if (overlay && overlay.parentNode) overlay.remove();
            }, 360);
        }
        const wasCancelled = cancelRequested;
        isSolving = false;
        cancelRequested = false;
        solverProgress = { percent: 0, currentQuestion: 0, totalQuestions: 0 };
        updateFloatingButtonState(questions.length);

        if (wasCancelled) {
            showNotification(`Stopped: ${successCount} filled before cancelling`, 'warning');
        } else {
            const nextBtn = getNextPageButton();
            const submitBtn = getSubmitButton();

            if (nextBtn) {
                showNotification(`Section done! (${successCount} filled) Auto-continuing to next section...`, 'info');
                setTimeout(() => {
                    if (!isSolving && !cancelRequested) {
                        nextBtn.click();
                        setTimeout(() => {
                            if (getQuestionBlocks().length > 0) {
                                runFormSolver();
                            }
                        }, 1200);
                    }
                }, 1500);
            } else if (submitBtn) {
                showNotification(`All sections completed! Ready for review & submit.`, 'success');
            } else {
                const message = `Done! ${successCount} filled, ${skippedCount} skipped${failureCount > 0 ? `, ${failureCount} failed` : ''}`;
                showNotification(message, successCount > 0 ? 'success' : 'info');
            }
        }
    }
}

/**
 * Instant slot filling: immediately fills all recognized profile fields
 * on the active form page in 0ms without hitting the AI backend or consuming quota.
 * @returns {Promise<{ success: boolean, filledCount: number }>}
 */
async function instantFillProfile() {
    if (isSolving) {
        showNotification("AutoForm is currently running", "warning");
        return { success: false, filledCount: 0 };
    }

    const questions = getQuestions();
    if (questions.length === 0) {
        showNotification("No questions detected on this page", "error");
        return { success: false, filledCount: 0 };
    }

    const stored = await new Promise(resolve => {
        chrome.storage.local.get(['memoryProfile'], resolve);
    });
    const profile = stored?.memoryProfile;
    if (!profile) {
        showNotification("No memory profile found. Configure in Settings.", "warning");
        return { success: false, filledCount: 0 };
    }

    const blocks = getQuestionBlocks();
    let filledCount = 0;

    const slotResolver = (typeof resolveDirectSlot === 'function')
        ? resolveDirectSlot
        : globalThis.MemoryRetriever?.resolveDirectSlot;
    const choiceResolver = (typeof resolveDirectChoice === 'function')
        ? resolveDirectChoice
        : globalThis.MemoryRetriever?.resolveDirectChoice;

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const block = q.element || blocks[q.id];
        if (!block || isBlockFilled(block, q)) continue;

        let answered = false;

        // If dropdown choices are not in DOM, extract runtime choices from open combobox
        if (q.type === 'dropdown' && (!q.choices || q.choices.length === 0)) {
            if (globalThis.AutoFormEngine && typeof globalThis.AutoFormEngine.extractChoices === 'function') {
                try {
                    const dynamicChoices = await globalThis.AutoFormEngine.extractChoices(q, document);
                    if (dynamicChoices && dynamicChoices.length > 0) {
                        q.choices = dynamicChoices;
                    }
                } catch (_) {}
            }
        }

        if (q.type === 'text_input' && slotResolver) {
            const slot = slotResolver(q.question, profile);
            if (slot && slot.value) {
                if (q.platform && q.platform !== 'google_forms' && globalThis.AutoFormEngine) {
                    answered = await globalThis.AutoFormEngine.fillAnswer(q, slot.value, document);
                } else {
                    answered = await fillTextInput(block, slot.value);
                }
            }
        } else if ((q.type === 'multiple_choice' || q.type === 'dropdown') && (choiceResolver || slotResolver)) {
            let targetAnswer = null;
            if (choiceResolver && q.choices && q.choices.length > 0) {
                const choiceMatch = choiceResolver(q.question, q.choices, profile);
                if (choiceMatch && choiceMatch.answer) {
                    targetAnswer = choiceMatch.answer;
                }
            }
            if (!targetAnswer && q.type === 'dropdown' && slotResolver) {
                const slot = slotResolver(q.question, profile);
                if (slot && slot.value) {
                    targetAnswer = slot.value;
                }
            }

            if (targetAnswer) {
                if (q.platform && q.platform !== 'google_forms' && globalThis.AutoFormEngine) {
                    answered = await globalThis.AutoFormEngine.fillAnswer(q, targetAnswer, document);
                } else if (q.type === 'dropdown') {
                    answered = await fillDropdown(block, targetAnswer);
                } else {
                    const target = findMatchingOption(block, targetAnswer);
                    if (target) {
                        answered = await clickOption(target);
                    }
                }
            }
        }

        if (answered) {
            filledCount++;
            scrollToBlock(q.element || q.id);
            await new Promise(r => setTimeout(r, 120));
        }
    }

    if (filledCount > 0) {
        showNotification(`⚡ Filled ${filledCount} profile field${filledCount > 1 ? 's' : ''} instantly! (0ms • 0 quota)`, "success");
    } else {
        showNotification("No matching profile fields detected on this section", "info");
    }

    return { success: true, filledCount };
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
    } else if (request.action === "INSTANT_FILL_PROFILE") {
        instantFillProfile().then(res => {
            sendResponse(res);
        });
        return true;
    } else if (request.action === "STOP_SOLVING") {
        cancelFormSolver();
        sendResponse({ success: true, isSolving: false });
    } else if (request.action === "GET_SOLVER_STATUS") {
        const questions = getQuestions();
        const adapter = getActiveFormAdapter();
        sendResponse({ 
            isSolving: isSolving,
            detected: questions.length > 0,
            formType: adapter ? adapter.name : (window.location.href.includes('docs.google.com/forms') ? 'Google Forms' : 'Web Form'),
            formTitle: getFormTitle(),
            questionCount: questions.length,
            percent: solverProgress.percent,
            currentQuestion: solverProgress.currentQuestion
        });
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isSolving) cancelFormSolver();
});

function initDraggableFab(btn) {
    let isDragging = false;
    let hasMoved = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    // Restore saved position if available
    try {
        const saved = sessionStorage.getItem('autoform_fab_pos');
        if (saved) {
            const { top, left } = JSON.parse(saved);
            const maxTop = window.innerHeight - 56;
            const maxLeft = window.innerWidth - 130;
            btn.style.top = `${Math.min(Math.max(16, top), maxTop)}px`;
            btn.style.left = `${Math.min(Math.max(16, left), maxLeft)}px`;
            btn.style.bottom = 'auto';
            btn.style.right = 'auto';
        }
    } catch (_) {}

    btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // Only primary mouse button / touch
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = btn.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        // Switch positioning to top/left coordinates
        btn.style.bottom = 'auto';
        btn.style.right = 'auto';
        btn.style.left = `${initialLeft}px`;
        btn.style.top = `${initialTop}px`;
        btn.style.transition = 'none';

        btn.classList.add('autoform-fab-dragging');
        btn.classList.remove('autoform-fab-idle');

        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    });

    btn.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        if (Math.hypot(deltaX, deltaY) > 5) {
            hasMoved = true;
        }

        const maxLeft = window.innerWidth - btn.offsetWidth - 10;
        const maxTop = window.innerHeight - btn.offsetHeight - 10;
        const newLeft = Math.min(Math.max(10, initialLeft + deltaX), maxLeft);
        const newTop = Math.min(Math.max(10, initialTop + deltaY), maxTop);

        btn.style.left = `${newLeft}px`;
        btn.style.top = `${newTop}px`;
    });

    const onPointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;
        try { btn.releasePointerCapture(e.pointerId); } catch (_) {}

        btn.classList.remove('autoform-fab-dragging');
        if (!isSolving) btn.classList.add('autoform-fab-idle');

        // Spring physics curve for magnetic snapping (Apple / Vercel design system)
        btn.style.transition = 'left 0.35s cubic-bezier(0.34, 1.35, 0.64, 1), top 0.35s cubic-bezier(0.34, 1.35, 0.64, 1), transform 0.15s, background-color 0.15s';

        if (hasMoved) {
            const rect = btn.getBoundingClientRect();
            const snapLeft = (rect.left + rect.width / 2) < (window.innerWidth / 2);
            const finalLeft = snapLeft ? 20 : (window.innerWidth - rect.width - 20);
            const finalTop = Math.min(Math.max(20, rect.top), window.innerHeight - rect.height - 20);

            btn.style.left = `${finalLeft}px`;
            btn.style.top = `${finalTop}px`;

            try {
                sessionStorage.setItem('autoform_fab_pos', JSON.stringify({ top: finalTop, left: finalLeft }));
            } catch (_) {}
        }
    };

    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerUp);

    // Suppress click if a drag happened
    btn.addEventListener('click', (e) => {
        if (hasMoved) {
            e.stopPropagation();
            e.preventDefault();
            hasMoved = false;
            return;
        }
        if (isSolving) cancelFormSolver();
        else runFormSolver();
    }, true);
}

function createFloatingButton() {
    if (document.getElementById('ai-floating-btn')) return;
    injectAutoFormStyles();
    const questions = getQuestions();

    const btn = document.createElement('button');
    btn.id = 'ai-floating-btn';
    btn.className = 'autoform-fab-idle';
    setFloatingButtonDOM(btn, false, questions.length);
    btn.style.cssText = `
        position: fixed; bottom: max(20px, env(safe-area-inset-bottom, 20px)); right: max(20px, env(safe-area-inset-right, 20px)); z-index: 99999;
        background-color: #7241ff;
        color: #ffffff; border: none; padding: 10px 16px;
        min-height: 40px;
        border-radius: 9999px; cursor: grab; font-weight: 600; font-size: 13px;
        box-shadow: 0 4px 14px rgba(114, 65, 255, 0.35);
        transition: transform 0.2s cubic-bezier(0.34, 1.4, 0.64, 1), background-color 0.15s, box-shadow 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
        display: flex; align-items: center; gap: 7px;
        user-select: none;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
    `;

    btn.onmouseover = () => {
        if (!isSolving && !btn.classList.contains('autoform-fab-dragging')) {
            btn.style.background = '#612df0';
            btn.style.transform = 'translateY(-2px) scale(1.02)';
        }
    };
    btn.onmouseout = () => {
        if (!isSolving && !btn.classList.contains('autoform-fab-dragging')) {
            btn.style.background = '#7241ff';
            btn.style.transform = 'translateY(0) scale(1)';
        }
    };

    initDraggableFab(btn);
    document.body.appendChild(btn);
}

function checkAndMountFab() {
    const questions = getQuestions();
    const existingBtn = document.getElementById('ai-floating-btn');

    if (existingBtn) {
        if (!isSolving) {
            if (questions.length > 0) {
                existingBtn.style.display = 'flex';
                updateFloatingButtonState(questions.length);
            } else {
                existingBtn.style.display = 'none';
            }
        }
        return;
    }

    if (questions && questions.length > 0) {
        createFloatingButton();
    }
}

// Initial checks for both static and dynamically rendered forms
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(checkAndMountFab, 500);
    setTimeout(checkAndMountFab, 1600);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(checkAndMountFab, 500);
        setTimeout(checkAndMountFab, 1600);
    });
}

// MutationObserver for single-page applications (SPAs, React modals, dynamic Vue forms)
if (typeof MutationObserver !== 'undefined' && document.body) {
    let debounceFab = null;
    const observer = new MutationObserver(() => {
        if (isSolving) return;
        if (debounceFab) clearTimeout(debounceFab);
        debounceFab = setTimeout(checkAndMountFab, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// SPA Navigation listeners (Vue Router, React Router, Next.js, History API)
['popstate', 'hashchange'].forEach(evt => {
    window.addEventListener(evt, () => setTimeout(checkAndMountFab, 300));
});

(function() {
    const wrapHistory = (method) => {
        const orig = window.history ? window.history[method] : null;
        if (typeof orig === 'function') {
            window.history[method] = function(...args) {
                const result = orig.apply(this, args);
                setTimeout(checkAndMountFab, 400);
                return result;
            };
        }
    };
    wrapHistory('pushState');
    wrapHistory('replaceState');
})();
