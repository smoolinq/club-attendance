const DEFAULT_API_BASE = "https://club-attendance-api.smoolinq.workers.dev";
const DEFAULT_MY_GROUPS_API_BASE = "https://team-limit-worker.smoolinq.workers.dev";
const DEFAULT_TEAM_LIMIT_API_BASE = "https://team-limit-worker.smoolinq.workers.dev";

function resolveBaseUrl(raw, fallback) {
  const val = String(raw || "").trim();
  if (!val) return fallback;
  return val.replace(/\/+$/, "");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function buildClientResponse(upstreamRes) {
  const ct = upstreamRes.headers.get("content-type") || "application/json; charset=utf-8";
  const headers = new Headers({ "content-type": ct });
  const setCookie = upstreamRes.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers,
  });
}

const LEGAL_FOOTER_HTML =
  '<footer data-legal-footer style="margin-top:40px;padding:20px 0;text-align:center;font-size:12px;color:#666;">' +
  '<a href="/terms" style="margin-right:15px;color:#666;text-decoration:none;">利用規約</a>' +
  '<a href="/privacy" style="color:#666;text-decoration:none;">プライバシーポリシー</a>' +
  "</footer>";

async function withLegalFooterIfHtml(res) {
  const ct = String(res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("text/html")) return res;
  const html = await res.text();
  if (html.includes('data-legal-footer') || (html.includes('href="/terms"') && html.includes('href="/privacy"'))) {
    return new Response(html, { status: res.status, headers: res.headers });
  }
  const body = html.match(/<\/body>/i)
    ? html.replace(/<\/body>/i, `${LEGAL_FOOTER_HTML}</body>`)
    : `${html}${LEGAL_FOOTER_HTML}`;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(body, { status: res.status, headers });
}

function isTruthyConsent(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

async function readConsentFromRequest(request) {
  const ct = String(request.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      const body = await request.clone().json();
      return isTruthyConsent(body?.agree_terms_privacy);
    } catch {
      return false;
    }
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    try {
      const form = await request.clone().formData();
      return isTruthyConsent(form.get("agree_terms_privacy"));
    } catch {
      return false;
    }
  }
  return false;
}

async function readJsonSafe(request) {
  try {
    return await request.clone().json();
  } catch {
    return null;
  }
}

function normalizeMembers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      if (!m) return null;
      if (typeof m === "string") return { name: String(m).trim(), pin: "" };
      return {
        name: String(m.name || "").trim(),
        pin: String(m.pin || "").trim(),
      };
    })
    .filter((m) => m && m.name);
}

const PIN_REGISTRY_FIELD = "__pinRegistry";
const PIN_OWNERS_FIELD = "__pinOwners";

function validateJoinPinUniqueness({ currentData, nextData }) {
  const currentMembers = normalizeMembers(currentData?.members);
  const nextMembers = normalizeMembers(nextData?.members);
  if (!currentMembers.length || !nextMembers.length) return null;

  const currentByName = new Map(currentMembers.map((m) => [m.name, m]));
  const currentPins = new Set(
    currentMembers
      .map((m) => String(m.pin || "").trim())
      .filter((p) => /^\d{4}$/.test(p))
  );
  const currentAdminPw = String(currentData?.adminPw || "").trim();

  const addedMembers = nextMembers.filter((m) => !currentByName.has(m.name));
  for (const added of addedMembers) {
    const pin = String(added.pin || "").trim();
    if (!/^\d{4}$/.test(pin)) continue;
    if (currentAdminPw && pin === currentAdminPw) {
      return "このPINは管理者PIN（4桁）と重複するため使えません";
    }
    if (currentPins.has(pin)) {
      return "このPINはすでに使われています";
    }
  }
  return null;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPinForTeam(teamId, pin) {
  const normalizedTeam = String(teamId || "").trim().toLowerCase();
  const normalizedPin = String(pin || "").trim();
  const enc = new TextEncoder().encode(`pin-registry-v1:${normalizedTeam}:${normalizedPin}`);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return toHex(digest);
}

function readPinRegistry(data) {
  const practiceRegistry = Array.isArray(data?.attendancePractice?.[PIN_REGISTRY_FIELD])
    ? data.attendancePractice[PIN_REGISTRY_FIELD]
    : [];
  const legacyRegistry = Array.isArray(data?.pinRegistry) ? data.pinRegistry : [];
  const list = [...practiceRegistry, ...legacyRegistry];
  return new Set(
    list
      .map((v) => String(v || "").trim())
      .filter((v) => /^[a-f0-9]{64}$/i.test(v))
      .map((v) => v.toLowerCase())
  );
}

function readPinOwners(data) {
  const raw = data?.attendancePractice?.[PIN_OWNERS_FIELD];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [hash, owner] of Object.entries(raw)) {
    const key = String(hash || "").trim().toLowerCase();
    const name = String(owner || "").trim();
    if (/^[a-f0-9]{64}$/.test(key) && name) out[key] = name;
  }
  return out;
}

