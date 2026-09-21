/**
 * @file server/tests/apiSecurity.test.js
 * @description Integration tests for HTTP security headers, request tracing, and health endpoints.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/index');

describe('HTTP API & Security Hardening', () => {
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

    it('returns OK on /healthz liveness probe', async () => {
        const res = await fetch(`${baseUrl}/healthz`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.equal(text, 'OK');
    });

    it('injects security headers and X-Request-Id, and hides X-Powered-By', async () => {
        const res = await fetch(`${baseUrl}/api/v1/health`);

        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
        assert.equal(res.headers.get('x-powered-by'), null);

        const reqId = res.headers.get('x-request-id');
        assert.ok(reqId);
        assert.ok(reqId.length > 10);
    });

    it('returns health metrics with uptime, memory, and circuit breaker status', async () => {
        const res = await fetch(`${baseUrl}/api/v1/health`);
        const data = await res.json();

        assert.equal(data.status, 'healthy');
        assert.ok(typeof data.uptimeSeconds === 'number');
        assert.ok(data.memoryMb);
        assert.ok(data.metrics);
    });

    it('returns quota status with rate limit remaining', async () => {
        const res = await fetch(`${baseUrl}/api/v1/quota`, {
            headers: { 'X-Client-ID': 'test-client-123' }
        });
        const data = await res.json();

        assert.equal(data.clientId, 'test-client-123');
        assert.ok(typeof data.remaining === 'number');
        assert.ok(typeof data.limit === 'number');
    });

    it('validates solve request and rejects missing question', async () => {
        const res = await fetch(`${baseUrl}/api/v1/solve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.ok(data.error.includes('question'));
    });
});
