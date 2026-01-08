function openKeyDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("renex-keys", 1);

    req.onupgradeneeded = () => {
      req.result.createObjectStore("keys");
    };

    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}
async function idbSet(key, value) {
  const db = await openKeyDB();
  const tx = db.transaction("keys", "readwrite");
  tx.objectStore("keys").put(value, key);
  return tx.complete;
}

async function idbGet(key) {
  const db = await openKeyDB();
  const tx = db.transaction("keys", "readonly");
  return new Promise(resolve => {
    const req = tx.objectStore("keys").get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

// ======================================================
// CONFIG
// ======================================================
const API = "https://api.renex.id";
const MAX_MESSAGE_LENGTH = 1000;
const SEND_COOLDOWN_MS = 2000;

// ======================================================
// DOM ELEMENTS
// ======================================================
let messagesEl;
let indicatorEl;
let unreadCountEl;
let sendBtn;
let inputEl;
let warningEl;
let titleEl;
let withUser = null;

// ======================================================
// STATE
// ======================================================
let firstLoad = true;
let unreadCount = 0;
let lastSendTime = 0;
let cooldownTimer = null;

const renderedMessageIds = new Set();   // echte Server-IDs
const pendingByTempId = new Map();      // tempId -> div
const params = new URLSearchParams(window.location.search);
withUser = params.get("with");
console.log("withUser =", withUser);

if (!withUser) {
  alert("Kein Chat-Partner gewählt");
  throw new Error("withUser fehlt");
}

// ======================================================
// CRYPTO / E2E HELPERS
// ======================================================
async function generateKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true, // exportierbar (nur Public!)
    ["deriveKey"]
  );
}

async function storePrivateKey(privateKey) {
  const db = await openKeyDB();
  const tx = db.transaction("keys", "readwrite");
  tx.objectStore("keys").put(privateKey, "private");
}

async function loadPrivateKey() {
  const db = await openKeyDB();
  const tx = db.transaction("keys", "readonly");
  const req = tx.objectStore("keys").get("private");

  return new Promise(resolve => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}


async function loadPublicKey() {
  return await idbGet("e2e-public-key");
}

async function exportPublicKey() {
  const publicKey = await loadPublicKey();
  if (!publicKey) throw new Error("Kein Public Key gefunden");

  const jwk = await crypto.subtle.exportKey(
    "jwk",
    publicKey
  );

  return jwk;
}

// ======================================================
// API HELPER
// ======================================================
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("session_token");

  const res = await fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  // ✅ 429 explizit behandeln
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    return {
      rateLimited: true,
      error: data.error || "Too many messages"
    };
  }

  // ❌ echte Fehler
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {}
    throw new Error(`API ${res.status}: ${msg}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ======================================================
// SESSION HELPERS
// ======================================================
function getMyUser() {
  return localStorage.getItem("my_user");
}

// ======================================================
// START
// ======================================================
exportPublicKey().then(pk => {
  console.log("🔓 Public Key (exportiert):", pk);
});

function startChat() {
  messagesEl = document.getElementById("messages");
  indicatorEl = document.getElementById("new-indicator");
  unreadCountEl = document.getElementById("unread-count");
  sendBtn = document.getElementById("send-btn");
  inputEl = document.getElementById("msg-input");
  warningEl = document.getElementById("length-warning");
  titleEl = document.getElementById("chat-with");

  if (!messagesEl || !indicatorEl || !unreadCountEl || !sendBtn || !inputEl || !titleEl) {
    console.error("DOM nicht bereit");
    return;
  }

  titleEl.textContent = "Chat mit " + withUser;
  messagesEl.innerHTML = "";

  // =========================
  // SEND BUTTON
  // =========================
  sendBtn.addEventListener("click", async () => {
    const text = inputEl.value.trim();
    if (!text) return;

    // Rate limit
    const now = Date.now();
    if (now - lastSendTime < SEND_COOLDOWN_MS) {
      showCooldownWarning();
      return;
    }
    lastSendTime = now;

    // ❌ NICHT senden, solange noch eine Message pending ist
    if (pendingByTempId.size > 0) return;
    sendBtn.disabled = true;

    // Optimistic UI
    const tempId = `tmp-${now}-${Math.random().toString(16).slice(2)}`;
    const pendingDiv = renderMessage({
      from: getMyUser(),
      message: text,
      tempId,
      status: "pending"
    });
    if (pendingDiv) pendingByTempId.set(tempId, pendingDiv);

    inputEl.value = "";
    scrollToBottom();

try {
  const res = await apiFetch("/chat/send", {
    method: "POST",
    body: JSON.stringify({ to: withUser, message: text })
  });

  // 🟡 Rate Limit
  if (res?.rateLimited) {
    const div = pendingByTempId.get(tempId);
    if (div) {
      div.classList.remove("pending");
      div.classList.add("failed");
    }

    showCooldownWarning();
    return;
  }

// ✅ Erfolg
const saved = res.message;

// 🔓 pending → sent auflösen
const div = pendingByTempId.get(tempId);
if (div) {
  div.classList.remove("pending");
  div.dataset.id = saved.id;          // echte Server-ID
  renderedMessageIds.add(saved.id);   // gegen Duplikate beim Polling
  pendingByTempId.delete(tempId);     // ⬅️ DAS IST DER SCHLÜSSEL
}

// 🕒 Timestamp nachträglich setzen
if (div && saved?.ts) {
  const timeEl = div.querySelector(".timestamp");
  if (timeEl) {
    timeEl.textContent = formatTimestamp(saved.ts);
  }
}


} catch (err) {
  // 🔴 echter Fehler (500 etc.)
  const div = pendingByTempId.get(tempId);
  if (div) {
    div.classList.remove("pending");
    div.classList.add("failed");
  }

  alert("Nachricht konnte nicht gesendet werden");
  console.error(err);

} finally {
  sendBtn.disabled = false;
}
  });

  // =========================
  // ENTER / SHIFT+ENTER
  // =========================
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();

   // ❌ NICHT senden, solange noch eine Message pending ist
  if (pendingByTempId.size > 0) return;
    sendBtn.click();
  }
});
  // =========================
  // MESSAGE LENGTH CHECK
  // =========================
  inputEl.addEventListener("input", () => {
    const len = inputEl.value.length;

    if (len >= MAX_MESSAGE_LENGTH) {
      warningEl.textContent = `Maximal ${MAX_MESSAGE_LENGTH} Zeichen erreicht`;
      warningEl.className = "error";
      sendBtn.disabled = true;
    } else if (len >= MAX_MESSAGE_LENGTH - 100) {
      warningEl.textContent = `${len} / ${MAX_MESSAGE_LENGTH} Zeichen`;
      warningEl.className = "warn";
      sendBtn.disabled = false;
    } else {
      warningEl.textContent = "";
      warningEl.className = "";
      sendBtn.disabled = false;
    }
  });

  // =========================
  // INDICATOR CLICK
  // =========================
  indicatorEl.addEventListener("click", () => {
    scrollToBottom();
    unreadCount = 0;
    updateUnreadIndicator();
  });

  // =========================
  // SCROLL
  // =========================
  messagesEl.addEventListener("scroll", () => {
    if (isUserAtBottom()) {
      unreadCount = 0;
      updateUnreadIndicator();
    }
  });

  console.log("DOM OK");

  loadMessages();
  startPolling();
}

// ======================================================
// HELPERS
// ======================================================
function isUserAtBottom() {
  const threshold = 80;
  const distance =
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  return distance <= threshold;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function updateUnreadIndicator() {
  if (unreadCount > 0) {
    unreadCountEl.textContent = unreadCount;
    indicatorEl.classList.add("visible");
  } else {
    unreadCountEl.textContent = "";
    indicatorEl.classList.remove("visible");
  }
}

function showCooldownWarning() {
  warningEl.textContent = "Bitte kurz warten…";
  warningEl.className = "warn";

  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => {
    warningEl.textContent = "";
    warningEl.className = "";
    cooldownTimer = null;
  }, SEND_COOLDOWN_MS);
}
function formatTimestamp(ts) {
  if (!ts) return "";

  const d = new Date(ts);
  const time = d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  });
  const date = d.toLocaleDateString("de-DE");

  return `${time} · ${date}`;
}

// ======================================================
// RENDER
// ======================================================
function renderMessage({ id, from, message, ts, tempId = null, status = "sent" }) {
if (!message || message.length > MAX_MESSAGE_LENGTH) return null;

const div = document.createElement("div");
div.className = from === withUser ? "other" : "me";

const textEl = document.createElement("div");
textEl.textContent = message;

div.appendChild(textEl);

const timeEl = document.createElement("div");
timeEl.className = "timestamp";
timeEl.textContent = formatTimestamp(ts); // leer bei pending
div.appendChild(timeEl);

  if (id) div.dataset.id = id;
  if (tempId) div.dataset.tempId = tempId;
  if (status === "pending") div.classList.add("pending");
  if (status === "failed") div.classList.add("failed");

  messagesEl.appendChild(div);
  return div;
}

// ======================================================
// LOAD MESSAGES
// ======================================================
async function loadMessages() {
  try {
    const { messages = [] } = await apiFetch("/chat/list?with=" + withUser);
    const wasAtBottom = isUserAtBottom();

    let added = false;

    messages.forEach((m, index) => {
      // 🔧 stabile Fallback-ID
      const messageId =
        m.id || `${m.from}-${m.to}-${m.ts || index}`;

      if (renderedMessageIds.has(messageId)) return;

      renderedMessageIds.add(messageId);
      renderMessage({ ...m, id: messageId });
      added = true;

      // 🔔 NUR fremde Nachrichten zählen
      if (m.from === withUser && !wasAtBottom) {
        unreadCount++;
      }
    });

    // ================================
    // SCROLL & INDICATOR LOGIC
    // ================================
    if (firstLoad) {
      scrollToBottom();
      firstLoad = false;
      unreadCount = 0;
    }
    else if (added && wasAtBottom) {
      scrollToBottom();
      unreadCount = 0;
    }

    updateUnreadIndicator();

  } catch (e) {
    console.error("Load messages failed:", e);
  }
}
// ======================================================
// POLLING
// ======================================================
let poller = null;

function startPolling() {
  if (poller) return;
  poller = setInterval(loadMessages, 3000);
}

function stopPolling() {
  if (poller) {
    clearInterval(poller);
    poller = null;
  }
}

document.addEventListener("visibilitychange", () => {
  document.hidden ? stopPolling() : (loadMessages(), startPolling());
});

// ======================================================
// STARTUP
// ======================================================
startChat();
initE2EKeys();

async function testGenerateAndStoreKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  await storePrivateKey(keyPair.privateKey);

  console.log("✅ Private Key gespeichert");
  console.log("PublicKey:", keyPair.publicKey);
}

async function initE2EKeys() {
  const existingPrivateKey = await loadPrivateKey();

  if (existingPrivateKey) {
    console.log("🔐 E2E: Private Key bereits vorhanden");
    return;
  }

  console.log("🔐 E2E: Erzeuge neues Keypair");

  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveKey"]
  );

  await storePrivateKey(keyPair.privateKey);
  
// Public Key separat speichern (für späteren Austausch)
await idbSet("e2e-public-key", keyPair.publicKey);

console.log("✅ E2E Keypair erzeugt & gespeichert");
}