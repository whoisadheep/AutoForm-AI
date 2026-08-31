/**
 * @file server/src/providers/base.js
 * @description Base utilities and prompt builders for AI provider adapters.
 */

/**
 * Builds a robust, standardized prompt for solving form questions.
 * @param {Object} params
 * @param {string} params.question - The question prompt
 * @param {string} params.type - 'multiple_choice', 'checkbox', 'text_input', 'dropdown', 'scale'
 * @param {string[]} [params.choices] - List of available options
 * @param {string} [params.customContext] - Optional user background (e.g., "I am a high school student")
 * @param {string} [params.tone] - 'accurate', 'concise', 'detailed'
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function buildPrompt({ question, type, choices = [], customContext = '', tone = 'accurate' }) {
    const systemPrompt = `You are AutoForm AI, an intelligent and precise assistant specialized in accurately completing forms, quizzes, surveys, and assessments.
Your task is to analyze form questions and return strictly a valid JSON object matching the required format.`;

    let instructions = '';
    let choicesText = '';

    if (type === 'checkbox') {
        choicesText = choices.length > 0 
            ? `AVAILABLE OPTIONS:\n${choices.map((c, i) => `${i + 1}. "${c}"`).join('\n')}`
            : 'No explicit options provided.';
        instructions = `This is a multi-select question (checkbox). Select all choices that apply.
Return a JSON array of exact option strings under "answers".
Format: {"answers": ["Exact Option A", "Exact Option B"]}`;
    } else if (choices && choices.length > 0) {
        choicesText = `AVAILABLE OPTIONS:\n${choices.map((c, i) => `${i + 1}. "${c}"`).join('\n')}`;
        instructions = `This is a single-select question. Select EXACTLY ONE matching option from the list above.
Do not modify or rephrase the option text.
Format: {"answer": "Exact option string"}`;
    } else {
        choicesText = 'Open-ended text input.';
        const lengthGuidance = tone === 'concise' 
            ? 'Keep the answer very short and direct (1-2 sentences).'
            : tone === 'detailed'
            ? 'Provide a comprehensive and well-explained answer (2-4 paragraphs).'
            : 'Provide a clear, accurate, and natural response.';
        instructions = `Provide an appropriate and accurate written answer. ${lengthGuidance}
Format: {"answer": "Your text response here"}`;
    }

    const contextPart = customContext ? `\nUSER CONTEXT / PREFERENCE: "${customContext}"\n` : '';

    const userPrompt = `QUESTION: "${question}"
TYPE: ${type}
${contextPart}
${choicesText}

INSTRUCTIONS:
${instructions}
Ensure the output is ONLY a valid JSON object without markdown fences.`;

    return { systemPrompt, userPrompt };
}

/**
 * Extracts and parses a JSON response from an AI model output string.
 * @param {string} rawText 
 * @param {string} type 
 * @returns {{ answer?: string, answers?: string[] }}
 */
function parseAiResponse(rawText, type) {
    if (!rawText || typeof rawText !== 'string') {
        throw new Error('Empty response from AI model');
    }

    const clean = rawText.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);

    if (!match) {
        // Fallback if model returned plain text instead of JSON
        if (type === 'checkbox') {
            return { answers: [clean.split('\n')[0].trim()] };
        }
        return { answer: clean };
    }

    const parsed = JSON.parse(match[0]);
    if (type === 'checkbox' && parsed.answers && Array.isArray(parsed.answers)) {
        return { answers: parsed.answers.map(String) };
    }

    if (parsed.answer !== undefined) {
        return { answer: String(parsed.answer).trim() };
    }

    if (parsed.answers && Array.isArray(parsed.answers)) {
        return { answer: String(parsed.answers[0]).trim() };
    }

    throw new Error('JSON response does not contain "answer" or "answers" key');
}

/**
 * Round-robin key selector for a provider with multiple keys.
 */
class KeyRotator {
    constructor(keys = []) {
        this.keys = keys;
        this.index = 0;
    }

    getKey() {
        if (!this.keys || this.keys.length === 0) return null;
        const key = this.keys[this.index % this.keys.length];
        this.index = (this.index + 1) % this.keys.length;
        return key;
    }

    hasKeys() {
        return this.keys && this.keys.length > 0;
    }
}

module.exports = {
    buildPrompt,
    parseAiResponse,
    KeyRotator
};
