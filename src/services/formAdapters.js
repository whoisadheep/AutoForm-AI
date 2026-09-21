/**
 * @file src/services/formAdapters.js
 * @description Universal Form Engine and Adapters for AutoForm AI v2.0.
 * Provides modular, high-accuracy adapters for Google Forms, Job Boards
 * (Greenhouse, Lever, Ashby, Workday, BambooHR), and Generic Web Forms.
 */

// ---------------------------------------------------------------------------
// 1. Label Extraction & Text Normalization Utilities
// ---------------------------------------------------------------------------

/**
 * Strips noise, trailing colons, asterisks (required markers), and extra whitespace.
 * @param {string} text 
 * @returns {string}
 */
function cleanLabelText(text = '') {
    if (!text) return '';
    return text
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[\s:*•※†‡]+$/g, '') // trailing required asterisks, colons, bullets
        .replace(/^[\s:*•※†‡]+/g, '') // leading required asterisks, colons, bullets
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Normalizes placeholder text into clean human-readable field prompts.
 * Strips instructional filler (e.g. "enter your name" -> "Name", "Select your State" -> "State").
 * @param {string} raw 
 * @returns {string}
 */
function cleanPlaceholder(raw = '') {
    if (!raw) return '';
    let clean = cleanLabelText(raw);
    const stripped = clean.replace(/^(?:please\s+)?(?:enter|select|choose|re-enter|input|type|provide)\s+(?:your\s+|other\s+)?/i, '');
    if (stripped !== clean) {
        const trimmed = stripped.replace(/[\s:*•※†‡]+$/g, '').trim();
        if (trimmed.toLowerCase() === 'yop') return 'Year of Passing';
        if (trimmed.length > 0) {
            return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
        }
    }
    if (clean.toLowerCase() === 'yop') return 'Year of Passing';
    return clean;
}

/**
 * Humanizes programmatic attribute names (e.g., "job_application[first_name]" -> "First Name").
 * @param {string} raw 
 * @returns {string}
 */
function humanizeFieldName(raw = '') {
    if (!raw) return '';
    let clean = raw.trim();

    // Extract inside brackets if present: job_application[answers][123] -> answers 123
    const bracketMatches = clean.match(/\[([^\]]+)\]/g);
    if (bracketMatches && bracketMatches.length > 0) {
        clean = bracketMatches.map(b => b.replace(/[\[\]]/g, '')).filter(b => isNaN(b)).join(' ') || clean;
    }

    // Strip common prefixes
    clean = clean.replace(/^(?:job_application|custom_fields|applicant|user|field|input)[_\-.]?/i, '');

    // Convert camelCase or snake_case or kebab-case to Title Case
    clean = clean
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!clean) return '';
    // Capitalize each word (Title Case)
    clean = clean.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return clean.replace(/\blinked\s*in\b/gi, 'LinkedIn').replace(/\bgit\s*hub\b/gi, 'GitHub');
}

/**
 * Intelligently resolves the human-readable question label for any form element.
 * Checks associated labels, wrapping labels, ARIA tags, fieldsets, placeholders, and names.
 * @param {HTMLElement} element 
 * @param {Document|HTMLElement} [root=document] 
 * @returns {string}
 */
