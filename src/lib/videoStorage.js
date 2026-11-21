import { auth } from "./firebaseClient";

// Vul hier de URL van de korfbal-video Cloudflare Worker in (bijv. https://korfbal-video.<sub>.workers.dev)
export const VIDEO_API_URL = "https://korfbal-video.sparta-korfbal.workers.dev";

const PART_SIZE = 50 * 1024 * 1024; // 50 MiB per deel
const MAX_RETRIES = 3;

async function getToken() {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Niet ingelogd");
  return token;
}

function putPart(url, token, body, onPartProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onPartProgress) onPartProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Ongeldige serverrespons"));
        }
      } else {
        reject(new Error(`Upload van deel mislukt (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Netwerkfout bij uploaden"));
    xhr.send(body);
  });
}

// Upload een video naar R2 via de Cloudflare Worker (multipart, 50 MiB delen)
export async function uploadVideoToR2({ matchId, half, file, onProgress }) {
  let token = await getToken();
  const api = VIDEO_API_URL.replace(/\/$/, "");

  // Start multipart upload
  const initRes = await fetch(`${api}/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ matchId, half, contentType: file.type || "video/mp4" }),
  });
  if (!initRes.ok) throw new Error(`Upload starten mislukt (${initRes.status})`);
  const { key, uploadId } = await initRes.json();

  const parts = [];
  const totalParts = Math.max(1, Math.ceil(file.size / PART_SIZE));
  const finishedBytes = { value: 0 };

  const report = (partLoaded) => {
    if (typeof onProgress === "function") {
      const p = ((finishedBytes.value + partLoaded) / file.size) * 100;
      onProgress(Math.min(100, Math.max(0, Math.round(p))));
    }
  };

  try {
    for (let i = 0; i < totalParts; i++) {
      const partNumber = i + 1;
      const blob = file.slice(i * PART_SIZE, (i + 1) * PART_SIZE);
      const partUrl = `${api}/uploads/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(
        uploadId
      )}&partNumber=${partNumber}`;

      let result = null;
      let lastError = null;
      for (let attempt = 0; attempt < MAX_RETRIES && !result; attempt++) {
        try {
          token = await getToken();
          result = await putPart(partUrl, token, blob, report);
        } catch (e) {
          lastError = e;
        }
      }
      if (!result) throw lastError || new Error("Upload van deel mislukt");

      parts.push({ partNumber, etag: result.etag });
      finishedBytes.value += blob.size;
      report(0);
    }

    // Afronden
    token = await getToken();
    const doneRes = await fetch(`${api}/uploads/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ key, uploadId, parts }),
    });
    if (!doneRes.ok) throw new Error(`Upload afronden mislukt (${doneRes.status})`);
    const done = await doneRes.json();
    return { url: done.url, key };
  } catch (e) {
    // Best effort: de onafgemaakte multipart upload opruimen
    try {
      await fetch(`${api}/uploads/abort`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key, uploadId }),
      });
    } catch (abortErr) {
      console.warn("[videoStorage] Abort mislukt:", abortErr);
    }
    throw e;
  }
}

// Verwijder een video uit R2 (best effort)
export async function deleteVideoFromR2(key) {
  try {
    const token = await getToken();
    const api = VIDEO_API_URL.replace(/\/$/, "");
    await fetch(`${api}/videos?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.warn("[videoStorage] Verwijderen uit R2 mislukt:", e);
  }
}
