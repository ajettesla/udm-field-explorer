/* github.js — commits JSON changes via GitHub API */
const GitHubStore = (() => {
  const TOKEN_KEY = "udmfe.github.token";
  const owner = "ajettesla";
  const repo = "detection-rules";
  const branch = "main";

  function hasToken() { return !!sessionStorage.getItem(TOKEN_KEY); }
  function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
  function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

  async function api(path, options) {
    const token = getToken();
    if (!token) throw new Error("No GitHub token set");
    const headers = { Authorization: "token " + token, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" };
    const res = await fetch("https://api.github.com" + path, { ...options, headers });
    if (!res.ok) { const txt = await res.text(); throw new Error("GitHub API " + res.status + ": " + txt); }
    return res.json();
  }

  async function getFileSha(path) {
    try { const data = await api("/repos/" + owner + "/" + repo + "/contents/" + path + "?ref=" + branch); return data.sha; }
    catch { return null; }
  }

  async function saveJson(filePath, obj, message) {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
    const sha = await getFileSha(filePath);
    const body = { message, content, branch };
    if (sha) body.sha = sha;
    await api("/repos/" + owner + "/" + repo + "/contents/" + filePath, { method: "PUT", body: JSON.stringify(body) });
  }

  async function verifyToken() {
    try { const data = await api("/user"); return { ok: true, user: data.login }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  return { hasToken, getToken, setToken, clearToken, saveJson, verifyToken, owner, repo };
})();