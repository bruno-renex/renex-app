// ================================
// CONFIG
// ================================
const API = "https://api.renex.id";

// ================================
// HELPERS
// ================================
function getToken() {
  return localStorage.getItem("session_token");
}

async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + getToken(),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }

  return res.json();
}

// ================================
// DOM
// ================================
const pendingEl  = document.getElementById("pending");
const acceptedEl = document.getElementById("accepted");

const addInput  = document.getElementById("add-handle");
const addBtn    = document.getElementById("add-btn");
const logoutBtn = document.getElementById("logout-btn");

// ================================
// INIT
// ================================
document.addEventListener("DOMContentLoaded", () => {
  if (!getToken()) {
    location.href = "/login.html";
    return;
  }

  loadContacts();
});

// ================================
// LOAD CONTACTS
// ================================
async function loadContacts() {
  pendingEl.innerHTML = "";
  acceptedEl.innerHTML = "";

  try {
    const data = await apiFetch("/contacts/list");
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];

    if (contacts.length === 0) {
      acceptedEl.appendChild(emptyLi("Noch keine Kontakte"));
      return;
    }

    contacts.forEach(contact => {
      if (contact.status === "pending") {
        pendingEl.appendChild(renderPending(contact));
      }
      if (contact.status === "accepted") {
        acceptedEl.appendChild(renderAccepted(contact));
      }
    });

    if (!pendingEl.children.length) {
      pendingEl.appendChild(emptyLi("Keine offenen Anfragen"));
    }

    if (!acceptedEl.children.length) {
      acceptedEl.appendChild(emptyLi("Noch keine Kontakte"));
    }

  } catch (err) {
    console.error("Load contacts failed:", err);
    alert("Fehler beim Laden der Kontakte");
  }
}

// ================================
// RENDER
// ================================
function renderPending(contact) {
  const li = document.createElement("li");
  li.textContent = contact.display_handle || contact.handle;

  const acceptBtn = document.createElement("button");
  acceptBtn.textContent = "Annehmen";
  acceptBtn.onclick = async () => {
    await apiFetch("/contacts/accept", {
      method: "POST",
      body: JSON.stringify({ contact: contact.handle })
    });
    loadContacts();
  };

  const rejectBtn = document.createElement("button");
  rejectBtn.textContent = "Ablehnen";
  rejectBtn.onclick = async () => {
    await apiFetch("/contacts/reject", {
      method: "POST",
      body: JSON.stringify({ contact: contact.handle })
    });
    loadContacts();
  };

  li.appendChild(acceptBtn);
  li.appendChild(rejectBtn);
  return li;
}
function renderAccepted(contact) {
  const li = document.createElement("li");

  const a = document.createElement("a");
  a.href = `/chat.html?with=${encodeURIComponent(contact.handle)}`;
  a.textContent = contact.display_handle || contact.handle;

  a.style.cursor = "pointer";
  a.style.textDecoration = "underline";

  li.appendChild(a);
  return li;
}

function emptyLi(text) {
  const li = document.createElement("li");
  li.textContent = text;
  li.style.opacity = "0.6";
  return li;
}

// ================================
// ADD CONTACT
// ================================
addBtn?.addEventListener("click", async () => {
  const handle = addInput.value.trim().toLowerCase();
  if (!handle) return;

  try {
    await apiFetch("/contacts/request", {
      method: "POST",
      body: JSON.stringify({ contact: handle })
    });

    addInput.value = "";
    loadContacts();
  } catch (err) {
    alert("Kontaktanfrage fehlgeschlagen");
  }
});

// ================================
// LOGOUT
// ================================
logoutBtn?.addEventListener("click", async () => {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch {}

  localStorage.clear();
  location.href = "/login.html";
});
