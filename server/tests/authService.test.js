/**
 * @file server/tests/authService.test.js
 * @description Unit & integration tests for Auth & Paid Plan service, Freemium quota tracking,
 * and Smart Delight review trigger heuristics.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Import authService from extension services
const authService = require(path.join(__dirname, '../../src/services/authService.js'));
const app = require('../src/index');

describe('AuthService — Freemium Monthly Quota & Plan Management', () => {
    it('generates valid current month key in YYYY-MM-01 format', () => {
        const key = authService.getCurrentMonthKey();
        assert.match(key, /^\d{4}-\d{2}-01$/);
    });

    it('normalizes stats and resets monthly count if month has rolled over', () => {
        const oldStats = {
            questionsUsedThisMonth: 25,
            monthResetDate: '2025-01-01',
            formsCompletedCount: 5,
            questionsSolvedTotal: 40
        };

        const normalized = authService.normalizeUsageStats(oldStats);
        assert.equal(normalized.questionsUsedThisMonth, 0);
        assert.equal(normalized.monthResetDate, authService.getCurrentMonthKey());
        assert.equal(normalized.formsCompletedCount, 5);
        assert.equal(normalized.questionsSolvedTotal, 40);
    });

    it('preserves monthly usage count if within current month', () => {
        const currentMonth = authService.getCurrentMonthKey();
        const currentStats = {
            questionsUsedThisMonth: 12,
            monthResetDate: currentMonth,
            formsCompletedCount: 3,
            questionsSolvedTotal: 12
        };

        const normalized = authService.normalizeUsageStats(currentStats);
        assert.equal(normalized.questionsUsedThisMonth, 12);
        assert.equal(normalized.monthResetDate, currentMonth);
    });

    it('reports correct quota for Free Tier users (25 questions/month)', () => {
        const user = { plan: 'free' };
        const stats = {
            questionsUsedThisMonth: 10,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const status = authService.getMonthlyQuotaStatus(user, stats);
        assert.equal(status.isPro, false);
        assert.equal(status.limit, 25);
        assert.equal(status.used, 10);
        assert.equal(status.remaining, 15);
        assert.equal(status.plan, 'free');
    });

    it('reports Unlimited quota for Pro Plan users', () => {
        const user = { plan: 'pro' };
        const stats = {
            questionsUsedThisMonth: 50,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const status = authService.getMonthlyQuotaStatus(user, stats);
        assert.equal(status.isPro, true);
        assert.equal(status.limit, Infinity);
        assert.equal(status.remaining, Infinity);
        assert.equal(status.plan, 'pro');
    });

    it('canSolveQuestion permits solving when free quota remains', () => {
        const user = { plan: 'free' };
        const stats = {
            questionsUsedThisMonth: 24,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const result = authService.canSolveQuestion(user, stats);
        assert.equal(result.allowed, true);
        assert.equal(result.remaining, 1);
        assert.equal(result.isPro, false);
    });

    it('canSolveQuestion blocks solving and returns upgrade reason when free quota is exhausted', () => {
        const user = { plan: 'free' };
        const stats = {
            questionsUsedThisMonth: 25,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const result = authService.canSolveQuestion(user, stats);
        assert.equal(result.allowed, false);
        assert.equal(result.remaining, 0);
        assert.equal(result.isPro, false);
        assert.match(result.reason, /used all 25 free questions/i);
    });

    it('canSolveQuestion always permits solving for Pro users regardless of usage', () => {
        const user = { plan: 'pro' };
        const stats = {
            questionsUsedThisMonth: 500,
            monthResetDate: authService.getCurrentMonthKey()
        };

        const result = authService.canSolveQuestion(user, stats);
        assert.equal(result.allowed, true);
        assert.equal(result.remaining, Infinity);
        assert.equal(result.isPro, true);
    });
});

describe('AuthService — Smart Delight Review Trigger Heuristics', () => {
    it('does not show review prompt on fresh install with zero forms and few questions', () => {
        const stats = {
            formsCompletedCount: 1,
            questionsSolvedTotal: 7,
            reviewPromptState: 'pending'
        };

        assert.equal(authService.shouldShowReviewPrompt(stats), false);
    });

    it('shows review prompt after the 2nd completed form', () => {
        const stats = {
            formsCompletedCount: 2,
            questionsSolvedTotal: 8,
            reviewPromptState: 'pending'
        };

        assert.equal(authService.shouldShowReviewPrompt(stats), true);
    });

    it('shows review prompt after 15 or more lifetime questions solved', () => {
        const stats = {
            formsCompletedCount: 1,
            questionsSolvedTotal: 15,
            reviewPromptState: 'pending'
        };

        assert.equal(authService.shouldShowReviewPrompt(stats), true);
    });

    it('does not show review prompt if user has already reviewed or dismissed', () => {
        const reviewedStats = {
            formsCompletedCount: 5,
            questionsSolvedTotal: 50,
            reviewPromptState: 'reviewed'
        };
        assert.equal(authService.shouldShowReviewPrompt(reviewedStats), false);

        const dismissedStats = {
            formsCompletedCount: 5,
            questionsSolvedTotal: 50,
            reviewPromptState: 'dismissed'
        };
        assert.equal(authService.shouldShowReviewPrompt(dismissedStats), false);
    });

    it('respects 3-day snooze duration before showing prompt again', () => {
        const now = 1700000000000;
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const fourDaysAgo = now - (4 * 24 * 60 * 60 * 1000);

        // Snoozed 1 day ago -> should NOT show
        const snoozedRecentStats = {
            formsCompletedCount: 3,
            questionsSolvedTotal: 25,
            reviewPromptState: 'snoozed',
            reviewDismissedAt: oneDayAgo
        };
        assert.equal(authService.shouldShowReviewPrompt(snoozedRecentStats, now), false);

        // Snoozed 4 days ago (> 3 days snooze period) -> should show again
        const snoozeExpiredStats = {
            formsCompletedCount: 3,
            questionsSolvedTotal: 25,
            reviewPromptState: 'snoozed',
            reviewDismissedAt: fourDaysAgo
        };
        assert.equal(authService.shouldShowReviewPrompt(snoozeExpiredStats, now), true);
    });
});

describe('Backend Server — Pro Tier Rate Limit & Quota Integration', () => {
    let server;
    let baseUrl;

    before(() => {
        return new Promise((resolve) => {
            server = app.listen(0, () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(() => {
        return new Promise((resolve) => {
            if (server) server.close(resolve);
            else resolve();
        });
    });

    it('returns Unlimited quota on /api/v1/quota when X-User-Plan: pro header is sent', async () => {
        const res = await fetch(`${baseUrl}/api/v1/quota?clientId=test-pro-client-123`, {
            headers: {
                'X-Client-ID': 'test-pro-client-123',
                'X-User-Plan': 'pro'
            }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.isPro, true);
        assert.equal(data.limit, 'Unlimited');
        assert.equal(data.remaining, 'Unlimited');
    });

    it('reports standard rate limit quota for free / anonymous clients', async () => {
        const res = await fetch(`${baseUrl}/api/v1/quota?clientId=test-free-client-456`, {
            headers: {
                'X-Client-ID': 'test-free-client-456'
            }
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.isPro, false);
        assert.equal(typeof data.limit, 'number');
        assert.equal(typeof data.remaining, 'number');
    });
});
