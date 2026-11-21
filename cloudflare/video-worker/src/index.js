import { createRemoteJWKSet, jwtVerify } from "jose";

// JWKS buiten de fetch handler zodat hij tussen requests gecachet blijft
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

const KEY_RE = /^matches\/[A-Za-z0-9_-]+\/half[12]-[0-9a-f-]{36}\.mp4$/;

function corsHeaders(headers = new Headers()) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,PUT,POST,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Range");
  headers.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, ETag");
  return headers;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(new Headers({ "Content-Type": "application/json" })),
  });
}

async function requireAuth(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw json({ error: "Ontbrekend token" }, 401);
  try {
    await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
  } catch {
    throw json({ error: "Ongeldig of verlopen token" }, 401);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "Ongeldige JSON" }, 400);
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;
      const method = request.method.toUpperCase();

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      // Publieke video-stream (key bevat random UUID, zoals Firebase download-tokens)
      if (pathname.startsWith("/v/") && (method === "GET" || method === "HEAD")) {
        const key = decodeURIComponent(pathname.slice(3));
        if (!KEY_RE.test(key)) return json({ error: "Ongeldige key" }, 400);

        const object = await env.BUCKET.get(key, {
          range: request.headers,
          onlyIf: request.headers,
        });
        if (!object) return json({ error: "Niet gevonden" }, 404);

        const headers = corsHeaders(new Headers());
        object.writeHttpMetadata(headers);
        headers.set("ETag", object.httpEtag);
        headers.set("Accept-Ranges", "bytes");
        headers.set("Cache-Control", "public, max-age=31536000, immutable");

        if (!object.body) {
          return new Response(null, { status: 304, headers });
        }

        let status = 200;
        let length = object.size;
        if (object.range) {
          const { offset = 0, length: len, suffix } = object.range;
          status = 206;
          if (suffix !== undefined) {
            length = suffix;
            headers.set(
              "Content-Range",
              `bytes ${object.size - suffix}-${object.size - 1}/${object.size}`
            );
          } else {
            length = len ?? object.size - offset;
            headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
          }
        }
        headers.set("Content-Length", String(length));

        return new Response(method === "HEAD" ? null : object.body, { status, headers });
      }

      // Schrijf-endpoints vereisen een geldig Firebase ID token
      if (method === "POST" && pathname === "/uploads") {
        await requireAuth(request, env);
        const { matchId, half, contentType } = await readJson(request);
        if (!/^[A-Za-z0-9_-]+$/.test(matchId || "") || !/^half[12]$/.test(half || "")) {
          return json({ error: "Ongeldige matchId of half" }, 400);
        }
        const key = `matches/${matchId}/${half}-${crypto.randomUUID()}.mp4`;
        const upload = await env.BUCKET.createMultipartUpload(key, {
          httpMetadata: { contentType: contentType || "video/mp4" },
        });
        return json({ key, uploadId: upload.uploadId });
      }

      if (method === "PUT" && pathname === "/uploads/part") {
        await requireAuth(request, env);
        const key = url.searchParams.get("key") || "";
        const uploadId = url.searchParams.get("uploadId") || "";
        const partNumber = parseInt(url.searchParams.get("partNumber") || "", 10);
        if (!KEY_RE.test(key) || !uploadId || !(partNumber >= 1 && partNumber <= 10000)) {
          return json({ error: "Ongeldige parameters" }, 400);
        }
        const part = await env.BUCKET.resumeMultipartUpload(key, uploadId).uploadPart(
          partNumber,
          request.body
        );
        return json({ partNumber, etag: part.etag });
      }

      if (method === "POST" && pathname === "/uploads/complete") {
        await requireAuth(request, env);
        const { key, uploadId, parts } = await readJson(request);
        if (!KEY_RE.test(key || "") || !uploadId || !Array.isArray(parts)) {
          return json({ error: "Ongeldige parameters" }, 400);
        }
        await env.BUCKET.resumeMultipartUpload(key, uploadId).complete(parts);
        return json({ key, url: `${url.origin}/v/${key}` });
      }

      if (method === "POST" && pathname === "/uploads/abort") {
        await requireAuth(request, env);
        const { key, uploadId } = await readJson(request);
        if (!KEY_RE.test(key || "") || !uploadId) {
          return json({ error: "Ongeldige parameters" }, 400);
        }
        await env.BUCKET.resumeMultipartUpload(key, uploadId).abort();
        return json({ ok: true });
      }

      if (method === "DELETE" && pathname === "/videos") {
        await requireAuth(request, env);
        const key = url.searchParams.get("key") || "";
        if (!KEY_RE.test(key)) return json({ error: "Ongeldige key" }, 400);
        await env.BUCKET.delete(key);
        return json({ ok: true });
      }

      return json({ error: "Niet gevonden" }, 404);
    } catch (e) {
      if (e instanceof Response) return e;
      return json({ error: e && e.message ? e.message : "Onbekende fout" }, 500);
    }
  },
};