async function mergeKnownOwners(baseOwners, teamId, payload) {
  const out = { ...(baseOwners || {}) };
  const adminName = String(payload?.adminName || "").trim();
  const adminPw = String(payload?.adminPw || "").trim();
  if (adminName && /^\d{4}$/.test(adminPw)) {
    out[await hashPinForTeam(teamId, adminPw)] = adminName;
  }
  const members = normalizeMembers(payload?.members);
  for (const m of members) {
    const name = String(m?.name || "").trim();
    const pin = String(m?.pin || "").trim();
    if (!name || !/^\d{4}$/.test(pin)) continue;
    out[await hashPinForTeam(teamId, pin)] = name;
  }
  return out;
}

async function buildPinRegistry(baseRegistry, teamId, payload) {
  const out = new Set(baseRegistry || []);
  const adminPw = String(payload?.adminPw || "").trim();
  if (/^\d{4}$/.test(adminPw)) {
    out.add(await hashPinForTeam(teamId, adminPw));
  }
  const members = normalizeMembers(payload?.members);
  for (const m of members) {
    const pin = String(m.pin || "").trim();
    if (!/^\d{4}$/.test(pin)) continue;
    out.add(await hashPinForTeam(teamId, pin));
  }
  return Array.from(out);
}

function attachPinRegistryToPayload(payload, registryList, ownersMap) {
  const nextPayload = payload && typeof payload === "object" ? { ...payload } : {};
  const nextPractice =
    nextPayload.attendancePractice && typeof nextPayload.attendancePractice === "object"
      ? { ...nextPayload.attendancePractice }
      : {};
  nextPractice[PIN_REGISTRY_FIELD] = Array.isArray(registryList) ? registryList : [];
  if (ownersMap && typeof ownersMap === "object") nextPractice[PIN_OWNERS_FIELD] = ownersMap;
  nextPayload.attendancePractice = nextPractice;
  if (Object.prototype.hasOwnProperty.call(nextPayload, "pinRegistry")) {
    delete nextPayload.pinRegistry;
  }
  return nextPayload;
}

async function validatePinRegistryUniqueness({ teamId, currentData, nextData }) {
  const team = String(teamId || "").trim().toLowerCase();
  if (!team) return null;
  const currentMembers = normalizeMembers(currentData?.members);
  const nextMembers = normalizeMembers(nextData?.members);
  if (!nextMembers.length) return null;
  const currentNames = new Set(currentMembers.map((m) => m.name));
  const registry = readPinRegistry(currentData);
  const addedMembers = nextMembers.filter((m) => !currentNames.has(m.name));
  for (const added of addedMembers) {
    const pin = String(added.pin || "").trim();
    if (!/^\d{4}$/.test(pin)) continue;
    const pinHash = await hashPinForTeam(team, pin);
    if (registry.has(pinHash)) {
      return "このPINはすでに使われています";
    }
  }
  return null;
}

