/* admin.js — login, GitHub token, field management, user management (RBAC), change password */
var Admin = { tab: "fields", flash: null };

function flash(kind, text) { Admin.flash = { kind, text }; }
function renderFlash() { if (!Admin.flash) return ""; const f = Admin.flash; Admin.flash = null; return '<div class="msg ' + f.kind + '">' + escHtml(f.text) + '</div>'; }

function renderAdmin() {
  const s = Auth.current();
  if (!s) return renderLogin();

  const tabs = [
    { k: "fields", l: "Fields" },
    { k: "users", l: "Users", perm: "canManageUsers" },
    { k: "token", l: "GitHub Token" },
    { k: "changepass", l: "Change Password" }
  ].filter(t => !t.perm || Auth.can(t.perm));

  const tabBar = tabs.map(t => '<div class="admin-tab ' + (Admin.tab === t.k ? "active" : "") + '" data-atab="' + t.k + '">' + t.l + '</div>').join("");

  let body = "";
  if (Admin.tab === "fields") body = renderFieldsTab();
  else if (Admin.tab === "users") body = Auth.can("canManageUsers") ? renderUsersTab() : "";
  else if (Admin.tab === "token") body = renderTokenTab();
  else if (Admin.tab === "changepass") body = renderChangePassTab();

  return '<div class="panel admin-panel">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
      '<h1>Admin — ' + escHtml(s.username) + ' <span class="pill ' + escHtml(s.role) + '">' + escHtml(s.role) + '</span></h1>' +
      '<button class="btn secondary" id="logout-btn">Sign out</button>' +
    '</div>' +
    renderFlash() +
    (GitHubStore.hasToken() ? '' : '<div class="msg info">No GitHub token set — you can edit in the UI but cannot save. Add one in the GitHub Token tab.</div>') +
    '<div class="admin-tabs">' + tabBar + '</div>' +
    body +
  '</div>';
}

function renderLogin() {
  return '<div class="panel"><h1>Admin sign in</h1>' + renderFlash() +
    '<form id="login-form"><div class="field"><label>Username</label><input id="login-user" autocomplete="username" required /></div>' +
    '<div class="field"><label>Password</label><input id="login-pass" type="password" autocomplete="current-password" required /></div>' +
    '<div class="btn-row"><button class="btn" type="submit">Sign in</button></div></form></div>';
}

function wireLogin() {
  const form = $("login-form");
  if (!form) return;
  form.addEventListener("submit", e => {
    e.preventDefault();
    const u = $("login-user").value, p = $("login-pass").value;
    Auth.login(u, p).then(res => {
      if (res.ok) flash("ok", "Signed in as " + res.session.username + " (" + res.session.role + ")");
      else flash("err", res.error);
      navigate("#/admin");
    });
  });
}

function wireAdminDashboard() {
  wireLogin();
  const logout = $("logout-btn");
  if (logout) logout.addEventListener("click", () => { Auth.logout(); flash("info", "Signed out."); navigate("#/admin"); });

  document.querySelectorAll("[data-atab]").forEach(tab => tab.addEventListener("click", () => { Admin.tab = tab.dataset.atab; render(); }));

  if (Admin.tab === "fields") wireFieldsTab();
  if (Admin.tab === "users") wireUsersTab();
  if (Admin.tab === "token") wireTokenTab();
  if (Admin.tab === "changepass") wireChangePassTab();
}

