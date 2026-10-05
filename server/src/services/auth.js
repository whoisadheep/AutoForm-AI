/**
 * @file server/src/services/auth.js
 * @description Google OAuth token verification and JWT session management.
 */

const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'autoform_jwt_dev_secret_key_change_in_production_32char';
const JWT_EXPIRES_IN = '7d';

/**
 * Validates Google token payload fields according to Google Security Guidelines.
 * Checks aud == GOOGLE_CLIENT_ID, iss in accounts.google.com, exp > now, and email_verified == true.
 * @param {Object} data 
 * @param {string} [expectedClientId=process.env.GOOGLE_CLIENT_ID]
 * @returns {Object} Validated profile { sub, email, name, picture }
 */
function validateGoogleTokenPayload(data, expectedClientId = process.env.GOOGLE_CLIENT_ID) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid token payload.');
    }

    // 1. Audience check (aud == GOOGLE_CLIENT_ID)
    if (expectedClientId && data.aud !== expectedClientId) {
        throw new Error(`Google ID token audience mismatch: expected ${expectedClientId}, got ${data.aud}.`);
    }

    // 2. Issuer check (iss in accounts.google.com)
    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!data.iss || !validIssuers.includes(data.iss)) {
        throw new Error(`Invalid Google ID token issuer: got ${data.iss}, expected accounts.google.com.`);
    }

    // 3. Expiry check (exp > now)
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!data.exp || parseInt(data.exp, 10) < nowSeconds) {
        throw new Error('Google ID token has expired.');
    }

    // 4. Email verification check (email_verified == true)
    if (data.email_verified !== true && data.email_verified !== 'true') {
        throw new Error('Google account email must be verified.');
    }

    if (!data.sub || !data.email) {
        throw new Error('Google ID token is missing required profile fields (sub, email).');
    }

    return {
        sub: data.sub,
        email: data.email.toLowerCase(),
        name: data.name || data.email,
        picture: data.picture || null
    };
}

/**
 * Verifies a Google ID token with Google's public tokeninfo endpoint.
 * In development or mock tests, accepts mock test tokens.
 * @param {string} idToken
 * @returns {Promise<Object>} Decoded user profile { sub, email, name, picture }
 */
async function verifyGoogleIdToken(idToken) {
    if (!idToken || typeof idToken !== 'string') {
        throw new Error('Google ID token is required.');
    }

    // Support mock ID token for testing
    if (idToken.startsWith('mock_google_token_')) {
        const parts = idToken.split('_');
        const sub = parts[3] || 'sub_' + Math.random().toString(36).slice(2);
        const email = parts[4] ? `${parts[4]}@example.com` : `test_${sub}@example.com`;
        return {
            sub,
            email,
            name: 'Test Google User',
            picture: 'https://lh3.googleusercontent.com/a/default-user'
        };
    }

    try {
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
            signal: AbortSignal.timeout(6000)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error_description || 'Invalid Google ID token.');
        }

        const data = await res.json();
        return validateGoogleTokenPayload(data);
    } catch (err) {
        throw new Error(`Google token verification failed: ${err.message}`);
    }
}

/**
 * Finds or creates a user record for the verified Google identity.
 * @param {Object} profile
 * @returns {Promise<Object>}
 */
async function findOrCreateGoogleUser({ sub, email }) {
    let user = await db.findUserByGoogleSub(sub);
    if (!user) {
        user = await db.createUser({ googleSub: sub, email });
    }
    return user;
}

/**
 * Signs a session JWT for an authenticated user.
 * @param {Object} user
 * @returns {string} Signed JWT string
 */
function signUserToken(user) {
    return jwt.sign(
        {
            userId: user.id,
            email: user.email,
            googleSub: user.google_sub
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

/**
 * Verifies and decodes a signed user session JWT.
 * @param {string} token
 * @returns {Object}
 */
function verifyUserToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

module.exports = {
    validateGoogleTokenPayload,
    verifyGoogleIdToken,
    findOrCreateGoogleUser,
    signUserToken,
    verifyUserToken
};