async function validatePinOwnersUniqueness({ teamId, currentData, nextData }) {
  const team = String(teamId || "").trim().toLowerCase();
  if (!team) return null;
  const members = normalizeMembers(nextData?.members);
  const localPinOwner = new Map();
  for (const m of members) {
    const name = String(m?.name || "").trim();
    const pin = String(m?.pin || "").trim();
    if (!name || !/^\d{4}$/.test(pin)) continue;
    const owner = localPinOwner.get(pin);
    if (owner && owner !== name) return "このPINはすでに使われています";
    localPinOwner.set(pin, name);
  }

  const owners = await mergeKnownOwners(readPinOwners(currentData), team, currentData || {});
  const adminName = String(nextData?.adminName || "").trim();
  const adminPw = String(nextData?.adminPw || "").trim();
  if (adminName && /^\d{4}$/.test(adminPw)) {
    const adminHash = await hashPinForTeam(team, adminPw);
    const owner = String(owners[adminHash] || "").trim();
    if (owner && owner !== adminName) return "このPINはすでに使われています";
  }
  for (const m of members) {
    const name = String(m?.name || "").trim();
    const pin = String(m?.pin || "").trim();
    if (!name || !/^\d{4}$/.test(pin)) continue;
    const h = await hashPinForTeam(team, pin);
    const owner = String(owners[h] || "").trim();
    if (owner && owner !== name) return "このPINはすでに使われています";
  }
  return null;
}