/* ---------- Fields tab ---------- */
function renderFieldsTab() {
  if (!Auth.can("canEditFields")) return '<div class="msg err">Your role cannot edit fields.</div>';
  const ds = state.data[state.mode];
  const rows = ds.fields.map(f => '<tr><td><b>' + escHtml(f.name) + '</b><br><span class="hint">' + escHtml(f.path) + '</span></td><td>' + escHtml(f.type) + (f.repeated ? "[]" : "") + '</td><td>' + escHtml(f.description || "") + '</td><td><button class="btn secondary" data-edit-field="' + escHtml(f.path) + '">Edit</button> <button class="btn danger" data-del-field="' + escHtml(f.path) + '">Delete</button></td></tr>').join("");
  return '<div class="btn-row"><button class="btn" data-new-field>+ Add new field</button></div><table class="table"><thead><tr><th>Field</th><th>Type</th><th>Description</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function wireFieldsTab() {
  document.querySelectorAll("[data-edit-field]").forEach(btn => btn.addEventListener("click", () => openFieldEditor(btn.dataset.editField)));
  document.querySelectorAll("[data-del-field]").forEach(btn => btn.addEventListener("click", () => deleteField(btn.dataset.delField)));
  const newBtn = document.querySelector("[data-new-field]");
  if (newBtn) newBtn.addEventListener("click", () => openFieldEditor(null));
}

function openFieldEditor(path) {
  const ds = state.data[state.mode];
  const field = path ? ds.byPath[path] : null;
  const isNew = !field;

  const typeOpts = ["string", "int32", "int64", "uint32", "uint64", "float", "double", "bool", "bytes", "timestamp", "enum", "object"].map(t => '<option value="' + t + '" ' + (field && field.type === t ? "selected" : "") + '>' + t + '</option>').join("");
  const kindOpts = ["", "hash", "ip", "email", "url", "port", "mac", "hostname", "geo", "identifier", "aws_arn", "gcp_resource", "azure_resource_id", "k8s_resource", "okta_user_id"].map(k => '<option value="' + k + '" ' + (field && field.kind === k ? "selected" : "") + '>' + (k || "(none)") + '</option>').join("");
  const parentOptions = [""].concat(ds.fields.map(f => f.path)).map(p => '<option value="' + escHtml(p) + '" ' + (field && field.parentPath === p ? "selected" : "") + '>' + (p || "(root)") + '</option>').join("");

  const examplesHtml = (field ? field.examples : []).map((e, i) => '<div class="example-row"><input type="text" value="' + escHtml(e) + '" data-example-idx="' + i + '" placeholder="Example value ' + (i+1) + '" /><button type="button" class="btn danger btn-sm" data-del-example="' + i + '">×</button></div>').join("") + '<div class="example-row"><input type="text" data-example-idx="new" placeholder="Add another example..." /><button type="button" class="btn secondary btn-sm" id="add-example">+</button></div>';
  const aliasesHtml = (field ? field.aliases : []).map((a, i) => '<div class="alias-row"><input type="text" value="' + escHtml(a) + '" data-alias-idx="' + i + '" placeholder="Alias ' + (i+1) + '" /><button type="button" class="btn danger btn-sm" data-del-alias="' + i + '">×</button></div>').join("") + '<div class="alias-row"><input type="text" data-alias-idx="new" placeholder="Add another alias..." /><button type="button" class="btn secondary btn-sm" id="add-alias">+</button></div>';

  const formHtml = '<div class="panel"><span class="back" data-route="#/admin">← Back to admin</span><h1>' + (isNew ? "Add new field" : "Edit: " + escHtml(field.name)) + '</h1>' + renderFlash() +
    '<form id="field-form"><input type="hidden" id="f-path" value="' + escHtml(path || "") + '" />' +
    '<div class="grid2"><div class="field"><label>Field name</label><input id="f-name" value="' + escHtml(field ? field.name : "") + '" ' + (isNew ? "" : "readonly") + ' required /></div><div class="field"><label>Parent path</label><select id="f-parent">' + parentOptions + '</select></div></div>' +
    '<div class="grid2"><div class="field"><label>Type</label><select id="f-type">' + typeOpts + '</select></div><div class="field"><label>Repeated</label><select id="f-repeated"><option value="false" ' + (field && !field.repeated ? "selected" : "") + '>No</option><option value="true" ' + (field && field.repeated ? "selected" : "") + '>Yes</option></select></div></div>' +
    '<div class="grid2"><div class="field"><label>Kind (semantic tag)</label><select id="f-kind">' + kindOpts + '</select></div><div class="field"><label>Category</label><input id="f-category" value="' + escHtml(field ? field.category : "") + '" placeholder="e.g. Network, Identity, Cloud" /></div></div>' +
    '<div class="field"><label>Description</label><textarea id="f-desc">' + escHtml(field ? field.description : "") + '</textarea></div>' +
    '<div class="field"><label>Examples</label><div id="examples-container">' + examplesHtml + '</div></div>' +
    '<div class="field"><label>Aliases (extra search terms)</label><div id="aliases-container">' + aliasesHtml + '</div></div>' +
    '<div class="btn-row"><button class="btn" type="submit">' + (GitHubStore.hasToken() ? "Save & commit to GitHub" : "Save (needs token)") + '</button>' + (isNew ? '' : '<button class="btn danger" type="button" id="del-field-btn">Delete field</button>') + '<button class="btn secondary" type="button" data-route="#/admin">Cancel</button></div></form></div>';

  $("app").innerHTML = formHtml;
  wireFieldForm(path);
}

