// ---- MOCK MESSAGE STORE (nur Frontend) ----
const mockThreads = {};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function getThreadKey(to) {
  return "thread_" + (to || "unknown");
}

async function mockMessagesFetch(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  // GET /messages/thread?to=handle
  if (path.startsWith("/messages/thread") && method === "GET") {
    const url = new URL("https://x" + path);
    const to = url.searchParams.get("to");
    const key = getThreadKey(to);

    if (!mockThreads[key]) {
      mockThreads[key] = [
        { from: to || "unknown", text: "Hey 👋", ts: Date.now() - 60000 },
        { from: "me", text: "Hi!", ts: Date.now() - 30000 }
      ];
    }

    return jsonResponse({ messages: mockThreads[key] }, 200);
  }

  // POST /messages/send
  if (path === "/messages/send" && method === "POST") {
    let body = {};
    try {
      body = JSON.parse(options.body || "{}");
    } catch {}

    const key = getThreadKey(body.to);

    if (!mockThreads[key]) mockThreads[key] = [];
    mockThreads[key].push({
      from: "me",
      text: body.text || "",
      ts: Date.now()
    });

    return jsonResponse({ status: "sent" }, 200);
  }

  return null;
}

export async function apiFetch(path, options = {}) {
  // 1️⃣ MOCK zuerst versuchen
  const mock = await mockMessagesFetch(path, options);
  if (mock) return mock.json();

  // 2️⃣ echte API
  const headers = options.headers || {};
  const token = localStorage.getItem("session_token");

  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const res = await fetch("https://api.renex.id" + path, {
    ...options,
    headers
  });

  // 🔐 SESSION AUTOMATISCH ABGELAUFEN
  if (res.status === 401) {
    console.warn("🔒 Session abgelaufen");

    localStorage.removeItem("session_token");
    localStorage.removeItem("user_handle");

    window.location.replace("/index.html");
    throw new Error("Session expired");
  }

  return res.json();
}