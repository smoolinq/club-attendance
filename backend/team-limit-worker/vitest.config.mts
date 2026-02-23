import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				miniflare: {
					bindings: {
						COOKIE_HMAC_SECRET: 'test-cookie-hmac-secret',
					},
				},
				wrangler: { configPath: './wrangler.jsonc' },
			},
		},
	},
});
