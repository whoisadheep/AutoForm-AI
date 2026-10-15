/**
 * @file server/src/utils/userAgentParser.js
 * @description Fast, zero-dependency User-Agent string parser for extension traffic analytics.
 * Detects browser brand (Edge, Chrome, Firefox, etc.), OS, and device type.
 */

function parseUserAgent(ua = '') {
    if (!ua || typeof ua !== 'string') {
        return {
            browser: 'Unknown',
            os: 'Unknown',
            device: 'desktop'
        };
    }

    const lower = ua.toLowerCase();

    // 1. Browser Detection
    let browser = 'Other';
    if (ua.includes('Edg/') || ua.includes('Edge/')) {
        browser = 'Edge';
    } else if (ua.includes('OPR/') || ua.includes('Opera/')) {
        browser = 'Opera';
    } else if (ua.includes('Brave/')) {
        browser = 'Brave';
    } else if (ua.includes('Chrome/') || ua.includes('CriOS/')) {
        browser = 'Chrome';
    } else if (ua.includes('Firefox/') || ua.includes('FxiOS/')) {
        browser = 'Firefox';
    } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
        browser = 'Safari';
    }

    // 2. OS Detection
    let os = 'Other';
    if (lower.includes('windows nt 10') || lower.includes('windows nt 11') || lower.includes('windows')) {
        os = 'Windows';
    } else if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ipod')) {
        os = 'iOS';
    } else if (lower.includes('macintosh') || lower.includes('mac os x')) {
        os = 'macOS';
    } else if (lower.includes('android')) {
        os = 'Android';
    } else if (lower.includes('linux') || lower.includes('x11')) {
        os = 'Linux';
    } else if (lower.includes('cros')) {
        os = 'ChromeOS';
    }

    // 3. Device Form Factor
    const isMobile = lower.includes('mobile') || lower.includes('android') || lower.includes('iphone') || lower.includes('ipad');
    const device = isMobile ? 'mobile' : 'desktop';

    return {
        browser,
        os,
        device
    };
}

module.exports = {
    parseUserAgent
};
