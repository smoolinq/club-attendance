export interface Env {
	DB: D1Database;
	COOKIE_HMAC_SECRET?: string;
	WRITE_TOKEN?: string;
}

const COOKIE_NAME = "creator_id";
const LIMIT = 5;

const ALLOWED_ORIGIN = "https://club-attendance.smoolinq.workers.dev";

function corsHeaders(req: Request): HeadersInit {
	const origin = req.headers.get("Origin") || "";
	if (origin === ALLOWED_ORIGIN) {
		return {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Credentials": "true",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
			"Vary": "Origin",
		};
	}
	return {};
}

function json(req: Request, data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			...corsHeaders(req),
			...extraHeaders,
		},
	});
}

function parseCookie(req: Request, name: string): string | null {
	const cookie = req.headers.get("Cookie") || "";
	const parts = cookie.split(";").map((v) => v.trim());
	for (const p of parts) {
		if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
	}
	return null;
}

function toBase64Url(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let str = "";
	for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

async function signCreatorId(creatorId: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(creatorId));
	return toBase64Url(sig);
}

async function verifySignedCreatorId(raw: string, secret: string): Promise<string | null> {
	const dot = raw.lastIndexOf(".");
	if (dot <= 0 || dot === raw.length - 1) return null;
	const creatorId = raw.slice(0, dot);
	const sig = raw.slice(dot + 1);
	if (!/^[0-9a-fA-F-]{36}$/.test(creatorId)) return null;
	const expected = await signCreatorId(creatorId, secret);
	if (!timingSafeEqual(sig, expected)) return null;
	return creatorId;
}

function setCookieHeaders(signedCreatorId: string): HeadersInit {
	const maxAge = 60 * 60 * 24 * 365;
	const v = [
		`${COOKIE_NAME}=${encodeURIComponent(signedCreatorId)}`,
		`Max-Age=${maxAge}`,
		"Path=/",
		"HttpOnly",
		"Secure",
		"SameSite=Lax",
	].join("; ");
	return { "Set-Cookie": v };
}

async function getOrIssueCreatorId(req: Request, env: Env): Promise<{ creatorId: string; setCookie?: HeadersInit }> {
	const secret = (env.COOKIE_HMAC_SECRET || "").trim();
	if (!secret) {
		throw new Error("COOKIE_HMAC_SECRET is required");
	}
	const existing = parseCookie(req, COOKIE_NAME);
	if (existing && secret) {
		const verified = await verifySignedCreatorId(existing, secret);
		if (verified) return { creatorId: verified };
	}
	const creatorId = crypto.randomUUID();
	const signed = `${creatorId}.${await signCreatorId(creatorId, secret)}`;
	return { creatorId, setCookie: setCookieHeaders(signed) };
}

async function readJson(req: Request) {
	const ct = req.headers.get("Content-Type") || "";
	if (!ct.includes("application/json")) return null;
	try {
		return await req.json();
	} catch {
		return null;
	}
}

function hasValidWriteToken(req: Request, env: Env): boolean {
	const expected = (env.WRITE_TOKEN || "").trim();
	if (!expected) return false;
	const auth = req.headers.get("Authorization") || "";
	if (!auth.startsWith("Bearer ")) return false;
	const token = auth.slice("Bearer ".length).trim();
	return timingSafeEqual(token, expected);
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		const origin = req.headers.get("Origin");
		const hasOrigin = typeof origin === "string" && origin.length > 0;
		const originAllowed = !hasOrigin || origin === ALLOWED_ORIGIN;

		if (!originAllowed) {
			return json(req, { error: "CORS_FORBIDDEN" }, 403);
		}

		// CORS preflight
		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders(req) });
		}

		if (req.method === "POST" && !hasValidWriteToken(req, env)) {
			return json(req, { error: "UNAUTHORIZED" }, 401);
		}

		if (url.pathname === "/api/me" && req.method === "GET") {
			const { creatorId, setCookie } = await getOrIssueCreatorId(req, env);
			return json(req, { creator_id: creatorId }, 200, setCookie || {});
		}

		if (url.pathname === "/api/team/create" && req.method === "POST") {
			const { creatorId, setCookie } = await getOrIssueCreatorId(req, env);

			const body = await readJson(req);
			const teamData = body?.team_data;
			if (typeof teamData !== "string" || teamData.length === 0) {
				return json(req, { error: "team_data is required (string)" }, 400, setCookie || {});
			}

			await env.DB.prepare(
				"INSERT INTO creators (creator_id, count) VALUES (?1, 0) ON CONFLICT(creator_id) DO NOTHING"
			).bind(creatorId).run();

			const row = await env.DB.prepare("SELECT count FROM creators WHERE creator_id = ?1")
				.bind(creatorId)
				.first<{ count: number }>();

			const count = row?.count ?? 0;
			if (count >= LIMIT) {
				return json(req,
					{ error: "TEAM_LIMIT_REACHED", message: `1端末で作れるグループは${LIMIT}個までです` },
					403,
					setCookie || {}
				);
			}

			const requestedTeamId = (body as any)?.team_id;
			const teamId = typeof requestedTeamId === "string" && requestedTeamId.length > 0 ? requestedTeamId : crypto.randomUUID();

			const insertTeam = env.DB.prepare(
				"INSERT INTO teams (team_id, creator_id, team_data) VALUES (?1, ?2, ?3)"
			).bind(teamId, creatorId, teamData);

			const incCount = env.DB.prepare(
				"UPDATE creators SET count = count + 1, updated_at = datetime('now') WHERE creator_id = ?1"
			).bind(creatorId);

			try {
				await env.DB.batch([insertTeam, incCount]);
			} catch (e: any) {
				if (e.message && (e.message.includes("UNIQUE") || e.message.includes("constraint failed"))) {
					return json(req, { error: "TEAM_ID_ALREADY_EXISTS" }, 409, setCookie || {});
				}
				throw e;
			}

			return json(req, { team_id: teamId }, 201, setCookie || {});
		}

		if (url.pathname === "/api/team/delete" && req.method === "POST") {
			const { creatorId, setCookie } = await getOrIssueCreatorId(req, env);

			const body = await readJson(req);
			const teamId = body?.team_id;
			if (typeof teamId !== "string" || teamId.length === 0) {
				return json(req, { error: "team_id is required (string)" }, 400, setCookie || {});
			}

			const owned = await env.DB.prepare("SELECT team_id FROM teams WHERE team_id = ?1 AND creator_id = ?2")
				.bind(teamId, creatorId)
				.first<{ team_id: string }>();

			if (!owned) {
				return json(req, { error: "NOT_FOUND_OR_NOT_OWNED" }, 404, setCookie || {});
			}

			const delTeam = env.DB.prepare("DELETE FROM teams WHERE team_id = ?1 AND creator_id = ?2")
				.bind(teamId, creatorId);

			const decCount = env.DB.prepare(
				"UPDATE creators SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END, updated_at = datetime('now') WHERE creator_id = ?1"
			).bind(creatorId);

			await env.DB.batch([delTeam, decCount]);

			return json(req, { ok: true }, 200, setCookie || {});
		}

		return json(req, { error: "NOT_FOUND" }, 404);
	},
};
