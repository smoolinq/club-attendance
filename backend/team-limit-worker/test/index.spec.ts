import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('team-limit-worker', () => {
	it('/api/me responds with creator_id (unit style)', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/api/me');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const body = await response.json<{ creator_id: string }>();
		expect(body.creator_id).toMatch(/[a-f0-9-]{36}/);
	});

	it('/api/me responds with creator_id (integration style)', async () => {
		const request = new Request('http://example.com/api/me');
		const response = await SELF.fetch(request);

		expect(response.status).toBe(200);
		const body = await response.json<{ creator_id: string }>();
		expect(body.creator_id).toMatch(/[a-f0-9-]{36}/);
	});

	it('unknown path responds with NOT_FOUND', async () => {
		const request = new Request('http://example.com/not-found');
		const response = await SELF.fetch(request);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({ error: 'NOT_FOUND' });
	});

	it('OPTIONS preflight responds with 204', async () => {
		const request = new Request('http://example.com/api/me', { method: 'OPTIONS' });
		const response = await SELF.fetch(request);
		expect(response.status).toBe(204);
	});
});