function wireFieldForm(path) {
  const form = $("field-form"); if (!form) return;

  form.addEventListener("click", e => {
    if (e.target.id === "add-example") { const c = $("examples-container"); const idx = c.querySelectorAll("[data-example-idx]").length; const div = document.createElement("div"); div.className = "example-row"; div.innerHTML = '<input type="text" data-example-idx="' + idx + '" placeholder="Example value ' + (idx+1) + '" /><button type="button" class="btn danger btn-sm" data-del-example="' + idx + '">×</button>'; c.appendChild(div); }
    else if (e.target.id === "add-alias") { const c = $("aliases-container"); const idx = c.querySelectorAll("[data-alias-idx]").length; const div = document.createElement("div"); div.className = "alias-row"; div.innerHTML = '<input type="text" data-alias-idx="' + idx + '" placeholder="Alias ' + (idx+1) + '" /><button type="button" class="btn danger btn-sm" data-del-alias="' + idx + '">×</button>'; c.appendChild(div); }
    else if (e.target.dataset.delExample !== undefined) e.target.closest(".example-row").remove();
    else if (e.target.dataset.delAlias !== undefined) e.target.closest(".alias-row").remove();
  });

  form.addEventListener("submit", e => { e.preventDefault(); saveField(path); });

  const delBtn = $("del-field-btn");
  if (delBtn) delBtn.addEventListener("click", () => { if (confirm("Delete this field?")) deleteField(path); });
}

function collectFieldForm() {
  const val = id => document.getElementById(id).value;
  const examples = Array.from(document.querySelectorAll("#examples-container input[data-example-idx]")).map(el => el.value.trim()).filter(Boolean);
  const aliases = Array.from(document.querySelectorAll("#aliases-container input[data-alias-idx]")).map(el => el.value.trim()).filter(Boolean);
  return { name: val("f-name").trim(), parentPath: val("f-parent") || "", type: val("f-type"), repeated: val("f-repeated") === "true", kind: val("f-kind") || "", category: val("f-category").trim(), description: val("f-desc").trim(), examples, aliases };
}

function saveField(oldPath) {
  const rec = collectFieldForm();
  if (!rec.name) { flash("err", "Field name is required."); return; }
  const ds = state.data[state.mode];

  if (oldPath) {
    const idx = ds.fields.findIndex(f => f.path === oldPath);
    if (idx === -1) { flash("err", "Field not found."); return; }
    const newPath = rec.parentPath ? rec.parentPath + "." + rec.name : rec.name;
    ds.fields[idx] = Object.assign({}, ds.fields[idx], rec, { path: newPath, hasChildren: false });
    if (newPath !== oldPath) { ds.byPath = {}; ds.children = {}; ds.fields.forEach(f => { ds.byPath[f.path] = f; (ds.children[f.parentPath] = ds.children[f.parentPath] || []).push(f); }); }
  } else {
    const newPath = rec.parentPath ? rec.parentPath + "." + rec.name : rec.name;
    if (ds.byPath[newPath]) { flash("err", "Field already exists."); return; }
    const newField = Object.assign({}, rec, { path: newPath, hasChildren: false });
    ds.fields.push(newField); ds.byPath[newPath] = newField; (ds.children[rec.parentPath] = ds.children[rec.parentPath] || []).push(newField);
  }

  rebuildDataset(ds);

  if (!GitHubStore.hasToken()) { flash("info", "Saved in this session only — no GitHub token."); navigate("#/admin"); return; }

  const filePath = state.mode === "event" ? "data/udm.json" : "data/entity.json";
  const json = buildJsonFromDataset(ds);
  GitHubStore.saveJson(filePath, json, (oldPath ? "Update" : "Add") + " field " + rec.name)
    .then(() => { flash("ok", "Committed to GitHub. Live in ~1 min."); navigate("#/admin"); })
    .catch(err => flash("err", err.message));
}

