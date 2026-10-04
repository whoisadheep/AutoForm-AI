/**
 * @file server/tests/resumeUpload.test.js
 * @description Automated test suite for AutoForm AI Smart Resume Vault & Auto-Attach.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');

// Import utilities
const {
    createFileFromDataUrl,
    cleanExtractedText,
    parseResumeStructure
} = require('../../src/services/resumeExtractor');

const {
    buildPrompt,
    buildResumeParsePrompt,
    parseAiResponse
} = require('../src/providers/base');

const {
    GreenhouseAdapter,
    LeverAdapter,
    GenericJobFormAdapter,
    FormEngine
} = require('../../src/services/formAdapters');

describe('Resume Extractor — Client-Side Parsing & Structure Extraction', () => {
    const sampleResumeText = `
Alex Rivera
alex.rivera@example.com | +1 (555) 019-2834 | San Francisco, CA
https://github.com/alexrivera | https://linkedin.com/in/alex-rivera | https://alexrivera.dev

EDUCATION
University of California, Berkeley
Bachelor of Science in Computer Science & Engineering
Expected Graduation: 2026 | GPA: 3.90 | Final Year Student

WORK EXPERIENCE
Software Engineering Intern - Acme Cloud Systems (May 2025 - Aug 2025)
- Designed and deployed high-throughput distributed microservices using Go and Docker.
- Reduced server response latency by 35% across 2 million daily active users.

TECHNICAL PROJECTS
AutoForm AI - Universal Form Filler (Oct 2024 - Present)
- Architected multi-provider AI proxy with Groq, Gemini, and NVIDIA failover.
- Implemented client-side hybrid RAG memory retriever with BM25 ranking.

SKILLS
Programming: TypeScript, Python, Go, C++, Rust
Technologies: React, Node.js, Docker, Kubernetes, AWS, PostgreSQL
`;

    it('extracts candidate full name, email, phone, and location', () => {
        const profile = parseResumeStructure(sampleResumeText, 'Alex_Rivera_Resume.pdf');
        assert.strictEqual(profile.identity.fullName, 'Alex Rivera');
        assert.strictEqual(profile.identity.email, 'alex.rivera@example.com');
        assert.ok(profile.identity.phone.includes('555'));
        assert.strictEqual(profile.identity.location, 'San Francisco, CA');
    });

    it('extracts GitHub, LinkedIn, and Portfolio links accurately', () => {
        const profile = parseResumeStructure(sampleResumeText, 'Alex_Rivera_Resume.pdf');
        assert.strictEqual(profile.links.github, 'https://github.com/alexrivera');
        assert.strictEqual(profile.links.linkedin, 'https://linkedin.com/in/alex-rivera');
        assert.strictEqual(profile.links.portfolio, 'https://alexrivera.dev');
    });

    it('extracts university, degree, major, graduation year, and GPA', () => {
        const profile = parseResumeStructure(sampleResumeText, 'Alex_Rivera_Resume.pdf');
        assert.ok(profile.education.university.includes('California'));
        assert.ok(profile.education.degree.toLowerCase().includes('bachelor'));
        assert.strictEqual(profile.education.graduationYear, '2026');
        assert.strictEqual(profile.education.gpa, '3.90');
    });

    it('generates tagged memory snippets for experience, projects, and skills', () => {
        const profile = parseResumeStructure(sampleResumeText, 'Alex_Rivera_Resume.pdf');
        assert.ok(profile.snippets.length >= 3, 'Should extract at least 3 snippets');

        const exp = profile.snippets.find(s => s.category === 'experience');
        assert.ok(exp, 'Should contain an experience snippet');
        assert.ok(exp.content.includes('Acme Cloud Systems'));

        const proj = profile.snippets.find(s => s.category === 'project');
        assert.ok(proj, 'Should contain a project snippet');
        assert.ok(proj.content.includes('AutoForm AI'));

        const skill = profile.snippets.find(s => s.category === 'skill');
        assert.ok(skill, 'Should contain a skill snippet');
        assert.ok(skill.content.includes('TypeScript'));
    });

    it('reconstructs valid binary file/blob from base64 Data URL', () => {
        const fakeDataUrl = 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCg==';
        const file = createFileFromDataUrl(fakeDataUrl, 'My_Resume.pdf', 'application/pdf');
        assert.strictEqual(file.name, 'My_Resume.pdf');
        assert.strictEqual(file.type, 'application/pdf');
        assert.ok(file.size > 0);
    });

    it('cleans extracted text and normalizes whitespace', () => {
        const messy = 'Hello\\(World\\)\r\n\r\n\t  Test   String  ';
        const cleaned = cleanExtractedText(messy);
        assert.strictEqual(cleaned, 'Hello(World)\nTest String');
    });
});

describe('Resume Parsing — Server Prompt Builder & AI Response Parser', () => {
    it('builds a specialized resume extraction prompt in buildResumeParsePrompt', () => {
        const { systemPrompt, userPrompt } = buildResumeParsePrompt('Sample resume text');
        assert.ok(systemPrompt.includes('Resume Intelligence Parser'));
        assert.ok(systemPrompt.includes('"identity"'));
        assert.ok(systemPrompt.includes('"snippets"'));
        assert.ok(userPrompt.includes('Sample resume text'));
    });

    it('buildPrompt delegates to buildResumeParsePrompt when type is resume_parse', () => {
        const { systemPrompt, userPrompt } = buildPrompt({
            type: 'resume_parse',
            resumeText: 'Jane Doe | Software Engineer'
        });
        assert.ok(systemPrompt.includes('Resume Intelligence Parser'));
        assert.ok(userPrompt.includes('Jane Doe'));
    });

    it('parseAiResponse parses JSON resume profile correctly', () => {
        const mockAiJson = JSON.stringify({
            identity: {
                fullName: 'Jane Doe',
                email: 'jane@example.com'
            },
            links: {
                github: 'https://github.com/janedoe'
            },
            education: {
                university: 'MIT',
                graduationYear: '2025'
            },
            snippets: [
                {
                    category: 'experience',
                    title: 'Engineer at Stripe',
                    content: 'Built payment flows',
                    tags: ['payments']
                }
            ]
        });

        const res = parseAiResponse(mockAiJson, 'resume_parse');
        assert.strictEqual(res.confidence, 'high');
        assert.ok(res.profile);
        assert.strictEqual(res.profile.identity.fullName, 'Jane Doe');
        assert.strictEqual(res.profile.education.university, 'MIT');
        assert.strictEqual(res.profile.snippets.length, 1);
    });
});

describe('Form Adapters — Resume & File Upload Question Detection', () => {
    // Minimal mock DOM element
    function createMockElement(tagName, attrs = {}, textContent = '') {
        const el = {
            tagName: tagName.toUpperCase(),
            type: attrs.type || '',
            name: attrs.name || '',
            id: attrs.id || '',
            accept: attrs.accept || '',
            required: !!attrs.required,
            className: attrs.class || '',
            innerText: textContent,
            textContent: textContent,
            files: [],
            getAttribute(attr) { return attrs[attr] || null; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            closest() { return null; }
        };
        return el;
    }

    it('detects file inputs with resume labels in GenericJobFormAdapter', () => {
        const mockFileInput = createMockElement('input', {
            type: 'file',
            id: 'resume_upload',
            name: 'applicant_resume',
            accept: '.pdf,.doc'
        });

        const mockDoc = {
            body: {
                querySelectorAll(selector) {
                    if (selector.includes('input')) return [mockFileInput];
                    return [];
                },
                querySelector() { return null; }
            }
        };

        const questions = GenericJobFormAdapter.getQuestions(mockDoc);
        assert.strictEqual(questions.length, 1);
        assert.strictEqual(questions[0].type, 'file_upload');
        assert.strictEqual(questions[0].subType, 'resume');
    });

    it('GenericJobFormAdapter.isFieldFilled accurately checks file inputs', () => {
        const emptyFileInput = createMockElement('input', { type: 'file' });
        emptyFileInput.files = [];
        assert.strictEqual(GenericJobFormAdapter.isFieldFilled({ inputElements: [emptyFileInput] }), false);

        const filledFileInput = createMockElement('input', { type: 'file' });
        filledFileInput.files = [{ name: 'resume.pdf', size: 1024 }];
        assert.strictEqual(GenericJobFormAdapter.isFieldFilled({ inputElements: [filledFileInput] }), true);
    });
});
