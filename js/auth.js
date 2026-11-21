/* auth.js — PBKDF2 + salt + pepper (static-site compatible) */
const Auth = (() => {
  const SESSION_KEY = "udmfe.session";

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    let bin = "";
    const a = new Uint8Array(bytes);
    for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
    return btoa(bin);
  }

  function derive(password, saltBytes) {
    return new Promise((resolve, reject) => {
      const p = window.UDMFE_AUTH_PARAMS;
      const material = new TextEncoder().encode(password + p.pepper);
      crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"])
        .then(key => crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: p.iterations, hash: "SHA-256" }, key, p.hashLength * 8))
        .then(bits => resolve(bytesToB64(new Uint8Array(bits))))
        .catch(reject);
    });
  }

  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  async function login(username, password) {
    const data = await fetch("data/users.json").then(r => r.json());
    const user = (data.users || []).find(u => u.username === username);
    if (!user) {
      await derive(password, b64ToBytes("AAAAAAAAAAAAAAAAAAAAAA=="));
      return { ok: false, error: "Invalid username or password" };
    }
    const computed = await derive(password, b64ToBytes(user.salt));
    if (!safeEqual(computed, user.hash)) return { ok: false, error: "Invalid username or password" };
    const session = { username: user.username, role: user.role, at: Date.now() };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { ok: true, session };
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    GitHubStore.clearToken();
  }

  function current() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
  }

  function can(permission) {
    const s = current();
    if (!s) return false;
    const roles = window.UDMFE_USERS_FILE?.roles;
    const role = roles?.[s.role];
    return !!(role && role[permission]);
  }

  async function makeUserRecord(username, password, role) {
    const data = await fetch("data/users.json").then(r => r.json());
    const p = data.authParams;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const material = new TextEncoder().encode(password + p.pepper);
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: p.iterations, hash: "SHA-256" }, key, p.hashLength * 8);
    return { username, role, salt: bytesToB64(salt), hash: bytesToB64(new Uint8Array(bits)), createdAt: new Date().toISOString().slice(0, 10) };
  }

  return { login, logout, current, can, makeUserRecord, b64ToBytes, bytesToB64, derive, safeEqual };
})();