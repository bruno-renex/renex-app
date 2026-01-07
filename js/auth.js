const API = "https://api.renex.id";

// ================================
// BASE64URL HELPERS (KORREKT)
// ================================
function base64urlToUint8Array(base64url) {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) base64 += "=".repeat(4 - pad);
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function arrayBufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ================================
// REGISTER
// ================================
export async function registerWithPasskey(handle) {
  handle = handle.toLowerCase();
  console.log("📝 Register START:", handle);

  const startRes = await fetch(`${API}/auth/register/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle })
  });

  const startData = await startRes.json();
  console.log("📦 register/start:", startData);

  if (!startData.publicKey) {
    alert("❌ Register start fehlgeschlagen");
    return;
  }

  const publicKey = {
    ...startData.publicKey,
    challenge: base64urlToUint8Array(startData.publicKey.challenge),
    user: {
      ...startData.publicKey.user,
      id: base64urlToUint8Array(startData.publicKey.user.id)
    }
  };

  const credential = await navigator.credentials.create({ publicKey });
  console.log("✅ Credential erstellt:", credential);

await fetch(`${API}/auth/register/finish`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    handle,
    id: credential.id,
    rawId: arrayBufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: arrayBufferToBase64url(
        credential.response.attestationObject
      ),
      clientDataJSON: arrayBufferToBase64url(
        credential.response.clientDataJSON
      )
    }
  })
});

  alert("✅ Passkey registriert");
}

// ================================
// LOGIN
// ================================
export async function loginWithPasskey(handle) {
  handle = handle.toLowerCase();
  console.log("🔐 Login START:", handle);

  const startRes = await fetch(`${API}/auth/login/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle })
  });

  const startData = await startRes.json();
  console.log("📦 login/start:", startData);

  // =========================
  // 🔁 FALL 1: KEIN PASSKEY → REGISTRIEREN
  // =========================
  if (!startData.publicKey) {
    console.log("🆕 Kein Passkey vorhanden → Registrierung");

    const regRes = await fetch(`${API}/auth/register/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle })
    });

    const regData = await regRes.json();
    console.log("📦 register/start:", regData);

    const publicKey = {
      ...regData.publicKey,
      challenge: base64urlToUint8Array(regData.publicKey.challenge),
      user: {
        ...regData.publicKey.user,
        id: base64urlToUint8Array(regData.publicKey.user.id)
      }
    };

    const credential = await navigator.credentials.create({ publicKey });

    await fetch(`${API}/auth/register/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle,
        id: credential.id,
        rawId: arrayBufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          attestationObject: arrayBufferToBase64url(
            credential.response.attestationObject
          ),
          clientDataJSON: arrayBufferToBase64url(
            credential.response.clientDataJSON
          )
        }
      })
    });

console.log("✅ Registrierung abgeschlossen");

// optional kleine Info
alert("Passkey erstellt – bitte erneut einloggen");
location.reload();
return;
}

  // =========================
  // 🔐 FALL 2: LOGIN
  // =========================
  const publicKey = {
    ...startData.publicKey,
    challenge: base64urlToUint8Array(startData.publicKey.challenge),
    allowCredentials: startData.publicKey.allowCredentials.map(c => ({
      ...c,
      id: base64urlToUint8Array(c.id)
    }))
  };

  const assertion = await navigator.credentials.get({ publicKey });

  const res = await fetch(`${API}/auth/login/finish`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    handle,
    id: assertion.id,
    rawId: arrayBufferToBase64url(assertion.rawId),
    type: assertion.type,
    response: {
      authenticatorData: arrayBufferToBase64url(
        assertion.response.authenticatorData
      ),
      clientDataJSON: arrayBufferToBase64url(
        assertion.response.clientDataJSON
      ),
      signature: arrayBufferToBase64url(
        assertion.response.signature
      ),
      userHandle: assertion.response.userHandle
        ? arrayBufferToBase64url(assertion.response.userHandle)
        : null
    }
  })
});
  const data = await res.json();
  console.log("🔐 login/finish:", data);

  if (data.authenticated) {
    localStorage.setItem("session_token", data.session_token);
    localStorage.setItem("my_user", handle);
    window.location.replace("/inbox.html");
  }
}
// ================================
// SESSION HELPERS
// ================================
export function getSession() {
  return localStorage.getItem("session_token");
}
// ================================
// LOGOUT
// ================================
export async function logout() {
  try {
    await fetch(`${API}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    // egal – wir löschen lokal trotzdem
  }

  // 🔥 Session lokal löschen
  localStorage.removeItem("session_token");
  localStorage.removeItem("user_handle");
  localStorage.clear();
  sessionStorage.clear();

  // 🔁 zurück zum Login
  window.location.replace("/login.html");
}