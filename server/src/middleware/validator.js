/**
 * @file server/src/middleware/validator.js
 * @description Input validation and optional API secret authentication.
 */

const config = require('../config');

function validateSolveRequest(req, res, next) {
    // Optional secret key check (if API_SECRET_KEY is configured)
    if (config.apiSecretKey) {
        const clientSecret = req.headers['x-api-key'] || req.body?.secretKey;
        if (clientSecret !== config.apiSecretKey) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized: Invalid or missing API secret key'
            });
        }
    }

    const { question, type } = req.body || {};

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Missing required field: "question" must be a non-empty string'
        });
    }

    const allowedTypes = ['multiple_choice', 'checkbox', 'text_input', 'dropdown', 'scale'];
    const resolvedType = type && allowedTypes.includes(type) ? type : 'multiple_choice';

    req.body.question = question.trim().slice(0, 2000); // Protect against huge payloads
    req.body.type = resolvedType;

    if (Array.isArray(req.body.choices)) {
        req.body.choices = req.body.choices
            .filter(c => typeof c === 'string' && c.trim().length > 0)
            .map(c => c.trim().slice(0, 500))
            .slice(0, 100);
    } else {
        req.body.choices = [];
    }

    if (typeof req.body.customContext === 'string') {
        req.body.customContext = req.body.customContext.trim().slice(0, 500);
    } else {
        req.body.customContext = '';
    }

    next();
}

module.exports = {
    validateSolveRequest
};
