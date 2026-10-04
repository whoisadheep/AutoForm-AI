/**
 * @file server/tests/previewConfidence.test.js
 * @description Unit tests for Preview Before Fill confidence scoring and AI response parsing.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompt, parseAiResponse } = require('../src/providers/base');

describe('Preview Mode — Prompt Builder & Response Parsing', () => {
    it('injects confidence assessment guidance into buildPrompt', () => {
        const { systemPrompt, userPrompt } = buildPrompt({
            question: 'Which of the following is NOT an HTTP method?',
            type: 'multiple_choice',
            choices: ['GET', 'POST', 'FETCH', 'DELETE']
        });

        assert.ok(systemPrompt.includes('AutoForm AI'));
        assert.ok(userPrompt.includes('CONFIDENCE EVALUATION'));
        assert.ok(userPrompt.includes('"confidence"'));
    });

    it('defaults confidence to high when model does not specify confidence', () => {
        const rawJson = '{"answer": "Nitrogen"}';
        const parsed = parseAiResponse(rawJson, 'multiple_choice', ['Nitrogen', 'Oxygen']);

        assert.equal(parsed.answer, 'Nitrogen');
        assert.equal(parsed.confidence, 'high');
        assert.equal(parsed.reasoning, '');
    });

    it('extracts explicit confidence and reasoning from AI response', () => {
        const rawJson = JSON.stringify({
            answer: "502 Bad Gateway",
            confidence: "medium",
            reasoning: "Question uses negative trick phrasing (NOT a client error)"
        });
        const parsed = parseAiResponse(rawJson, 'multiple_choice', ['400 Bad Request', '502 Bad Gateway']);

        assert.equal(parsed.answer, '502 Bad Gateway');
        assert.equal(parsed.confidence, 'medium');
        assert.equal(parsed.reasoning, 'Question uses negative trick phrasing (NOT a client error)');
    });

    it('parses multi-select checkbox responses with confidence metadata', () => {
        const rawJson = JSON.stringify({
            answers: ["2", "13"],
            confidence: "high",
            reasoning: "2 and 13 are prime numbers; 9 and 21 are composite"
        });
        const parsed = parseAiResponse(rawJson, 'checkbox', ['2', '9', '13', '21']);

        assert.deepEqual(parsed.answers, ['2', '13']);
        assert.equal(parsed.confidence, 'high');
        assert.equal(parsed.reasoning, '2 and 13 are prime numbers; 9 and 21 are composite');
    });
});

describe('Preview Mode — Confidence Evaluation Heuristics', () => {
    // Replicating evaluateAnswerConfidence rules for unit test verification
    function evaluateConfidence(q, solution) {
        if (!solution) return { confidence: 'low', isUnsure: true, reason: 'No solution' };
        if (solution.provider === 'instant_profile') {
            return { confidence: 'high', isUnsure: false, reason: 'Verified Personal Profile fact' };
        }
        const qText = (q.question || '').toLowerCase();
        const negativeTrickRegex = /\b(not|except|neither|nor|false|incorrect|least|never|none of the above|exclude|excluding)\b/i;
        if (negativeTrickRegex.test(qText)) {
            return { confidence: 'low', isUnsure: true, reason: 'Negative trick question detected' };
        }
        const criticalRegex = /\b(salary|compensation|expected ctc|hourly rate|authorized to work|work authorization|visa sponsorship|require sponsorship|relocate|felony|criminal|veteran|disability status|ssn|social security)\b/i;
        if (criticalRegex.test(qText)) {
            return { confidence: 'medium', isUnsure: true, reason: 'Critical personal/legal preference' };
        }
        if (q.type === 'text_input' && (!solution.retrievedSnippetIds || solution.retrievedSnippetIds.length === 0)) {
            if (/\b(why|explain|describe|tell me about|how would you)\b/i.test(qText) || (q.isLongInput)) {
                return { confidence: 'medium', isUnsure: true, reason: 'AI-generated response without memory snippet' };
            }
        }
        if (solution.confidence === 'low' || solution.confidence === 'medium') {
            return { confidence: solution.confidence, isUnsure: true, reason: solution.reasoning || 'AI uncertainty' };
        }
        return { confidence: 'high', isUnsure: false, reason: 'High confidence match' };
    }

    it('marks instant profile direct matches as high confidence and verified', () => {
        const q = { question: 'Full Name', type: 'text_input' };
        const solution = { answer: 'Alex Rivera', provider: 'instant_profile' };
        const result = evaluateConfidence(q, solution);

        assert.equal(result.confidence, 'high');
        assert.equal(result.isUnsure, false);
    });

    it('flags negative trick questions (NOT, EXCEPT, LEAST) as unsure', () => {
        const q = { question: 'Which of the following HTTP status codes is NOT a client-side error?', type: 'multiple_choice' };
        const solution = { answer: '502 Bad Gateway', provider: 'groq' };
        const result = evaluateConfidence(q, solution);

        assert.equal(result.isUnsure, true);
        assert.ok(result.reason.includes('Negative'));
    });

    it('flags critical legal and compensation preferences as unsure for human review', () => {
        const q = { question: 'What is your expected salary / compensation for this role?', type: 'text_input' };
        const solution = { answer: '$120,000', provider: 'gemini' };
        const result = evaluateConfidence(q, solution);

        assert.equal(result.isUnsure, true);
        assert.ok(result.reason.includes('Critical'));
    });

    it('flags open-ended essays without matching memory snippets as unsure', () => {
        const q = { question: 'Explain the fundamental difference between a Process and a Thread in 1-2 sentences.', type: 'text_input', isLongInput: true };
        const solution = { answer: 'A process is an independent executing program with its own memory space...', provider: 'groq', retrievedSnippetIds: [] };
        const result = evaluateConfidence(q, solution);

        assert.equal(result.isUnsure, true);
        assert.ok(result.reason.includes('without memory snippet'));
    });

    it('keeps standard verified factual multiple choice questions as high confidence', () => {
        const q = { question: 'What is the primary gas found in Earth atmosphere?', type: 'multiple_choice' };
        const solution = { answer: 'Nitrogen', provider: 'groq', confidence: 'high' };
        const result = evaluateConfidence(q, solution);

        assert.equal(result.confidence, 'high');
        assert.equal(result.isUnsure, false);
    });
});
