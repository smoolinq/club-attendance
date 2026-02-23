const API_BASE = "https://club-attendance-api.smoolinq.workers.dev";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function buildClientResponse(upstreamRes) {
  const ct = upstreamRes.headers.get("content-type") || "application/json; charset=utf-8";
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: { "content-type": ct },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/sync") {
      if (request.method !== "GET" && request.method !== "POST") {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }

      const team = (url.searchParams.get("team") || "").trim();
      if (!team) return json({ error: "team is required" }, 400);

      const upstreamUrl = `${API_BASE}/?team=${encodeURIComponent(team)}`;

      if (request.method === "GET") {
        const upstreamRes = await fetch(upstreamUrl, { method: "GET" });
        return buildClientResponse(upstreamRes);
      }

      const writeToken = String(env.WRITE_TOKEN || "").trim();
      if (!writeToken) return json({ error: "WRITE_TOKEN is required" }, 500);

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

    return env.ASSETS.fetch(request);
  },
};