function resolveFieldLabel(element, root = (typeof document !== 'undefined' ? document : null)) {
    if (!element) return '';

    // 1. Explicit <label for="elementId">
    if (element.id && root && root.querySelector) {
        try {
            const escapedId = (typeof CSS !== 'undefined' && CSS.escape)
                ? CSS.escape(element.id)
                : element.id.replace(/([ #;&,.+*~\':"!^$[\]()=>|\/@])/g, '\\$1');
            const explicitLabel = root.querySelector(`label[for="${escapedId}"]`);
            if (explicitLabel) {
                const txt = cleanLabelText(explicitLabel.innerText || explicitLabel.textContent);
                if (txt) return txt;
            }
        } catch (_) {}
    }

    // 2. Ancestor <label> wrapping the element
    if (typeof element.closest === 'function') {
        const parentLabel = element.closest('label');
        if (parentLabel) {
            try {
                const clone = parentLabel.cloneNode(true);
                const embedded = clone.querySelectorAll('input, select, textarea, button');
                embedded.forEach(e => e.remove());
                const txt = cleanLabelText(clone.innerText || clone.textContent);
                if (txt) return txt;
            } catch (_) {
                const txt = cleanLabelText(parentLabel.innerText || parentLabel.textContent);
                if (txt) return txt;
            }
        }
    }

    // 3. ARIA attributes (aria-label, aria-labelledby)
    const ariaLabel = element.getAttribute ? element.getAttribute('aria-label') : null;
    if (ariaLabel && cleanLabelText(ariaLabel)) {
        return cleanLabelText(ariaLabel);
    }

    const ariaLabelledBy = element.getAttribute ? element.getAttribute('aria-labelledby') : null;
    if (ariaLabelledBy && root && root.querySelector) {
        try {
            const parts = ariaLabelledBy.split(/\s+/).map(id => {
                const target = root.getElementById ? root.getElementById(id) : null;
                return target ? target.innerText || target.textContent : '';
            }).filter(Boolean);
            const txt = cleanLabelText(parts.join(' '));
            if (txt) return txt;
        } catch (_) {}
    }

    // 4. Closest fieldset with <legend>
    if (typeof element.closest === 'function') {
        const fieldset = element.closest('fieldset');
        if (fieldset) {
            const legend = fieldset.querySelector('legend');
            if (legend) {
                const txt = cleanLabelText(legend.innerText || legend.textContent);
                if (txt) return txt;
            }
        }
    }

    // 5. Preceding sibling label or text
    let prev = element.previousElementSibling;
    while (prev) {
        if (prev.matches && (prev.matches('label') || prev.matches('[class*="label"]') || prev.matches('h1, h2, h3, h4, h5, h6, p, span, strong'))) {
            const txt = cleanLabelText(prev.innerText || prev.textContent);
            if (txt && txt.length < 80) return txt;
        }
        prev = prev.previousElementSibling;
    }

    // 6. Surrounding field container label (.form-group, .field, [class*="field"], [class*="form-group"])
    // Walk up ancestors (up to 5 levels) to find nearest label or container heading
    let ancestor = element.parentElement;
    let depth = 0;
    while (ancestor && depth < 5 && ancestor !== root && (ancestor.tagName || '').toLowerCase() !== 'body') {
        const headerEl = ancestor.querySelector('label, [class*="label"], [class*="title"], [class*="heading"], .legend, h3, h4, h5, h6, strong');
        if (headerEl && headerEl !== element && (!headerEl.contains || !headerEl.contains(element))) {
            const otherInputs = ancestor.querySelectorAll ? ancestor.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"]') : [];
            if (otherInputs.length <= 1 || otherInputs[0] === element) {
                const txt = cleanLabelText(headerEl.innerText || headerEl.textContent);
                if (txt && txt.length < 80) return txt;
            }
        }
        ancestor = ancestor.parentElement;
        depth++;
    }

    // 7. Placeholder attribute or inner placeholder (cleaned of instructional verbs)
    const placeholder = element.placeholder || 
                        (element.getAttribute ? element.getAttribute('placeholder') : null) ||
                        (element.querySelector ? element.querySelector('input[placeholder]')?.getAttribute('placeholder') : null) ||
                        (element.querySelector ? element.querySelector('.multiselect-placeholder, [class*="placeholder"]')?.innerText?.trim() : null);
    if (placeholder && cleanLabelText(placeholder)) {
        const cleaned = cleanPlaceholder(placeholder);
        if (cleaned) return cleaned;
    }

    // 8. Name attribute humanized
    const nameAttr = element.name || (element.getAttribute ? element.getAttribute('name') : null);
    if (nameAttr) {
        const humanized = humanizeFieldName(nameAttr);
        if (humanized && humanized.length < 50) return humanized;
    }

    // 9. Autocomplete attribute humanized
    const autoAttr = element.autocomplete || (element.getAttribute ? element.getAttribute('autocomplete') : null);
    if (autoAttr && autoAttr !== 'off' && autoAttr !== 'on') {
        const humanized = humanizeFieldName(autoAttr);
        if (humanized) return humanized;
    }

    // 10. Title attribute
    const titleAttr = element.title || (element.getAttribute ? element.getAttribute('title') : null);
    if (titleAttr && cleanLabelText(titleAttr)) {
        return cleanLabelText(titleAttr);
    }

    return '';
}

/**
 * Sets input / textarea / select values safely triggering React/Vue/Angular synthetic listeners.
 * @param {HTMLElement} element 
 * @param {string} value 
 */
function setNativeValue(element, value) {
    if (!element) return;
    try {
        element.focus();
    } catch (_) {}

    const tagName = element.tagName ? element.tagName.toLowerCase() : '';

    if (tagName === 'input' || tagName === 'textarea') {
        if (typeof window !== 'undefined') {
            const proto = tagName === 'input' ? window.HTMLInputElement?.prototype : window.HTMLTextAreaElement?.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(proto || {}, 'value');
            if (descriptor && descriptor.set) {
                descriptor.set.call(element, value);
            } else {
                element.value = value;
            }
        } else {
            element.value = value;
        }
    } else if (tagName === 'select') {
        const select = /** @type {HTMLSelectElement} */ (element);
        const targetVal = String(value).trim().toLowerCase();
        const options = [...(select.options || [])];

        // 1. Exact match by text or value
        let matchedIdx = options.findIndex(o => {
            const t = (o.text || '').trim().toLowerCase();
            const v = (o.value || '').trim().toLowerCase();
            return t === targetVal || v === targetVal;
        });

        // 2. Substring match
        if (matchedIdx === -1) {
            matchedIdx = options.findIndex(o => {
                const t = (o.text || '').trim().toLowerCase();
                return t && (t.includes(targetVal) || targetVal.includes(t));
            });
        }

        if (matchedIdx !== -1) {
            select.selectedIndex = matchedIdx;
        }
    }

    // Dispatch full suite of input events for framework reactivity
    try {
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    } catch (_) {}
}

// ---------------------------------------------------------------------------
// 2. Google Forms Adapter
// ---------------------------------------------------------------------------

const GoogleFormsAdapter = {
    name: 'Google Forms',

    canHandle(doc, url = '') {
        const isUrl = url.includes('docs.google.com/forms');
        if (isUrl) return true;
        if (!doc) return false;
        return !!(
            doc.querySelector('.freebirdFormviewerViewFormCard') ||
            doc.querySelector('.Qr7Oae') ||
            doc.querySelector('div[role="listitem"] .M7eMe')
        );
    },

    getFormTitle(doc) {
        if (!doc) return 'Google Form';
        const titleEl = doc.querySelector('div[role="heading"][aria-level="1"]') ||
                        doc.querySelector('.F9vQ8a, .ahS6Le, .v1CNqd') ||
                        doc.querySelector('div[role="heading"]');
        if (titleEl && titleEl.innerText && titleEl.innerText.trim()) {
            return titleEl.innerText.trim();
        }
        if (doc.title) {
            return doc.title.replace(/\s*-\s*Google Forms$/i, '').trim();
        }
        return 'Google Form';
    },

    getFormDescription(doc) {
        if (!doc) return '';
        const descEl = doc.querySelector('.cBDR0b, .freebirdFormviewerViewHeaderDescription, .D2CF4, .zAV2Fd') ||
                       doc.querySelector('div[role="heading"][aria-level="1"] + div');
        return descEl?.innerText?.trim() || '';
    },

    getQuestions(doc) {
        if (!doc) return [];
        const blocks = doc.querySelectorAll('.Qr7Oae, div[role="listitem"]');
        const questions = [];

        blocks.forEach((block, index) => {
            const titleEl = block.querySelector('.M7eMe') ||
                            block.querySelector('[role="heading"] span') ||
                            block.querySelector('div[role="heading"]');
            const qText = titleEl?.innerText?.trim();
            if (!qText) return;

            let type = 'text_input';
            if (block.querySelector('[role="checkbox"]')) type = 'checkbox';
            else if (block.querySelector('[role="listbox"]') || block.querySelector('.MocG8c')) type = 'dropdown';
            else if (block.querySelector('[role="radiogroup"]') && block.querySelectorAll('[role="radio"]').length > 5) type = 'scale';
            else if (block.querySelector('[role="radio"]') || block.querySelectorAll('label').length > 0) type = 'multiple_choice';

            const choices = [];
            if (type === 'multiple_choice' || type === 'checkbox') {
                const labels = [...block.querySelectorAll('label')];
                labels.forEach(label => {
                    const widget = label.querySelector('[role="radio"], [role="checkbox"]');
                    const val = widget ? widget.getAttribute('data-value') : null;
                    const txt = val || label.querySelector('span[dir="auto"]')?.innerText?.trim() || label.querySelector('span')?.innerText?.trim();
                    if (txt && !choices.includes(txt.trim())) choices.push(txt.trim());
                });
            } else if (type === 'dropdown') {
                const options = [...block.querySelectorAll('[role="option"], .MocG8c')];
                options.forEach(opt => {
                    const txt = opt.getAttribute('data-value') || opt.innerText?.trim();
                    if (txt && !choices.includes(txt) && txt !== 'Choose') choices.push(txt);
                });
            }

            questions.push({
                id: index,
                question: qText,
                type,
                choices,
                element: block,
                platform: 'google_forms'
            });
        });

        return questions;
    },

    isFieldFilled(q) {
        if (!q || !q.element) return false;
        const b = q.element;
        if (q.type === 'multiple_choice' || q.type === 'scale') {
            const checked = b.querySelector('[role="radio"][aria-checked="true"], input[type="radio"]:checked');
            return !!checked;
        }
        if (q.type === 'checkbox') {
            const checked = b.querySelector('[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked');
            return !!checked;
        }
        const textInput = b.querySelector('input[type="text"], input[type="email"], input[type="tel"], textarea');
        return !!(textInput && textInput.value && textInput.value.trim().length > 0);
    }
};

// ---------------------------------------------------------------------------
// 3. Greenhouse Adapter (Applicant Tracking System)
// ---------------------------------------------------------------------------

const GreenhouseAdapter = {
    name: 'Greenhouse',

    canHandle(doc, url = '') {
        if (url.includes('boards.greenhouse.io') || url.includes('job-boards.greenhouse.io')) return true;
        if (!doc) return false;
        return !!(doc.querySelector('form#application_form, div#application, #main.greenhouse'));
    },

    getFormTitle(doc) {
        if (!doc) return 'Job Application';
        const jobTitle = doc.querySelector('.app-title, .job-title, h1.heading, h1')?.innerText?.trim();
        const company = doc.querySelector('.company-name, .logo-container')?.innerText?.trim();
        if (jobTitle && company) return `${jobTitle} at ${company}`;
        if (jobTitle) return jobTitle;
        return doc.title?.replace(/[-–|].*$/, '').trim() || 'Job Application';
    },

    getFormDescription(doc) {
        if (!doc) return '';
        const desc = doc.querySelector('#content, .body, .job-description')?.innerText?.trim();
        return (desc || '').slice(0, 300);
    },

    getQuestions(doc) {
        if (!doc) return [];
        const questions = [];
        let idCounter = 0;

        // 1. Standard Greenhouse Core Fields
        const coreMappings = [
            { selector: '#first_name, input[name="job_application[first_name]"]', label: 'First Name', type: 'text_input' },
            { selector: '#last_name, input[name="job_application[last_name]"]', label: 'Last Name', type: 'text_input' },
            { selector: '#email, input[name="job_application[email]"]', label: 'Email', type: 'text_input' },
            { selector: '#phone, input[name="job_application[phone]"]', label: 'Phone', type: 'text_input' },
            { selector: 'input[autocomplete="custom-question-linkedin"], input[name*="linkedin"]', label: 'LinkedIn Profile', type: 'text_input' },
            { selector: 'input[autocomplete="custom-question-website"], input[name*="website"], input[name*="portfolio"]', label: 'Website / Portfolio', type: 'text_input' },
            { selector: 'input[name*="github"]', label: 'GitHub Profile', type: 'text_input' }
        ];

        const claimedElements = new Set();

        coreMappings.forEach(core => {
            const input = doc.querySelector(core.selector);
            if (input && !claimedElements.has(input)) {
                claimedElements.add(input);
                questions.push({
                    id: idCounter++,
                    question: core.label,
                    type: core.type,
                    choices: [],
                    element: input,
                    inputElements: [input],
                    required: !!input.required,
                    platform: 'greenhouse'
                });
            }
        });

        // 2. Custom Greenhouse Questions (.field, .application-question)
        const customContainers = doc.querySelectorAll('.field, .application-question, div[id^="custom_fields"]');
        customContainers.forEach(container => {
            const input = container.querySelector('input:not([type="hidden"]), select, textarea');
            if (!input || claimedElements.has(input)) return;
            claimedElements.add(input);

            const qText = resolveFieldLabel(input, container) || resolveFieldLabel(input, doc);
            if (!qText) return;

            const tag = input.tagName.toLowerCase();
            const inputType = (input.type || '').toLowerCase();

            let type = 'text_input';
            const choices = [];

            if (tag === 'select') {
                type = 'dropdown';
                const options = [...input.options];
                options.forEach(o => {
                    const txt = (o.text || '').trim();
                    if (txt && !choices.includes(txt) && !txt.match(/^(?:select|choose|--)/i)) {
                        choices.push(txt);
                    }
                });
            } else if (inputType === 'radio') {
                type = 'multiple_choice';
                const name = input.name;
                const radios = name ? [...container.querySelectorAll(`input[name="${name}"]`)] : [input];
                radios.forEach(r => {
                    claimedElements.add(r);
                    const optLabel = resolveFieldLabel(r, container);
                    if (optLabel && !choices.includes(optLabel)) choices.push(optLabel);
                });
            } else if (inputType === 'checkbox') {
                type = 'checkbox';
            }

            questions.push({
                id: idCounter++,
                question: qText,
                type,
                choices,
                element: container,
                inputElements: [input],
                required: !!input.required,
                platform: 'greenhouse'
            });
        });

        return questions;
    },

    isFieldFilled(q) {
        if (!q || !q.inputElements || q.inputElements.length === 0) return false;
        const el = q.inputElements[0];
        if (el.type === 'radio' || el.type === 'checkbox') {
            return q.inputElements.some(i => i.checked);
        }
        if (el.tagName.toLowerCase() === 'select') {
            return el.selectedIndex > 0 && !!el.value;
        }
        return !!(el.value && el.value.trim().length > 0);
    }
};

// ---------------------------------------------------------------------------
// 4. Lever Adapter (Applicant Tracking System)
// ---------------------------------------------------------------------------

const LeverAdapter = {
    name: 'Lever',

    canHandle(doc, url = '') {
        if (url.includes('jobs.lever.co')) return true;
        if (!doc) return false;
        return !!(doc.querySelector('form#posting-form, .application-form, .posting-headline'));
    },

    getFormTitle(doc) {
        if (!doc) return 'Job Application';
        const role = doc.querySelector('.posting-headline h2, .posting-header h2, h2')?.innerText?.trim();
        const company = doc.querySelector('.main-header-logo img')?.getAttribute('alt') || '';
        if (role && company) return `${role} at ${company}`;
        if (role) return role;
        return doc.title?.replace(/[-–|].*$/, '').trim() || 'Job Application';
    },

    getFormDescription(doc) {
        if (!doc) return '';
        const desc = doc.querySelector('.section-wrapper, .posting-description')?.innerText?.trim();
        return (desc || '').slice(0, 300);
    },

    getQuestions(doc) {
        if (!doc) return [];
        const questions = [];
        let idCounter = 0;
        const claimedElements = new Set();

        // 1. Core Lever Applicant Inputs
        const coreMappings = [
            { name: 'name', label: 'Full Name' },
            { name: 'email', label: 'Email' },
            { name: 'phone', label: 'Phone' },
            { name: 'org', label: 'Current Company' },
            { name: 'urls[LinkedIn]', label: 'LinkedIn Profile' },
            { name: 'urls[GitHub]', label: 'GitHub Profile' },
            { name: 'urls[Portfolio]', label: 'Portfolio / Website' },
            { name: 'urls[Twitter]', label: 'Twitter / X' }
        ];

        coreMappings.forEach(core => {
            const input = doc.querySelector(`input[name="${core.name}"]`);
            if (input && !claimedElements.has(input)) {
                claimedElements.add(input);
                questions.push({
                    id: idCounter++,
                    question: core.label,
                    type: 'text_input',
                    choices: [],
                    element: input,
                    inputElements: [input],
                    required: !!input.required,
                    platform: 'lever'
                });
            }
        });

        // 2. Custom Lever Application Questions (.application-question)
        const customBlocks = doc.querySelectorAll('.application-question, .custom-question');
        customBlocks.forEach(block => {
            const labelEl = block.querySelector('.application-label, label');
            const qText = cleanLabelText(labelEl?.innerText || labelEl?.textContent) || resolveFieldLabel(block, doc);
            if (!qText) return;

            const input = block.querySelector('input:not([type="hidden"]), select, textarea');
            if (!input || claimedElements.has(input)) return;

            const tag = input.tagName.toLowerCase();
            const inputType = (input.type || '').toLowerCase();

            let type = 'text_input';
            const choices = [];

            if (tag === 'select') {
                type = 'dropdown';
                [...input.options].forEach(o => {
                    const txt = (o.text || '').trim();
                    if (txt && !choices.includes(txt) && !txt.match(/^(?:select|choose|--)/i)) {
                        choices.push(txt);
                    }
                });
                claimedElements.add(input);
            } else if (inputType === 'radio') {
                type = 'multiple_choice';
                const radios = [...block.querySelectorAll('input[type="radio"]')];
                radios.forEach(r => {
                    claimedElements.add(r);
                    const optLabel = resolveFieldLabel(r, block);
                    if (optLabel && !choices.includes(optLabel)) choices.push(optLabel);
                });
            } else if (inputType === 'checkbox') {
                type = 'checkbox';
                const checkboxes = [...block.querySelectorAll('input[type="checkbox"]')];
                checkboxes.forEach(c => {
                    claimedElements.add(c);
                    const optLabel = resolveFieldLabel(c, block);
                    if (optLabel && !choices.includes(optLabel)) choices.push(optLabel);
                });
            } else {
                claimedElements.add(input);
            }

            questions.push({
                id: idCounter++,
                question: qText,
                type,
                choices,
                element: block,
                inputElements: [input],
                required: !!input.required,
                platform: 'lever'
            });
        });

        return questions;
    },

    isFieldFilled(q) {
        if (!q || !q.inputElements || q.inputElements.length === 0) return false;
        const el = q.inputElements[0];
        if (el.type === 'radio' || el.type === 'checkbox') {
            return q.inputElements.some(i => i.checked);
        }
        if (el.tagName.toLowerCase() === 'select') {
            return el.selectedIndex > 0 && !!el.value;
        }
        return !!(el.value && el.value.trim().length > 0);
    }
};

// ---------------------------------------------------------------------------
// 5. Generic Web Form / Job Board Adapter (Ashby, Workday, BambooHR, Standard HTML)
// ---------------------------------------------------------------------------

const GenericJobFormAdapter = {
    name: 'Generic Form / Job Board',

    canHandle(doc, url = '') {
        if (!doc) return false;
        if (url.includes('docs.google.com/forms')) return false;

        const fillableInputs = doc.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea, [role="combobox"], [aria-haspopup="listbox"], .multiselect'
        );
        return fillableInputs.length >= 1;
    },

    getFormTitle(doc) {
        if (!doc) return 'Web Form';
        const formHeader = doc.querySelector('form h1, form h2, .form-title, .application-title, h1, h2');
        if (formHeader && formHeader.innerText && formHeader.innerText.trim()) {
            return formHeader.innerText.trim();
        }
        return doc.title?.replace(/[-–|].*$/, '').trim() || 'Web Form';
    },

    getFormDescription(doc) {
        if (!doc) return '';
        const desc = doc.querySelector('form p, .form-description, .instructions, main p');
        return desc?.innerText?.trim().slice(0, 300) || '';
    },

    getQuestions(doc) {
        if (!doc) return [];
        const questions = [];
        let idCounter = 0;
        const processedElements = new Set();
        const processedRadioGroups = new Set();
        const processedCheckboxGroups = new Set();

        const searchRoot = doc.body || doc;
        const inputs = searchRoot.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea, [role="combobox"], [aria-haspopup="listbox"], .multiselect'
        );

        inputs.forEach(input => {
            if (processedElements.has(input)) return;

            const inputType = (input.type || '').toLowerCase();
            const tagName = (input.tagName || '').toLowerCase();
            const role = input.getAttribute ? (input.getAttribute('role') || '') : '';
            const isCombobox = role === 'combobox' ||
                (input.getAttribute && input.getAttribute('aria-haspopup') === 'listbox') ||
                (input.className && typeof input.className === 'string' && input.className.includes('multiselect'));

            if (inputType === 'search') return;
            if (input.closest && input.closest('nav, header, footer, [role="search"], .search-form, #search')) return;

            // A. Radio Buttons
            if (inputType === 'radio') {
                const groupName = input.name || (input.closest && input.closest('fieldset')?.id) || 'radio_group';
                if (processedRadioGroups.has(groupName)) return;
                processedRadioGroups.add(groupName);

                const groupInputs = groupName !== 'radio_group'
                    ? [...searchRoot.querySelectorAll(`input[type="radio"][name="${groupName}"]`)]
                    : [input];

                groupInputs.forEach(r => processedElements.add(r));

                const fieldset = input.closest ? input.closest('fieldset') : null;
                let qText = fieldset?.querySelector('legend')?.innerText?.trim();
                if (!qText && input.closest) {
                    const container = input.closest('.form-group, .field, [class*="field"], div');
                    qText = container?.querySelector('label, [class*="label"], [class*="title"]')?.innerText?.trim();
                }
                if (!qText) qText = resolveFieldLabel(input, searchRoot);
                if (!qText) qText = humanizeFieldName(groupName);

                const choices = [];
                groupInputs.forEach(r => {
                    const choiceLabel = resolveFieldLabel(r, searchRoot) || (r.getAttribute && r.getAttribute('aria-label')) || r.value;
                    if (choiceLabel && !choices.includes(choiceLabel)) choices.push(choiceLabel);
                });

                questions.push({
                    id: idCounter++,
                    question: qText || 'Multiple Choice',
                    type: 'multiple_choice',
                    choices,
                    element: fieldset || input.parentElement || input,
                    inputElements: groupInputs,
                    required: groupInputs.some(r => r.required),
                    platform: 'generic'
                });
                return;
            }

            // B. Checkbox
            if (inputType === 'checkbox') {
                const groupName = input.name;
                const groupInputs = (groupName && searchRoot.querySelectorAll(`input[type="checkbox"][name="${groupName}"]`).length > 1)
                    ? [...searchRoot.querySelectorAll(`input[type="checkbox"][name="${groupName}"]`)]
                    : null;

                if (groupInputs && !processedCheckboxGroups.has(groupName)) {
                    processedCheckboxGroups.add(groupName);
                    groupInputs.forEach(c => processedElements.add(c));

                    const fieldset = input.closest ? input.closest('fieldset') : null;
                    let qText = fieldset?.querySelector('legend')?.innerText?.trim() || resolveFieldLabel(input, searchRoot) || humanizeFieldName(groupName);

                    const choices = [];
                    groupInputs.forEach(c => {
                        const choiceLabel = resolveFieldLabel(c, searchRoot) || (c.getAttribute && c.getAttribute('aria-label')) || c.value;
                        if (choiceLabel && !choices.includes(choiceLabel)) choices.push(choiceLabel);
                    });

                    questions.push({
                        id: idCounter++,
                        question: qText,
                        type: 'checkbox',
                        choices,
                        element: fieldset || input.parentElement || input,
                        inputElements: groupInputs,
                        required: groupInputs.some(c => c.required),
                        platform: 'generic'
                    });
                    return;
                }

                // Standalone single checkbox
                processedElements.add(input);
                const qText = resolveFieldLabel(input, searchRoot);
                if (!qText) return;

                questions.push({
                    id: idCounter++,
                    question: qText,
                    type: 'checkbox',
                    choices: ['Yes', 'No'],
                    element: input.parentElement || input,
                    inputElements: [input],
                    required: !!input.required,
                    platform: 'generic'
                });
                return;
            }

            // C. Native Select OR Custom Combobox / Multiselect
            if (tagName === 'select' || isCombobox) {
                processedElements.add(input);
                // Also mark inner/parent inputs
                if (input.querySelectorAll) {
                    input.querySelectorAll('input').forEach(i => processedElements.add(i));
                }
                const parentCombobox = input.closest ? input.closest('[role="combobox"], .multiselect') : null;
                if (parentCombobox) processedElements.add(parentCombobox);

                const targetCombobox = parentCombobox || input;
                const qText = resolveFieldLabel(targetCombobox, searchRoot) || resolveFieldLabel(input, searchRoot);
                if (!qText) return;

                const choices = [];
                if (tagName === 'select') {
                    [...(input.options || [])].forEach(opt => {
                        const txt = (opt.text || '').trim();
                        if (txt && !choices.includes(txt) && !txt.match(/^(?:select|choose|--)/i)) {
                            choices.push(txt);
                        }
                    });
                } else if (input.querySelectorAll) {
                    const optionEls = input.querySelectorAll('[role="option"], .multiselect-option, .select__option');
                    optionEls.forEach(opt => {
                        const txt = (opt.innerText || opt.textContent || '').trim();
                        if (txt && !choices.includes(txt)) choices.push(txt);
                    });
                }

                questions.push({
                    id: idCounter++,
                    question: qText,
                    type: 'dropdown',
                    choices,
                    element: targetCombobox || input.parentElement || input,
                    inputElements: [targetCombobox],
                    required: !!input.required,
                    platform: 'generic'
                });
                return;
            }

            // D. Standard Text, Textarea, Email, Tel, URL, Date, Number
            processedElements.add(input);
            const qText = resolveFieldLabel(input, searchRoot);
            if (!qText) return;

            questions.push({
                id: idCounter++,
                question: qText,
                type: 'text_input',
                choices: [],
                element: input.parentElement || input,
                inputElements: [input],
                required: !!input.required,
                subType: inputType || 'text',
                platform: 'generic'
            });
        });

        return questions;
    },

    isFieldFilled(q) {
        if (!q || !q.inputElements || q.inputElements.length === 0) return false;
        const el = q.inputElements[0];
        if (el.type === 'radio' || el.type === 'checkbox') {
            return q.inputElements.some(i => i.checked);
        }
        if (el.tagName && el.tagName.toLowerCase() === 'select') {
            return el.selectedIndex > 0 && !!el.value;
        }
        // Custom combobox / multiselect detection
        const container = (el.closest && el.closest('.multiselect, [role="combobox"], [aria-haspopup="listbox"]')) || el;
        if (container.classList && (container.classList.contains('has-selected') || container.classList.contains('is-selected'))) {
            return true;
        }
        const selectedLabel = container.querySelector ? container.querySelector('.multiselect-single-label, .multiselect-tag, .select__single-value, [aria-selected="true"]') : null;
        if (selectedLabel && (selectedLabel.innerText || selectedLabel.textContent || '').trim().length > 0) {
            return true;
        }
        return !!(el.value && String(el.value).trim().length > 0);
    }
};

// ---------------------------------------------------------------------------
// 6. Universal Form Engine Orchestrator
// ---------------------------------------------------------------------------

const FormEngine = {
    adapters: [
        GoogleFormsAdapter,
        GreenhouseAdapter,
        LeverAdapter,
        GenericJobFormAdapter
    ],

    getActiveAdapter(doc = (typeof document !== 'undefined' ? document : null), url = (typeof window !== 'undefined' ? window.location.href : '')) {
        for (const adapter of this.adapters) {
            if (adapter.canHandle(doc, url)) {
                return adapter;
            }
        }
        return null;
    },

    isFormPresent(doc = (typeof document !== 'undefined' ? document : null), url = (typeof window !== 'undefined' ? window.location.href : '')) {
        const adapter = this.getActiveAdapter(doc, url);
        if (!adapter) return false;
        const questions = adapter.getQuestions(doc);
        return questions.length > 0;
    },

    getQuestions(doc = (typeof document !== 'undefined' ? document : null), url = (typeof window !== 'undefined' ? window.location.href : '')) {
        const adapter = this.getActiveAdapter(doc, url);
        return adapter ? adapter.getQuestions(doc) : [];
    },

    async extractChoices(question, doc = (typeof document !== 'undefined' ? document : null)) {
        if (!question || question.type !== 'dropdown') return [];
        if (question.choices && question.choices.length > 0) return question.choices;

        const inputs = question.inputElements || (question.element ? [question.element] : []);
        if (inputs.length === 0) return [];
        const el = inputs[0];

        // 1. Native <select> or inner <select>
        if (el.tagName && el.tagName.toLowerCase() === 'select') {
            const choices = [];
            [...(el.options || [])].forEach(opt => {
                const txt = (opt.text || '').trim();
                if (txt && !choices.includes(txt) && !txt.match(/^(?:select|choose|--)/i)) {
                    choices.push(txt);
                }
            });
            return choices;
        }

        const innerSelect = el.querySelector ? el.querySelector('select') : null;
        if (innerSelect) {
            const choices = [];
            [...(innerSelect.options || [])].forEach(opt => {
                const txt = (opt.text || '').trim();
                if (txt && !choices.includes(txt) && !txt.match(/^(?:select|choose|--)/i)) {
                    choices.push(txt);
                }
            });
            if (choices.length > 0) return choices;
        }

        // 2. Custom Combobox / Multiselect: Open it to trigger reactive render/fetch
        const container = (el.closest && el.closest('.multiselect, [role="combobox"], [aria-haspopup="listbox"], .select, .form-group')) || el;
        const trigger = (container.querySelector && container.querySelector('.multiselect-wrapper, [role="combobox"], [aria-haspopup="listbox"], button, .select__control')) || container;

        const createSafeMouseEvt = (type) => {
            if (typeof MouseEvent !== 'undefined') {
                try {
                    return new MouseEvent(type, { bubbles: true, cancelable: true, view: (typeof window !== 'undefined' ? window : null) });
                } catch (_) {}
            }
            if (typeof Event !== 'undefined') {
                try {
                    return new Event(type, { bubbles: true, cancelable: true });
                } catch (_) {}
            }
            return { type, bubbles: true, cancelable: true };
        };

        try {
            if (typeof trigger.focus === 'function') trigger.focus();
            trigger.dispatchEvent(createSafeMouseEvt('mousedown'));
            trigger.dispatchEvent(createSafeMouseEvt('mouseup'));
            trigger.dispatchEvent(createSafeMouseEvt('click'));
        } catch (_) {}

        // Wait 120ms for DOM/API data rendering
        await new Promise(r => setTimeout(r, 120));

        // Scan for options in container and open dropdown portals
        const optionContainers = [
            container,
            ...(doc && doc.querySelectorAll ? [...doc.querySelectorAll('.multiselect-dropdown, [role="listbox"], .select__menu, .ant-select-dropdown, div[id$="-dropdown"]')] : [])
        ];

        const choices = [];
        for (const c of optionContainers) {
            if (!c || !c.querySelectorAll) continue;
            const options = c.querySelectorAll('[role="option"], .multiselect-option, .select__option, .ant-select-item-option, li');
            for (const opt of options) {
                const optText = (opt.innerText || opt.textContent || '').trim();
                if (optText && !choices.includes(optText) && !optText.match(/^(?:select|choose|--|no options)/i)) {
                    choices.push(optText);
                }
            }
            if (choices.length > 0) break;
        }

        return choices;
    },

    async fillAnswer(question, answer, doc = (typeof document !== 'undefined' ? document : null)) {
        if (!question || answer === undefined || answer === null) return false;

        if (question.platform === 'google_forms' && typeof globalThis.fillGoogleFormAnswer === 'function') {
            return await globalThis.fillGoogleFormAnswer(question.element, answer, question.type);
        }

        const inputs = question.inputElements || (question.element ? [question.element] : []);
        if (inputs.length === 0) return false;

        const targetAnswer = Array.isArray(answer) ? answer : [String(answer)];
        const normalizedAnswers = targetAnswer.map(a => a.trim().toLowerCase());

        // Multiple Choice / Radio
        if (question.type === 'multiple_choice') {
            for (const radio of inputs) {
                const label = resolveFieldLabel(radio, doc).toLowerCase();
                const val = (radio.value || '').toLowerCase();
                if (normalizedAnswers.some(ans => ans === label || label.includes(ans) || ans === val)) {
                    radio.checked = true;
                    setNativeValue(radio, radio.value);
                    if (typeof radio.click === 'function') radio.click();
                    return true;
                }
            }
            if (inputs.length > 0) {
                inputs[0].checked = true;
                setNativeValue(inputs[0], inputs[0].value);
                if (typeof inputs[0].click === 'function') inputs[0].click();
                return true;
            }
            return false;
        }

        // Checkbox Multi-Select
        if (question.type === 'checkbox') {
            let anyChecked = false;
            for (const checkbox of inputs) {
                const label = resolveFieldLabel(checkbox, doc).toLowerCase();
                const val = (checkbox.value || '').toLowerCase();
                const shouldCheck = normalizedAnswers.some(ans => {
                    return ans === 'yes' || ans === 'true' || ans === label || label.includes(ans) || ans === val;
                });

                if (shouldCheck && !checkbox.checked) {
                    checkbox.checked = true;
                    setNativeValue(checkbox, checkbox.value);
                    if (typeof checkbox.click === 'function') checkbox.click();
                    anyChecked = true;
                }
            }
            return anyChecked;
        }

        // Dropdown / Select / Combobox
        if (question.type === 'dropdown') {
            const el = inputs[0];
            const val = targetAnswer[0];
            if (!el) return false;

            // 1. Native <select> or inner <select>
            if (el.tagName && el.tagName.toLowerCase() === 'select') {
                setNativeValue(el, val);
                return true;
            }
            const innerSelect = el.querySelector ? el.querySelector('select') : null;
            if (innerSelect) {
                setNativeValue(innerSelect, val);
                return true;
            }

            // 2. Custom Combobox / Multiselect (@vueform/multiselect, React-Select, Headless UI, etc.)
            const container = (el.closest && el.closest('.multiselect, [role="combobox"], [aria-haspopup="listbox"], .select, .form-group')) || el;
            const trigger = (container.querySelector && container.querySelector('.multiselect-wrapper, [role="combobox"], [aria-haspopup="listbox"], button, .select__control')) || container;

            const createSafeMouseEvt = (type) => {
                if (typeof MouseEvent !== 'undefined') {
                    try {
                        return new MouseEvent(type, { bubbles: true, cancelable: true, view: (typeof window !== 'undefined' ? window : null) });
                    } catch (_) {}
                }
                if (typeof Event !== 'undefined') {
                    try {
                        return new Event(type, { bubbles: true, cancelable: true });
                    } catch (_) {}
                }
                return { type, bubbles: true, cancelable: true };
            };

            const createSafeKeyEvt = (type, key = 'Enter', code = 'Enter', keyCode = 13) => {
                if (typeof KeyboardEvent !== 'undefined') {
                    try {
                        return new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true });
                    } catch (_) {}
                }
                if (typeof Event !== 'undefined') {
                    try {
                        const ev = new Event(type, { bubbles: true, cancelable: true });
                        ev.key = key;
                        ev.code = code;
                        ev.keyCode = keyCode;
                        ev.which = keyCode;
                        return ev;
                    } catch (_) {}
                }
                return { type, key, code, keyCode, which: keyCode, bubbles: true, cancelable: true };
            };

            // Step A: Focus & open dropdown trigger (triggers reactive fetch / options rendering)
            try {
                if (typeof trigger.focus === 'function') trigger.focus();
                trigger.dispatchEvent(createSafeMouseEvt('mousedown'));
                trigger.dispatchEvent(createSafeMouseEvt('mouseup'));
                trigger.dispatchEvent(createSafeMouseEvt('click'));
            } catch (_) {}

            // Wait 120ms for DOM/state updates
            await new Promise(r => setTimeout(r, 120));

            // Step B: Type query into search input if present
            const searchInput = (container.querySelector && container.querySelector('input.multiselect-search, input[role="combobox"], input:not([type="hidden"])')) || 
                                (el.tagName && el.tagName.toLowerCase() === 'input' ? el : null);

            if (searchInput) {
                try {
                    if (typeof searchInput.focus === 'function') searchInput.focus();
                } catch (_) {}
                setNativeValue(searchInput, val);
                await new Promise(r => setTimeout(r, 100));
            }

            // Step C: Look for matching option element in both container & document body/portal
            const targetLower = String(val).trim().toLowerCase();
            const optionContainers = [
                container,
                ...(doc && doc.querySelectorAll ? [...doc.querySelectorAll('.multiselect-dropdown, [role="listbox"], .select__menu, .ant-select-dropdown, div[id$="-dropdown"]')] : [])
            ];

            let matchedOption = null;
            let bestScore = -1;

            const deptAliases = (typeof DEPARTMENT_ALIASES !== 'undefined' ? DEPARTMENT_ALIASES : (globalThis.MemoryRetriever?.DEPARTMENT_ALIASES || {}));
            const degAliases = (typeof DEGREE_ALIASES !== 'undefined' ? DEGREE_ALIASES : (globalThis.MemoryRetriever?.DEGREE_ALIASES || {}));

            for (const c of optionContainers) {
                if (!c || !c.querySelectorAll) continue;
                const options = c.querySelectorAll('[role="option"], .multiselect-option, .select__option, .ant-select-item-option, li');
                for (const opt of options) {
                    const optText = (opt.innerText || opt.textContent || '').trim().toLowerCase();
                    if (!optText) continue;

                    let score = 0;
                    if (optText === targetLower) {
                        score = 100;
                    } else if (optText.startsWith(targetLower) || targetLower.startsWith(optText)) {
                        score = 80;
                    } else if (optText.includes(targetLower) || targetLower.includes(optText)) {
                        score = 70;
                    }

                    // Check department / degree aliases
                    const aliases = deptAliases[targetLower] || degAliases[targetLower] || [];
                    for (const alias of aliases) {
                        if (optText === alias) {
                            score = Math.max(score, 95);
                            break;
                        } else if (optText.includes(alias) || alias.includes(optText)) {
                            score = Math.max(score, 75);
                        }
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        matchedOption = opt;
                    }
                    if (bestScore === 100) break;
                }
                if (bestScore === 100) break;
            }

            // Step D: Dispatch selection events on matched option
            if (matchedOption && bestScore >= 60) {
                try {
                    matchedOption.dispatchEvent(createSafeMouseEvt('mouseenter'));
                    matchedOption.dispatchEvent(createSafeMouseEvt('mouseover'));
                    matchedOption.dispatchEvent(createSafeMouseEvt('mousedown'));
                    matchedOption.dispatchEvent(createSafeMouseEvt('mouseup'));
                    matchedOption.dispatchEvent(createSafeMouseEvt('click'));
                } catch (_) {}
                await new Promise(r => setTimeout(r, 80));
            } else if (searchInput) {
                // Step E: Fallback to Enter key if option element not found in DOM
                try {
                    searchInput.dispatchEvent(createSafeKeyEvt('keydown', 'Enter', 'Enter', 13));
                    searchInput.dispatchEvent(createSafeKeyEvt('keypress', 'Enter', 'Enter', 13));
                    searchInput.dispatchEvent(createSafeKeyEvt('keyup', 'Enter', 'Enter', 13));
                } catch (_) {}
            }

            // Step F: Close / Blur
            try {
                if (searchInput && typeof searchInput.blur === 'function') searchInput.blur();
                if (container && typeof container.blur === 'function') container.blur();
            } catch (_) {}

            return true;
        }

        // Text Input / Textarea
        const input = inputs[0];
        setNativeValue(input, targetAnswer[0]);
        return true;
    }
};

// ---------------------------------------------------------------------------
// 7. Universal Exports (Browser + Node.js)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        cleanLabelText,
        humanizeFieldName,
        resolveFieldLabel,
        setNativeValue,
        GoogleFormsAdapter,
        GreenhouseAdapter,
        LeverAdapter,
        GenericJobFormAdapter,
        FormEngine
    };
}

if (typeof globalThis !== 'undefined') {
    globalThis.AutoFormEngine = FormEngine;
    globalThis.GoogleFormsAdapter = GoogleFormsAdapter;
    globalThis.GreenhouseAdapter = GreenhouseAdapter;
    globalThis.LeverAdapter = LeverAdapter;
    globalThis.GenericJobFormAdapter = GenericJobFormAdapter;
}