export default {
  async fetch(request, env) {
    const API_BASE = resolveBaseUrl(env.API_BASE, DEFAULT_API_BASE);
    const MY_GROUPS_API_BASE = resolveBaseUrl(env.MY_GROUPS_API_BASE, DEFAULT_MY_GROUPS_API_BASE);
    const TEAM_LIMIT_API_BASE = resolveBaseUrl(env.TEAM_LIMIT_API_BASE, DEFAULT_TEAM_LIMIT_API_BASE);
    const url = new URL(request.url);
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";

    if (normalizedPath === "/terms" || normalizedPath.startsWith("/terms/")) {
      if (env.ASSETS?.fetch) {
        const res = await env.ASSETS.fetch(new Request(new URL("/terms.html", url), request));
        if (res.status !== 404) return withLegalFooterIfHtml(res);
      }
      return new Response("Terms page is not available", { status: 500 });
    }

    if (normalizedPath === "/privacy" || normalizedPath.startsWith("/privacy/")) {
      if (env.ASSETS?.fetch) {
        const res = await env.ASSETS.fetch(new Request(new URL("/privacy.html", url), request));
        if (res.status !== 404) return withLegalFooterIfHtml(res);
      }
      return new Response("Privacy page is not available", { status: 500 });
    }

    if (url.pathname === "/api/team/create" || url.pathname === "/api/team/delete") {
      if (request.method !== "POST") {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      if (url.pathname === "/api/team/create") {
        const agreed = await readConsentFromRequest(request);
        if (!agreed) {
          return json({ ok: false, error: "利用規約・プライバシーポリシーへの同意が必要です" }, 400);
        }
      }

      const writeToken = String(env.WRITE_TOKEN || "").trim();
      if (!writeToken) return json({ error: "WRITE_TOKEN is required" }, 500);

      const endpoint = url.pathname === "/api/team/create" ? "/api/team/create" : "/api/team/delete";
      const upstreamUrl = `${TEAM_LIMIT_API_BASE}${endpoint}`;

      const headers = new Headers();
      const contentType = request.headers.get("content-type");
      if (contentType) headers.set("content-type", contentType);
      headers.set("authorization", `Bearer ${writeToken}`);

      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: request.body,
      });
      return buildClientResponse(upstreamRes);
    }

    if (url.pathname === "/api/sync/my-groups") {
      if (request.method !== "GET" && request.method !== "POST") {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }

      if (url.searchParams.has("member_id")) {
        return json({ error: "member_id must not be provided by client" }, 400);
      }

      const upstreamUrl = `${MY_GROUPS_API_BASE}/api/sync/my-groups`;

      const fwdHeaders = new Headers();
      const cookie = request.headers.get("cookie");
      if (cookie) fwdHeaders.set("cookie", cookie);

      if (request.method === "GET") {
        const upstreamRes = await fetch(upstreamUrl, { method: "GET", headers: fwdHeaders });
        return buildClientResponse(upstreamRes);
      }

      // POST: proxy adds WRITE_TOKEN; browser never has it
      const writeToken = String(env.WRITE_TOKEN || "").trim();
      if (!writeToken) return json({ error: "WRITE_TOKEN is required" }, 500);

      let parsedBody = {};
      try {
        parsedBody = await request.clone().json();
      } catch {
        return json({ error: "invalid json body" }, 400);
      }
      if (parsedBody && Object.prototype.hasOwnProperty.call(parsedBody, "member_id")) {
        return json({ error: "member_id must not be provided by client" }, 400);
      }

      const contentType = request.headers.get("content-type");
      if (contentType) fwdHeaders.set("content-type", contentType);
      fwdHeaders.set("authorization", `Bearer ${writeToken}`);

      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: fwdHeaders,
        body: JSON.stringify(parsedBody || {}),
      });
      return buildClientResponse(upstreamRes);
    }

    if (url.pathname === "/api/sync") {
      if (request.method !== "GET" && request.method !== "POST") {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }

      const team = (url.searchParams.get("team") || "").trim();
      if (!team) return json({ error: "team is required" }, 400);

      const upstreamUrl = `${API_BASE}/?team=${encodeURIComponent(team)}`;
      const parsedBody = request.method === "POST" ? await readJsonSafe(request) : null;

      if (request.method === "GET") {
        const upstreamRes = await fetch(upstreamUrl, { method: "GET" });
        return buildClientResponse(upstreamRes);
      }

      const writeToken = String(env.WRITE_TOKEN || "").trim();
      const probeHeaders = new Headers();
      if (writeToken) probeHeaders.set("authorization", `Bearer ${writeToken}`);

      let teamExists = true;
      let currentData = null;
      try {
        const probe = await fetch(upstreamUrl, { method: "GET", headers: probeHeaders });
        teamExists = probe.ok;
        if (probe.ok) {
          currentData = await probe.json();
        }
      } catch {
        teamExists = true;
      }
      if (!teamExists) {
        const agreed = await readConsentFromRequest(request);
        if (!agreed) {
          return json({ ok: false, error: "利用規約・プライバシーポリシーへの同意が必要です" }, 400);
        }
      } else {
        // --- recoveryCode authentication (existing teams only) ---
        const clientCode = String(
          request.headers.get("x-recovery-code") ||
          (parsedBody && typeof parsedBody === "object" ? parsedBody.recoveryCode : "") ||
          ""
        ).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        const serverCode = String(currentData?.recoveryCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!serverCode) {
          return json(
            { ok: false, error: "このチームは復旧コード未設定です。管理者へ連絡してください", code: "RECOVERY_NOT_CONFIGURED" },
            409
          );
        }
        if (!clientCode || clientCode !== serverCode) {
          return json({ ok: false, error: "認証に失敗しました" }, 403);
        }
      }
      if (currentData) {
        try {
          const nextData = parsedBody && typeof parsedBody === "object" ? parsedBody : null;
          if (nextData) {
            const pinError = validateJoinPinUniqueness({ currentData, nextData });
            if (pinError) {
              return json({ ok: false, error: pinError }, 400);
            }
            const registryError = await validatePinRegistryUniqueness({ teamId: team, currentData, nextData });
            if (registryError) {
              return json({ ok: false, error: registryError }, 400);
            }
            const ownersError = await validatePinOwnersUniqueness({ teamId: team, currentData, nextData });
            if (ownersError) {
              return json({ ok: false, error: ownersError }, 400);
            }
          }
        } catch {
          // Keep proxy behavior if validation parsing fails.
        }
      }

      const headers = new Headers();
      const contentType = request.headers.get("content-type");
      if (contentType) headers.set("content-type", contentType);
      if (writeToken) headers.set("authorization", `Bearer ${writeToken}`);

      let bodyToSend = request.body;
      if (parsedBody && typeof parsedBody === "object") {
        const existingRegistry = readPinRegistry(currentData || {});
        const mergedRegistry = await buildPinRegistry(existingRegistry, team, parsedBody);
        const existingOwners = await mergeKnownOwners(readPinOwners(currentData), team, currentData || {});
        const mergedOwners = await mergeKnownOwners(existingOwners, team, parsedBody);
        const nextBody = attachPinRegistryToPayload(parsedBody, mergedRegistry, mergedOwners);
        bodyToSend = JSON.stringify(nextBody);
        headers.set("content-type", "application/json");
      }

      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: bodyToSend,
      });

      return buildClientResponse(upstreamRes);
    }

    if (env.ASSETS?.fetch) {
      const res = await env.ASSETS.fetch(request);
      return withLegalFooterIfHtml(res);
    }
    return json({ error: "NOT_FOUND" }, 404);
  },
};