function deleteField(path) {
  const ds = state.data[state.mode];
  ds.fields = ds.fields.filter(f => f.path !== path);
  rebuildDataset(ds);

  if (!GitHubStore.hasToken()) { flash("info", "Deleted in session only (no token)."); navigate("#/admin"); return; }

  const filePath = state.mode === "event" ? "data/udm.json" : "data/entity.json";
  const json = buildJsonFromDataset(ds);
  GitHubStore.saveJson(filePath, json, "Delete field " + path)
    .then(() => { flash("ok", "Deleted and committed."); navigate("#/admin"); })
    .catch(err => flash("err", err.message));
}

function rebuildDataset(ds) { ds.byPath = {}; ds.children = {}; ds.fields.forEach(f => { ds.byPath[f.path] = f; (ds.children[f.parentPath] = ds.children[f.parentPath] || []).push(f); }); }

function buildJsonFromDataset(ds) {
  const root = { _schema_version: ds.meta.schema, _udm_version: ds.meta.udm, _updated: new Date().toISOString().slice(0, 10) };
  ds.fields.forEach(f => {
    const parts = f.path.split("."); let node = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        node[part] = { _type: f.type, _repeated: f.repeated, _description: f.description, _examples: f.examples, _aliases: f.aliases, _category: f.category, _kind: f.kind };
        Object.keys(node[part]).forEach(k => { if (node[part][k] === "" || (Array.isArray(node[part][k]) && node[part][k].length === 0)) delete node[part][k]; });
      } else { node[part] = node[part] || { _type: "object" }; node = node[part]; }
    });
  });
  return root;
}

/* ---------- Users tab ---------- */
function renderUsersTab() {
  const data = window.UDMFE_USERS_FILE || { users: [], roles: {} };
  const rows = data.users.map(u => '<tr><td><b>' + escHtml(u.username) + '</b></td><td><span class="pill ' + escHtml(u.role) + '">' + escHtml(u.role) + '</span></td><td>' + escHtml(u.createdAt || "") + '</td><td>' + (u.username === "admin" ? "" : '<button class="btn danger" data-deluser="' + escHtml(u.username) + '">Remove</button>') + '</td></tr>').join("");
  const roleOpts = Object.keys(data.roles).map(r => '<option value="' + escHtml(r) + '">' + escHtml(r) + '</option>').join("");
  return '<h2 style="color:var(--accent2)">Add user</h2><form id="user-form"><div class="grid2"><div class="field"><label>Username</label><input id="u-name" required /></div><div class="field"><label>Role</label><select id="u-role">' + roleOpts + '</select></div></div><div class="field"><label>Password</label><input id="u-pass" type="password" required /><div class="hint">Hashed with PBKDF2 (' + escHtml(String(data.authParams.iterations)) + ' iters) + salt + pepper. Plaintext never leaves the browser.</div></div><div class="btn-row"><button class="btn" type="submit">Create user</button></div></form><table class="table"><thead><tr><th>User</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody>' + rows + '</tbody></table><p class="hint">Roles: <b>admin</b> = edit fields + manage users · <b>editor</b> = edit fields · <b>viewer</b> = read only.</p>';
}

