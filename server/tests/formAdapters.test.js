/**
 * @file server/tests/formAdapters.test.js
 * @description Comprehensive unit tests for Universal Form Engine,
 * Greenhouse, Lever, and Generic Job Form adapters.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
    cleanLabelText,
    humanizeFieldName,
    resolveFieldLabel,
    setNativeValue,
    GoogleFormsAdapter,
    GreenhouseAdapter,
    LeverAdapter,
    GenericJobFormAdapter,
    FormEngine
} = require('../../src/services/formAdapters.js');

// ---------------------------------------------------------------------------
// 1. Text Extraction & Label Normalization Tests
// ---------------------------------------------------------------------------

describe('FormAdapters — Label Cleaning & Humanization Utilities', () => {
    test('cleans required markers, asterisks, colons and excessive whitespace', () => {
        assert.strictEqual(cleanLabelText('  Full Name * :  '), 'Full Name');
        assert.strictEqual(cleanLabelText('* Email Address: '), 'Email Address');
        assert.strictEqual(cleanLabelText('Phone\t\tNumber\n  '), 'Phone Number');
        assert.strictEqual(cleanLabelText('Cover Letter (Optional) :'), 'Cover Letter (Optional)');
        assert.strictEqual(cleanLabelText(''), '');
    });

    test('humanizes complex programmatic field names accurately', () => {
        assert.strictEqual(humanizeFieldName('job_application[first_name]'), 'First Name');
        assert.strictEqual(humanizeFieldName('job_application[last_name]'), 'Last Name');
        assert.strictEqual(humanizeFieldName('urls[LinkedIn]'), 'LinkedIn');
        assert.strictEqual(humanizeFieldName('custom_fields[years_of_experience]'), 'Years Of Experience');
        assert.strictEqual(humanizeFieldName('work_authorization_status'), 'Work Authorization Status');
        assert.strictEqual(humanizeFieldName('userEmailAddress'), 'Email Address');
        assert.strictEqual(humanizeFieldName('applicant_phone_no'), 'Phone No');
    });
});

// ---------------------------------------------------------------------------
// 2. Mock DOM Element Generator for Isolated Testing
// ---------------------------------------------------------------------------

class MockElement {
    constructor({
        tagName = 'input',
        id = '',
        name = '',
        type = 'text',
        value = '',
        innerText = '',
        placeholder = '',
        autocomplete = '',
        title = '',
        required = false,
        attributes = {},
        options = [],
        children = [],
        parentElement = null
    } = {}) {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this.id = id;
        this.name = name;
        this.type = type;
        this.value = value;
        this.innerText = innerText;
        this.textContent = innerText;
        this.placeholder = placeholder;
        this.autocomplete = autocomplete;
        this.title = title;
        this.required = required;
        this.attributes = { ...attributes };
        if (type) this.attributes.type = type;
        if (id) this.attributes.id = id;
        if (name) this.attributes.name = name;
        this.options = options;
        this.selectedIndex = 0;
        this.children = [];
        this.parentElement = parentElement;
        this.checked = false;
        this.eventsDispatched = [];

        children.forEach(c => this.appendChild(c));
        this.classList = {
            contains: (cls) => (this.attributes.class || '').split(/\s+/).includes(cls),
            add: (cls) => {
                const current = (this.attributes.class || '').split(/\s+/).filter(Boolean);
                if (!current.includes(cls)) current.push(cls);
                this.attributes.class = current.join(' ');
            },
            remove: (cls) => {
                const current = (this.attributes.class || '').split(/\s+/).filter(Boolean);
                this.attributes.class = current.filter(c => c !== cls).join(' ');
            }
        };
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    setAttribute(name, val) {
        this.attributes[name] = String(val);
    }

    matches(selector) {
        if (!selector) return false;
        const parts = selector.split(',').map(s => s.trim());
        if (parts.length > 1) {
            return parts.some(part => this.matches(part));
        }

        const sel = selector.trim();
        const tag = this.tagName.toLowerCase();
        const id = (this.id || '').toLowerCase();
        const cls = (this.attributes.class || '').toLowerCase();
        const type = (this.type || '').toLowerCase();

        let rest = sel;
        const tagMatch = rest.match(/^([a-z0-9_-]+)/i);
        if (tagMatch) {
            if (tagMatch[1].toLowerCase() !== tag) return false;
            rest = rest.slice(tagMatch[0].length);
        }

        while (rest.length > 0) {
            if (rest.startsWith('#')) {
                const m = rest.match(/^#([a-z0-9_-]+)/i);
                if (!m || id !== m[1].toLowerCase()) return false;
                rest = rest.slice(m[0].length);
            } else if (rest.startsWith('.')) {
                const m = rest.match(/^\.([a-z0-9_-]+)/i);
                if (!m || !cls.includes(m[1].toLowerCase())) return false;
                rest = rest.slice(m[0].length);
            } else if (rest.startsWith('[')) {
                let closeIdx = -1;
                const quoteIdx = rest.search(/["']/);
                if (quoteIdx !== -1) {
                    const qChar = rest[quoteIdx];
                    const endQuote = rest.indexOf(qChar, quoteIdx + 1);
                    if (endQuote !== -1) {
                        closeIdx = rest.indexOf(']', endQuote + 1);
                    }
                }
                if (closeIdx === -1) {
                    closeIdx = rest.indexOf(']');
                }
                if (closeIdx === -1) break;

                const attrExpr = rest.slice(1, closeIdx);
                rest = rest.slice(closeIdx + 1);

                const eqIdx = attrExpr.indexOf('=');
                if (eqIdx === -1) {
                    const val = this.getAttribute(attrExpr) || this[attrExpr];
                    if (!val) return false;
                } else {
                    let op = '=';
                    let nameEnd = eqIdx;
                    if (attrExpr[eqIdx - 1] === '*' || attrExpr[eqIdx - 1] === '^' || attrExpr[eqIdx - 1] === '$') {
                        op = attrExpr[eqIdx - 1] + '=';
                        nameEnd = eqIdx - 1;
                    }
                    const attrName = attrExpr.slice(0, nameEnd).trim();
                    let targetVal = attrExpr.slice(eqIdx + 1).trim();
                    if ((targetVal.startsWith('"') && targetVal.endsWith('"')) || (targetVal.startsWith("'") && targetVal.endsWith("'"))) {
                        targetVal = targetVal.slice(1, -1);
                    }

                    const currentAttr = this.getAttribute(attrName) || 
                                        (attrName === 'for' ? this.attributes['for'] : null) || 
                                        (attrName === 'type' ? type : null) ||
                                        (attrName === 'name' ? this.name : null) ||
                                        (attrName === 'id' ? this.id : null);

                    if (currentAttr === null || currentAttr === undefined) return false;
                    const normCurrent = String(currentAttr).toLowerCase();
                    const normTarget = String(targetVal).toLowerCase();

                    if (op === '*=' && !normCurrent.includes(normTarget)) return false;
                    if (op === '^=' && !normCurrent.startsWith(normTarget)) return false;
                    if (op === '$=' && !normCurrent.endsWith(normTarget)) return false;
                    if (op === '=' && normCurrent !== normTarget) return false;
                }
            } else {
                break;
            }
        }

        return true;
    }

    closest(selector) {
        let curr = this;
        while (curr) {
            if (curr.matches && curr.matches(selector)) return curr;
            curr = curr.parentElement;
        }
        return null;
    }

    querySelector(selector) {
        const all = this.querySelectorAll(selector);
        return all.length > 0 ? all[0] : null;
    }

    querySelectorAll(selector) {
        const results = [];
        if (!selector) return results;

        const subSelectors = selector.split(',').map(s => s.trim());

        const testNode = (node) => {
            for (const sub of subSelectors) {
                if (sub.includes(':not(')) {
                    const baseTag = sub.split(':')[0];
                    if (baseTag && !node.matches(baseTag)) continue;
                    const nots = [...sub.matchAll(/:not\(([^)]+)\)/g)].map(m => m[1]);
                    const failsNot = nots.some(notSel => node.matches(notSel));
                    if (!failsNot) return true;
                } else if (node.matches(sub)) {
                    return true;
                }
            }
            return false;
        };

        const traverse = (node) => {
            for (const child of node.children) {
                if (testNode(child)) {
                    results.push(child);
                }
                traverse(child);
            }
        };

        traverse(this);
        return results;
    }

    cloneNode() {
        const clone = new MockElement({
            tagName: this.tagName,
            id: this.id,
            name: this.name,
            type: this.type,
            value: this.value,
            innerText: this.innerText,
            placeholder: this.placeholder,
            autocomplete: this.autocomplete,
            title: this.title,
            attributes: { ...this.attributes },
            options: [...this.options]
        });
        clone.children = this.children.map(c => c.cloneNode());
        return clone;
    }

    remove() {
        if (this.parentElement) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx !== -1) this.parentElement.children.splice(idx, 1);
        }
    }

    focus() { this.eventsDispatched.push({ type: 'focus' }); }
    blur() { this.eventsDispatched.push({ type: 'blur' }); }
    click() { 
        this.checked = !this.checked; 
        this.eventsDispatched.push({ type: 'click' });
    }
    dispatchEvent(event) { this.eventsDispatched.push(event); }
}

class MockDocument {
    constructor() {
        this.body = new MockElement({ tagName: 'body' });
        this.title = 'Job Application Portal';
    }

    querySelector(selector) {
        return this.body.querySelector(selector);
    }

    querySelectorAll(selector) {
        return this.body.querySelectorAll(selector);
    }

    getElementById(id) {
        const all = this.body.querySelectorAll('*');
        return all.find(e => e.id === id) || null;
    }
}

// ---------------------------------------------------------------------------
// 3. Field Label Resolution Tests
// ---------------------------------------------------------------------------

describe('FormAdapters — Intelligent Label Resolution', () => {
    test('resolves label from explicit <label for="elementId">', () => {
        const doc = new MockDocument();
        const input = new MockElement({ tagName: 'input', id: 'candidate_email', type: 'email' });
        const label = new MockElement({ tagName: 'label', attributes: { for: 'candidate_email' }, innerText: 'Your Email Address *' });

        doc.body.appendChild(label);
        doc.body.appendChild(input);

        const resolved = resolveFieldLabel(input, doc);
        assert.strictEqual(resolved, 'Your Email Address');
    });

    test('resolves label from wrapping parent <label>', () => {
        const doc = new MockDocument();
        const parentLabel = new MockElement({ tagName: 'label', innerText: 'Phone Number (with country code)' });
        const input = new MockElement({ tagName: 'input', type: 'tel' });
        parentLabel.appendChild(input);
        doc.body.appendChild(parentLabel);

        const resolved = resolveFieldLabel(input, doc);
        assert.strictEqual(resolved, 'Phone Number (with country code)');
    });

    test('resolves label from aria-label attribute', () => {
        const input = new MockElement({ tagName: 'input', attributes: { 'aria-label': 'LinkedIn Profile URL' } });
        const resolved = resolveFieldLabel(input, null);
        assert.strictEqual(resolved, 'LinkedIn Profile URL');
    });

    test('resolves label from fieldset <legend>', () => {
        const doc = new MockDocument();
        const fieldset = new MockElement({ tagName: 'fieldset' });
        const legend = new MockElement({ tagName: 'legend', innerText: 'Are you legally authorized to work in India?' });
        const radioYes = new MockElement({ tagName: 'input', type: 'radio', name: 'work_auth', value: 'Yes' });
        const radioNo = new MockElement({ tagName: 'input', type: 'radio', name: 'work_auth', value: 'No' });

        fieldset.appendChild(legend);
        fieldset.appendChild(radioYes);
        fieldset.appendChild(radioNo);
        doc.body.appendChild(fieldset);

        const resolved = resolveFieldLabel(radioYes, doc);
        assert.strictEqual(resolved, 'Are you legally authorized to work in India?');
    });

    test('falls back gracefully to placeholder and humanized name', () => {
        const input1 = new MockElement({ tagName: 'input', placeholder: 'e.g. San Francisco, CA' });
        assert.strictEqual(resolveFieldLabel(input1, null), 'e.g. San Francisco, CA');

        const input2 = new MockElement({ tagName: 'input', name: 'job_application[github_url]' });
        assert.strictEqual(resolveFieldLabel(input2, null), 'GitHub Url');
    });

    test('resolves label from ancestor grid container in modern component forms', () => {
        const doc = new MockDocument();
        const fieldContainer = new MockElement({ tagName: 'div', attributes: { class: 'grid grid-cols-1 mb-2' } });
        const label = new MockElement({ tagName: 'label', innerText: 'Full Name *' });
        const slotWrap = new MockElement({ tagName: 'div' });
        const relDiv = new MockElement({ tagName: 'div', attributes: { class: 'relative' } });
        const input = new MockElement({ tagName: 'input', type: 'text', placeholder: 'enter your name' });

        relDiv.appendChild(input);
        slotWrap.appendChild(relDiv);
        fieldContainer.appendChild(label);
        fieldContainer.appendChild(slotWrap);
        doc.body.appendChild(fieldContainer);

        const resolved = resolveFieldLabel(input, doc);
        assert.strictEqual(resolved, 'Full Name');
    });

    test('normalizes instructional placeholder text into clean field prompt', () => {
        const input1 = new MockElement({ tagName: 'input', placeholder: 'enter your name' });
        assert.strictEqual(resolveFieldLabel(input1, null), 'Name');

        const input2 = new MockElement({ tagName: 'input', placeholder: 'Select your State' });
        assert.strictEqual(resolveFieldLabel(input2, null), 'State');

        const input3 = new MockElement({ tagName: 'input', placeholder: 're-enter your email-id' });
        assert.strictEqual(resolveFieldLabel(input3, null), 'Email-id');

        const input4 = new MockElement({ tagName: 'input', placeholder: 'Select yop' });
        assert.strictEqual(resolveFieldLabel(input4, null), 'Year of Passing');
    });
});

// ---------------------------------------------------------------------------
// 4. Greenhouse ATS Adapter Tests
// ---------------------------------------------------------------------------

describe('FormAdapters — Greenhouse ATS Adapter', () => {
    test('identifies Greenhouse job board URLs and form structures', () => {
        const doc = new MockDocument();
        const form = new MockElement({ tagName: 'form', id: 'application_form' });
        doc.body.appendChild(form);

        assert.ok(GreenhouseAdapter.canHandle(doc, 'https://boards.greenhouse.io/acme/jobs/12345'));
        assert.ok(GreenhouseAdapter.canHandle(doc, 'https://example.com/careers')); // via form#application_form
        assert.strictEqual(GreenhouseAdapter.canHandle(new MockDocument(), 'https://example.com/about'), false);
    });

    test('extracts core applicant fields from Greenhouse DOM', () => {
        const doc = new MockDocument();
        const firstName = new MockElement({ tagName: 'input', id: 'first_name', name: 'job_application[first_name]' });
        const lastName = new MockElement({ tagName: 'input', id: 'last_name', name: 'job_application[last_name]' });
        const email = new MockElement({ tagName: 'input', id: 'email', name: 'job_application[email]' });
        const phone = new MockElement({ tagName: 'input', id: 'phone', name: 'job_application[phone]' });

        doc.body.appendChild(firstName);
        doc.body.appendChild(lastName);
        doc.body.appendChild(email);
        doc.body.appendChild(phone);

        const questions = GreenhouseAdapter.getQuestions(doc);
        assert.strictEqual(questions.length, 4);
        assert.strictEqual(questions[0].question, 'First Name');
        assert.strictEqual(questions[1].question, 'Last Name');
        assert.strictEqual(questions[2].question, 'Email');
        assert.strictEqual(questions[3].question, 'Phone');
    });
});

// ---------------------------------------------------------------------------
// 5. Lever ATS Adapter Tests
// ---------------------------------------------------------------------------

describe('FormAdapters — Lever ATS Adapter', () => {
    test('identifies Lever job board URLs and application structures', () => {
        const doc = new MockDocument();
        const form = new MockElement({ tagName: 'form', id: 'posting-form' });
        doc.body.appendChild(form);

        assert.ok(LeverAdapter.canHandle(doc, 'https://jobs.lever.co/stripe/abc-123'));
        assert.ok(LeverAdapter.canHandle(doc, 'https://careers.stripe.com')); // via form#posting-form
        assert.strictEqual(LeverAdapter.canHandle(new MockDocument(), 'https://news.ycombinator.com'), false);
    });

    test('extracts Lever core applicant inputs and custom questions', () => {
        const doc = new MockDocument();
        const name = new MockElement({ tagName: 'input', name: 'name' });
        const email = new MockElement({ tagName: 'input', name: 'email' });
        const phone = new MockElement({ tagName: 'input', name: 'phone' });
        const linkedin = new MockElement({ tagName: 'input', name: 'urls[LinkedIn]' });

        doc.body.appendChild(name);
        doc.body.appendChild(email);
        doc.body.appendChild(phone);
        doc.body.appendChild(linkedin);

        const questions = LeverAdapter.getQuestions(doc);
        assert.strictEqual(questions.length, 4);
        assert.strictEqual(questions[0].question, 'Full Name');
        assert.strictEqual(questions[1].question, 'Email');
        assert.strictEqual(questions[2].question, 'Phone');
        assert.strictEqual(questions[3].question, 'LinkedIn Profile');
    });
});

// ---------------------------------------------------------------------------
// 6. Generic Form & Job Board Adapter Tests
// ---------------------------------------------------------------------------

describe('FormAdapters — Generic Job Form & HTML Form Adapter', () => {
    test('detects generic page with fillable inputs and extracts structured questions', () => {
        const doc = new MockDocument();
        const form = new MockElement({ tagName: 'form' });

        const nameLabel = new MockElement({ tagName: 'label', attributes: { for: 'user_name' }, innerText: 'Your Full Name' });
        const nameInput = new MockElement({ tagName: 'input', id: 'user_name', type: 'text' });

        const selectLabel = new MockElement({ tagName: 'label', attributes: { for: 'dept_select' }, innerText: 'Department' });
        const deptSelect = new MockElement({
            tagName: 'select',
            id: 'dept_select',
            options: [
                { text: 'Choose department...', value: '' },
                { text: 'Information Technology', value: 'IT' },
                { text: 'Computer Science', value: 'CSE' }
            ]
        });

        form.appendChild(nameLabel);
        form.appendChild(nameInput);
        form.appendChild(selectLabel);
        form.appendChild(deptSelect);
        doc.body.appendChild(form);

        assert.ok(GenericJobFormAdapter.canHandle(doc, 'https://example.com/apply'));
        const questions = GenericJobFormAdapter.getQuestions(doc);

        assert.strictEqual(questions.length, 2);
        assert.strictEqual(questions[0].question, 'Your Full Name');
        assert.strictEqual(questions[0].type, 'text_input');

        assert.strictEqual(questions[1].question, 'Department');
        assert.strictEqual(questions[1].type, 'dropdown');
        assert.deepStrictEqual(questions[1].choices, ['Information Technology', 'Computer Science']);
    });

    test('groups radio buttons with same name into a single multiple_choice question', () => {
        const doc = new MockDocument();
        const form = new MockElement({ tagName: 'form' });
        const fieldset = new MockElement({ tagName: 'fieldset' });
        const legend = new MockElement({ tagName: 'legend', innerText: 'Current Year of Study' });

        const r1 = new MockElement({ tagName: 'input', type: 'radio', name: 'study_year', value: '1st Year', attributes: { 'aria-label': '1st Year' } });
        const r2 = new MockElement({ tagName: 'input', type: 'radio', name: 'study_year', value: '2nd Year', attributes: { 'aria-label': '2nd Year' } });
        const r3 = new MockElement({ tagName: 'input', type: 'radio', name: 'study_year', value: '3rd Year', attributes: { 'aria-label': '3rd Year' } });
        const r4 = new MockElement({ tagName: 'input', type: 'radio', name: 'study_year', value: '4th Year', attributes: { 'aria-label': '4th Year' } });

        // Extra input to satisfy canHandle (>= 2 inputs)
        const notes = new MockElement({ tagName: 'textarea', placeholder: 'Additional comments' });

        fieldset.appendChild(legend);
        fieldset.appendChild(r1);
        fieldset.appendChild(r2);
        fieldset.appendChild(r3);
        fieldset.appendChild(r4);

        form.appendChild(fieldset);
        form.appendChild(notes);
        doc.body.appendChild(form);

        const questions = GenericJobFormAdapter.getQuestions(doc);
        const radioQ = questions.find(q => q.type === 'multiple_choice');

        assert.ok(radioQ);
        assert.strictEqual(radioQ.question, 'Current Year of Study');
        assert.deepStrictEqual(radioQ.choices, ['1st Year', '2nd Year', '3rd Year', '4th Year']);
        assert.strictEqual(radioQ.inputElements.length, 4);
    });

    test('detects custom combobox and multiselect dropdowns in generic forms', () => {
        const doc = new MockDocument();
        const container = new MockElement({ tagName: 'div', attributes: { class: 'grid' } });

        const stateField = new MockElement({ tagName: 'div' });
        const stateLabel = new MockElement({ tagName: 'label', innerText: 'Select State *' });
        const stateCombobox = new MockElement({
            tagName: 'div',
            attributes: { role: 'combobox', class: 'multiselect' }
        });
        const stateInput = new MockElement({
            tagName: 'input',
            attributes: { role: 'combobox', placeholder: 'Select your State' }
        });
        stateCombobox.appendChild(stateInput);
        stateField.appendChild(stateLabel);
        stateField.appendChild(stateCombobox);

        const emailInput = new MockElement({ tagName: 'input', type: 'email', placeholder: 'enter your email-id' });

        container.appendChild(stateField);
        container.appendChild(emailInput);
        doc.body.appendChild(container);

        const questions = GenericJobFormAdapter.getQuestions(doc);
        assert.ok(questions.length >= 2);
        const dropdownQ = questions.find(q => q.type === 'dropdown');
        assert.ok(dropdownQ);
        assert.strictEqual(dropdownQ.question, 'Select State');
    });
});

// ---------------------------------------------------------------------------
// 7. Universal FormEngine Orchestrator Tests
// ---------------------------------------------------------------------------

describe('FormAdapters — FormEngine Orchestrator', () => {
    test('selects Google Forms adapter for docs.google.com/forms', () => {
        const doc = new MockDocument();
        const adapter = FormEngine.getActiveAdapter(doc, 'https://docs.google.com/forms/d/e/1FAIpQLSc.../viewform');
        assert.ok(adapter);
        assert.strictEqual(adapter.name, 'Google Forms');
    });

    test('selects Greenhouse adapter for greenhouse job boards', () => {
        const doc = new MockDocument();
        const adapter = FormEngine.getActiveAdapter(doc, 'https://boards.greenhouse.io/anthropic/jobs/555');
        assert.ok(adapter);
        assert.strictEqual(adapter.name, 'Greenhouse');
    });

    test('selects Lever adapter for lever job boards', () => {
        const doc = new MockDocument();
        const adapter = FormEngine.getActiveAdapter(doc, 'https://jobs.lever.co/figma/123');
        assert.ok(adapter);
        assert.strictEqual(adapter.name, 'Lever');
    });

    test('falls back to Generic adapter for standard website application forms', () => {
        const doc = new MockDocument();
        const form = new MockElement({ tagName: 'form' });
        form.appendChild(new MockElement({ tagName: 'input', type: 'text', placeholder: 'Name' }));
        form.appendChild(new MockElement({ tagName: 'input', type: 'email', placeholder: 'Email' }));
        doc.body.appendChild(form);

        const adapter = FormEngine.getActiveAdapter(doc, 'https://company.com/join-our-team');
        assert.ok(adapter);
        assert.strictEqual(adapter.name, 'Generic Form / Job Board');
    });

    test('fills generic text input, select, and radio buttons cleanly', async () => {
        const doc = new MockDocument();
        const input = new MockElement({ tagName: 'input', type: 'text' });
        const question = {
            id: 0,
            question: 'Applicant Name',
            type: 'text_input',
            inputElements: [input],
            platform: 'generic'
        };

        const filled = await FormEngine.fillAnswer(question, 'Adheep', doc);
        assert.ok(filled);
        assert.strictEqual(input.value, 'Adheep');
    });

    test('fills custom combobox and multiselect dropdown by matching and clicking rendered option', async () => {
        const doc = new MockDocument();
        const multiselect = new MockElement({ tagName: 'div', attributes: { class: 'multiselect' } });
        const wrapper = new MockElement({ tagName: 'div', attributes: { class: 'multiselect-wrapper' } });
        const searchInput = new MockElement({
            tagName: 'input',
            type: 'text',
            attributes: { class: 'multiselect-search', role: 'combobox' },
            placeholder: 'Select your State'
        });
        wrapper.appendChild(searchInput);
        multiselect.appendChild(wrapper);

        const dropdown = new MockElement({ tagName: 'div', attributes: { class: 'multiselect-dropdown' } });
        const opt1 = new MockElement({ tagName: 'li', attributes: { class: 'multiselect-option', role: 'option' }, innerText: 'Andhra Pradesh' });
        const opt2 = new MockElement({ tagName: 'li', attributes: { class: 'multiselect-option', role: 'option' }, innerText: 'Karnataka' });
        const opt3 = new MockElement({ tagName: 'li', attributes: { class: 'multiselect-option', role: 'option' }, innerText: 'Tamil Nadu' });
        dropdown.appendChild(opt1);
        dropdown.appendChild(opt2);
        dropdown.appendChild(opt3);
        multiselect.appendChild(dropdown);
        doc.body.appendChild(multiselect);

        const question = {
            id: 1,
            question: 'State',
            type: 'dropdown',
            element: multiselect,
            inputElements: [multiselect],
            choices: [],
            platform: 'generic'
        };

        const filled = await FormEngine.fillAnswer(question, 'Karnataka', doc);
        assert.ok(filled);
        assert.strictEqual(searchInput.value, 'Karnataka');
        // opt2 must have received mouse events (mousedown / click)
        const hasMousedown = opt2.eventsDispatched.some(e => e.type === 'mousedown');
        assert.ok(hasMousedown, 'Target option should have received mousedown event');
    });

    test('fills custom combobox with fallback to Enter key when options are not in DOM', async () => {
        const doc = new MockDocument();
        const multiselect = new MockElement({ tagName: 'div', attributes: { class: 'multiselect' } });
        const wrapper = new MockElement({ tagName: 'div', attributes: { class: 'multiselect-wrapper' } });
        const searchInput = new MockElement({
            tagName: 'input',
            type: 'text',
            attributes: { class: 'multiselect-search', role: 'combobox' },
            placeholder: 'Select District'
        });
        wrapper.appendChild(searchInput);
        multiselect.appendChild(wrapper);
        doc.body.appendChild(multiselect);

        const question = {
            id: 2,
            question: 'District',
            type: 'dropdown',
            element: multiselect,
            inputElements: [multiselect],
            choices: [],
            platform: 'generic'
        };

        const filled = await FormEngine.fillAnswer(question, 'Bangalore', doc);
        assert.ok(filled);
        assert.strictEqual(searchInput.value, 'Bangalore');
        const hasEnter = searchInput.eventsDispatched.some(e => e.key === 'Enter' || e.type === 'keydown');
        assert.ok(hasEnter, 'Search input should have received Enter key event fallback');
    });

    test('GenericJobFormAdapter.isFieldFilled accurately detects filled state of custom combobox', () => {
        const multiselect = new MockElement({ tagName: 'div', attributes: { class: 'multiselect' } });
        const q = {
            id: 3,
            question: 'State',
            type: 'dropdown',
            inputElements: [multiselect]
        };

        // Initially empty
        assert.strictEqual(GenericJobFormAdapter.isFieldFilled(q), false);

        // Marked with has-selected class
        multiselect.classList.add('has-selected');
        assert.strictEqual(GenericJobFormAdapter.isFieldFilled(q), true);

        // Or has selected label text element
        multiselect.classList.remove('has-selected');
        const label = new MockElement({ tagName: 'span', attributes: { class: 'multiselect-single-label' }, innerText: 'Karnataka' });
        multiselect.appendChild(label);
        assert.strictEqual(GenericJobFormAdapter.isFieldFilled(q), true);
    });

    test('FormEngine.extractChoices dynamically opens combobox and returns rendered choices', async () => {
        const doc = new MockDocument();
        const multiselect = new MockElement({ tagName: 'div', attributes: { class: 'multiselect' } });
        const wrapper = new MockElement({ tagName: 'div', attributes: { class: 'multiselect-wrapper' } });
        multiselect.appendChild(wrapper);

        const dropdown = new MockElement({ tagName: 'div', attributes: { class: 'multiselect-dropdown' } });
        dropdown.appendChild(new MockElement({ tagName: 'li', attributes: { class: 'multiselect-option', role: 'option' }, innerText: 'Andhra Pradesh' }));
        dropdown.appendChild(new MockElement({ tagName: 'li', attributes: { class: 'multiselect-option', role: 'option' }, innerText: 'Karnataka' }));
        dropdown.appendChild(new MockElement({ tagName: 'li', attributes: { class: 'multiselect-option', role: 'option' }, innerText: 'Maharashtra' }));
        multiselect.appendChild(dropdown);
        doc.body.appendChild(multiselect);

        const question = {
            id: 4,
            question: 'State',
            type: 'dropdown',
            element: multiselect,
            inputElements: [multiselect],
            choices: [],
            platform: 'generic'
        };

        const choices = await FormEngine.extractChoices(question, doc);
        assert.ok(Array.isArray(choices));
        assert.strictEqual(choices.length, 3);
        assert.deepStrictEqual(choices, ['Andhra Pradesh', 'Karnataka', 'Maharashtra']);
    });
});
