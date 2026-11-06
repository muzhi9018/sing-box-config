import { platforms, renderTemplate } from "./render.mjs";

const repository = "muzhi9018/sing-box-config";
const branch = "master";
const freshForMs = 5 * 60 * 1000;
const retainForSeconds = 24 * 60 * 60;

export default {
  async fetch(request, _env, ctx) {
    const { pathname, searchParams } = new URL(request.url);
    const head = request.method === "HEAD";
    if (pathname !== "/template") {
      return jsonResponse({ error: "Not found" }, 404, head);
    }
    if (request.method !== "GET" && !head) {
      return jsonResponse({ error: "Method not allowed" }, 405, false, { Allow: "GET, HEAD" });
    }

    const requestedPlatforms = searchParams.getAll("platform");
    const [platform] = requestedPlatforms;
    if (requestedPlatforms.length !== 1 || !platforms.includes(platform)) {
      return jsonResponse({ error: "Specify one supported platform", platforms }, 400, head);
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL(`/_realip-cache/v1/${platform}`, request.url));
    const cached = await cache.match(cacheKey).catch(error => {
      console.warn("RealIP cache read failed", error);
    });
    if (cached && Number(cached.headers.get("X-RealIP-Fresh-Until")) > Date.now()) {
      return templateResponse(cached, head);
    }

    try {
      const { revision, template } = await fetchTemplate(platform);
      const response = new Response(template, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${retainForSeconds}`,
          "X-RealIP-Revision": revision,
          "X-RealIP-Fresh-Until": String(Date.now() + freshForMs),
        },
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(error => {
        console.warn("RealIP cache write failed", error);
      }));
      return templateResponse(response, head);
    } catch (error) {
      console.error(`Failed to load RealIP template for ${platform}`, error);
      if (cached) {
        return templateResponse(cached, head, true);
      }
      return jsonResponse({ error: "Template source unavailable" }, 502, head, {
        "Cache-Control": "no-store",
      });
    }
  },
};

async function fetchTemplate(platform) {
  const ref = await fetchJson(`https://api.github.com/repos/${repository}/git/ref/heads/${branch}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "sing-box-realip-worker",
    },
    cf: { cacheTtlByStatus: { "200": 60, "400-599": -1 } },
  });
  const revision = ref?.object?.sha;
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("Invalid GitHub commit SHA");
  }

  const root = `https://raw.githubusercontent.com/${repository}/${revision}/worker/templates`;
  const [common, platformTemplate] = await Promise.all([
    fetchJson(`${root}/common.json`),
    fetchJson(`${root}/platforms/${platform}.json`),
  ]);
  return { revision, template: renderTemplate(common, platformTemplate) };
}

async function fetchJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`GitHub HTTP ${response.status} for ${new URL(url).pathname}`);
  }
  return response.json();
}

function templateResponse(response, head, stale = false) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-RealIP-Revision": response.headers.get("X-RealIP-Revision"),
  };
  if (stale) {
    headers["X-RealIP-Stale"] = "true";
  }
  return new Response(head ? null : response.body, { headers });
}

function jsonResponse(body, status, head, headers = {}) {
  return new Response(head ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