function wireUsersTab() {
  const form = $("user-form");
  if (form) form.addEventListener("submit", e => {
    e.preventDefault();
    const name = $("u-name").value.trim(), role = $("u-role").value, pass = $("u-pass").value;
    const data = window.UDMFE_USERS_FILE;
    if (data.users.some(u => u.username === name)) { flash("err", "That username already exists."); return navigate("#/admin"); }
    Auth.makeUserRecord(name, pass, role).then(rec => {
      data.users.push(rec);
      if (!GitHubStore.hasToken()) { flash("info", "User " + name + " added in session only (no token)."); return navigate("#/admin"); }
      GitHubStore.saveJson("data/users.json", data, "Add user " + name + " (" + role + ")").then(() => { flash("ok", "User " + name + " created and committed."); navigate("#/admin"); }).catch(err => flash("err", err.message));
    });
  });
  document.querySelectorAll("[data-deluser]").forEach(btn => btn.addEventListener("click", () => {
    const name = btn.dataset.deluser;
    if (!confirm("Remove user " + name + "?")) return;
    const data = window.UDMFE_USERS_FILE;
    data.users = data.users.filter(u => u.username !== name);
    if (!GitHubStore.hasToken()) { flash("info", "Removed " + name + " in session only."); return navigate("#/admin"); }
    GitHubStore.saveJson("data/users.json", data, "Remove user " + name).then(() => { flash("ok", "User " + name + " removed and committed."); navigate("#/admin"); }).catch(err => flash("err", err.message));
  }));
}

/* ---------- Token tab ---------- */
function renderTokenTab() {
  const has = GitHubStore.hasToken();
  return '<h2 style="color:var(--accent2)">GitHub write token</h2><div class="msg info">Saving any change commits to <code>' + escHtml(GitHubStore.owner) + '/' + escHtml(GitHubStore.repo) + '</code>. That requires a <b>fine-grained Personal Access Token</b> with <b>Contents: Read & Write</b> on this repo. The token is held only in this browser tab (sessionStorage) and is cleared on sign out — it is never committed.</div><div class="field"><label>Token</label><input id="gh-token" type="password" placeholder="' + (has ? "•••••••• (a token is set)" : "github_pat_...") + '" /></div><div class="btn-row"><button class="btn" id="save-token">Save token</button><button class="btn secondary" id="verify-token">Verify access</button>' + (has ? '<button class="btn danger" id="clear-token">Clear token</button>' : '') + '</div><div id="token-result"></div>';
}
function wireTokenTab() {
  const save = $("save-token");
  if (save) save.addEventListener("click", () => { const v = $("gh-token").value.trim(); if (!v) { flash("err", "Paste a token first."); return navigate("#/admin"); } GitHubStore.setToken(v); flash("ok", "Token saved for this session."); navigate("#/admin"); });
  const verify = $("verify-token");
  if (verify) verify.addEventListener("click", () => { const box = $("token-result"); const inp = $("gh-token").value.trim(); if (inp) GitHubStore.setToken(inp); box.innerHTML = '<div class="msg info">Checking…</div>'; GitHubStore.verifyToken().then(res => box.innerHTML = res.ok ? '<div class="msg ok">✓ Write access confirmed to ' + escHtml(res.user) + '.</div>' : '<div class="msg err">✗ ' + escHtml(res.error) + '</div>'); });
  const clear = $("clear-token");
  if (clear) clear.addEventListener("click", () => { GitHubStore.clearToken(); flash("info", "Token cleared."); navigate("#/admin"); });
}

/* ---------- Change Password tab ---------- */
function renderChangePassTab() {
  const s = Auth.current(), data = window.UDMFE_USERS_FILE;
  return '<div class="panel"><h2 style="color:var(--accent2)">Change your password</h2><div class="msg info">Your password is hashed with PBKDF2-HMAC-SHA256 (' + escHtml(String(data.authParams.iterations)) + ' iterations) + unique 16-byte salt + pepper. The pepper is in <code>users.json</code> but the real write-protection is your GitHub token — without it, password changes cannot be persisted.</div><form id="changepass-form"><div class="field"><label>Current password</label><input id="cp-old" type="password" autocomplete="current-password" required /></div><div class="field"><label>New password</label><input id="cp-new" type="password" autocomplete="new-password" required minlength="12" /><div class="hint">Minimum 12 characters. Use a passphrase or password manager.</div></div><div class="field"><label>Confirm new password</label><input id="cp-confirm" type="password" autocomplete="new-password" required /></div><div class="btn-row"><button class="btn" type="submit" id="cp-save">Save & commit</button><button class="btn secondary" type="button" data-route="#/admin">Cancel</button></div><div id="changepass-result"></div></form></div>';
}
function wireChangePassTab() {
  const form = $("changepass-form"); if (!form) return;
  form.addEventListener("submit", e => {
    e.preventDefault();
    const oldPass = $("cp-old").value, newPass = $("cp-new").value, confirmPass = $("cp-confirm").value, box = $("changepass-result");
    if (newPass !== confirmPass) { box.innerHTML = '<div class="msg err">Passwords do not match.</div>'; return; }
    if (newPass.length < 12) { box.innerHTML = '<div class="msg err">Password must be at least 12 characters.</div>'; return; }
    const session = Auth.current();
    const data = window.UDMFE_USERS_FILE;
    const user = data.users.find(u => u.username === session.username);
    if (!user) { box.innerHTML = '<div class="msg err">User not found.</div>'; return; }
    const saltBytes = Auth.b64ToBytes(user.salt);
    Auth.derive(oldPass, saltBytes).then(computed => {
      if (!Auth.safeEqual(computed, user.hash)) { box.innerHTML = '<div class="msg err">Current password is incorrect.</div>'; return; }
      const newSalt = crypto.getRandomValues(new Uint8Array(16));
      Auth.derive(newPass, newSalt).then(newHash => {
        user.salt = Auth.bytesToB64(newSalt); user.hash = newHash; user.updatedAt = new Date().toISOString().slice(0, 10);
        if (!GitHubStore.hasToken()) { box.innerHTML = '<div class="msg info">Password changed in this session only — no GitHub token.</div>'; return; }
        GitHubStore.saveJson("data/users.json", data, "Update password for " + session.username).then(() => { box.innerHTML = '<div class="msg ok">✓ Password changed and committed. You will need to sign in again.</div>'; setTimeout(() => { Auth.logout(); navigate("#/admin"); }, 2000); }).catch(err => box.innerHTML = '<div class="msg err">✗ ' + escHtml(err.message) + '</div>');
      });
    });
  });
}

function wireAdminDashboard() {
  wireLogin();
  const logout = $("logout-btn");
  if (logout) logout.addEventListener("click", () => { Auth.logout(); flash("info", "Signed out."); navigate("#/admin"); });

  document.querySelectorAll("[data-atab]").forEach(tab => tab.addEventListener("click", () => { Admin.tab = tab.dataset.atab; render(); }));

  if (Admin.tab === "fields") wireFieldsTab();
  if (Admin.tab === "users") wireUsersTab();
  if (Admin.tab === "token") wireTokenTab();
  if (Admin.tab === "changepass") wireChangePassTab();
}

function renderLogin() {
  return '<div class="panel"><h1>Admin sign in</h1>' + renderFlash() + '<form id="login-form"><div class="field"><label>Username</label><input id="login-user" autocomplete="username" required /></div><div class="field"><label>Password</label><input id="login-pass" type="password" autocomplete="current-password" required /></div><div class="btn-row"><button class="btn" type="submit">Sign in</button></div></form></div>';
}

function wireLogin() {
  const form = $("login-form");
  if (!form) return;
  form.addEventListener("submit", e => { e.preventDefault(); const u = $("login-user").value, p = $("login-pass").value; Auth.login(u, p).then(res => { if (res.ok) flash("ok", "Signed in as " + res.session.username + " (" + res.session.role + ")"); else flash("err", res.error); navigate("#/admin"); }); });
}

function flash(kind, text) { Admin.flash = { kind, text }; }
function renderFlash() { if (!Admin.flash) return ""; const f = Admin.flash; Admin.flash = null; return '<div class="msg ' + f.kind + '">' + escHtml(f.text) + '</div>'; }