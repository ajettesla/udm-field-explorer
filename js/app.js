/* ============================================================
   UDM Field Explorer — app.js
   All UDM knowledge lives in data/*.json. This file is only the
   engine: it loads the JSON, indexes it, and renders the UI.

   Two datasets, switched by tab:
     event  -> data/udm.json    parser prefix event.idm.read_only_udm.
     entity -> data/entity.json parser prefix event.idm.graph.
   ============================================================ */

"use strict";

/* -------------------- pure logic (no DOM) -------------------- */

const VALID_TYPES = ["string", "int32", "int64", "uint32", "uint64", "float", "double", "bool", "boolean", "bytes", "timestamp", "enum", "object"];

function buildIndex(root) {
  const fields = []; const warnings = [];
  function walk(node, parentPath) {
    Object.keys(node).forEach(key => {
      if (key[0] === "_") return;
      const val = node[key]; const path = parentPath ? parentPath + "." + key : key;
      if (typeof val !== "object" || val === null || Array.isArray(val)) { warnings.push(path + ": field definition must be a JSON object"); return; }
      const type = val._type || "object";
      if (!VALID_TYPES.includes(type)) warnings.push(path + ': unknown _type "' + type + '"');
      const childKeys = Object.keys(val).filter(k => k[0] !== "_");
      fields.push({ name: key, path, type, repeated: val._repeated === true, description: typeof val._description === "string" ? val._description : "", example: typeof val._example === "string" ? val._example : "", examples: Array.isArray(val._examples) ? val._examples : (typeof val._example === "string" ? [val._example] : []), aliases: Array.isArray(val._aliases) ? val._aliases : [], category: typeof val._category === "string" ? val._category : "", kind: typeof val._kind === "string" ? val._kind : "", parentPath, hasChildren: childKeys.length > 0 });
      if (childKeys.length > 0) walk(val, path);
    });
  }
  walk(root, "");
  return { fields, warnings };
}

function parseRegexQuery(query) { const m = /^\/(.+)\/([a-z]*)$/.exec(query.trim()); if (!m) return null; return new RegExp(m[1], m[2]); }

function searchFields(fields, query, limit, scope) {
  limit = limit || 50; scope = scope || { field: true, value: true };
  const raw = String(query || "").trim(); if (!raw) return { results: [], total: 0, mode: "text", error: null };
  let regex = null; try { regex = parseRegexQuery(raw); } catch (e) { return { results: [], total: 0, mode: "regex", error: e.message }; }
  if (regex) { const matched = fields.filter(f => regex.test(f.path)); matched.sort((a, b) => a.path.localeCompare(b.path)); return { results: matched.slice(0, limit), total: matched.length, mode: "regex", error: null }; }
  const q = raw.toLowerCase(); const scored = [];
  fields.forEach(f => {
    const name = f.name.toLowerCase(), path = f.path.toLowerCase(), aliases = f.aliases.map(a => String(a).toLowerCase()), desc = f.description.toLowerCase(), kind = (f.kind || "").toLowerCase(), examples = f.examples.map(e => String(e).toLowerCase());
    let score = -1;
    if (scope.field) {
      if (name === q) score = 0;
      else if (path === q) score = 1;
      else if (name.startsWith(q)) score = 2;
      else if (kind && kind === q) score = 3;
      else if (aliases.some(a => a === q || a.startsWith(q))) score = 4;
      else if (path.includes(q)) score = 5;
      else if (aliases.some(a => a.includes(q))) score = 6;
      else if (kind && kind.includes(q)) score = 7;
    }
    if (score === -1 && scope.value && examples.some(e => e.includes(q))) score = 8;
    if (score === -1 && scope.field && desc.includes(q)) score = 9;
    if (score !== -1) { const matchedExample = scope.value ? examples.find(e => e.includes(q)) : null; scored.push({ score, field: f, matchedExample: matchedExample ? f.examples[examples.indexOf(matchedExample)] : null }); }
  });
  scored.sort((a, b) => a.score - b.score || a.field.path.localeCompare(b.field.path));
  const top = scored.slice(0, limit);
  return { results: top.map(s => s.field), matchedExamples: top.map(s => s.matchedExample), total: scored.length, mode: "text", error: null };
}

function toParserPath(udmPath, mode) { const prefix = PARSER_PREFIXES[mode] || PARSER_PREFIXES.event; return prefix + udmPath; }
function typeClass(type) { return TYPE_CLASSES[type] || "t-object"; }
function typeLabel(field) { return TYPE_LABELS[field.type] || field.type.toUpperCase(); }
function treeTag(field) { if (field.type === "object" && !field.repeated) return ""; return field.type + (field.repeated ? "[]" : ""); }
function escHtml(s) { return String(s).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, """).replace(/'/g, "'"); }

/* -------------------- state -------------------- */

function emptyDataset() { return { meta: {}, fields: [], byPath: {}, children: {}, common: [], loaded: false, error: null }; }
const state = { mode: "event", data: { event: emptyDataset(), entity: emptyDataset() }, view: "tree", selectedPath: null, results: [], activeResult: -1, searchScope: { field: true, value: true } };
function cur() { return state.data[state.mode]; }
function $(id) { return document.getElementById(id); }

/* -------------------- view helpers -------------------- */

function setView(view) { state.view = view; $("tree").hidden = view !== "tree"; $("results").hidden = view !== "search"; $("common").hidden = view !== "common"; $("common-toggle").setAttribute("aria-pressed", view === "common" ? "true" : "false"); }
function showBanner(html) { const b = $("banner"); b.innerHTML = html; b.hidden = false; }
function clearBanner() { $("banner").hidden = true; $("banner").innerHTML = ""; }

/* -------------------- load data (attack-detect pattern) -------------------- */

async function loadData() {
  // Load all 3 files in parallel
  const responses = await Promise.all([
    fetch("data/udm.json"),
    fetch("data/entity.json"),
    fetch("data/users.json")
  ]);
  const [udmRes, entityRes, usersRes] = responses;
  if (!udmRes.ok) throw new Error("udm.json HTTP " + udmRes.status);
  if (!entityRes.ok) throw new Error("entity.json HTTP " + entityRes.status);
  if (!usersRes.ok) throw new Error("users.json HTTP " + usersRes.status);

  const udm = await udmRes.json();
  const entity = await entityRes.json();
  const users = await usersRes.json();

  // Load event dataset
  loadDataset("event", udm);

  // Load entity dataset
  loadDataset("entity", entity);

  // Load users
  window.UDMFE_USERS_FILE = users;
  window.UDMFE_AUTH_PARAMS = users.authParams;

  // Load common.json (optional)
  try {
    const commonRes = await fetch("data/common.json");
    if (commonRes.ok) {
      const common = await commonRes.json();
      const ev = state.data.event;
      ev.common = (common.fields || []).filter(p => {
        if (ev.byPath[p]) return true;
        console.warn("common.json entry not found in udm.json:", p);
        return false;
      });
    }
  } catch (e) { console.warn("common.json load failed:", e); }

  renderTree();
  renderCommon();
  renderFooter();
}

function loadDataset(mode, json) {
  const ds = state.data[mode];
  ds.meta = { schema: json._schema_version || "", udm: json._udm_version || "", updated: json._updated || "" };
  const built = buildIndex(json);
  ds.fields = built.fields; ds.byPath = {}; ds.children = {};
  ds.fields.forEach(f => { ds.byPath[f.path] = f; (ds.children[f.parentPath] = ds.children[f.parentPath] || []).push(f); });
  ds.loaded = true;
  if (built.warnings.length) built.warnings.forEach(w => console.warn(mode + " dataset:", w));
}

/* -------------------- mode switching -------------------- */

function setMode(mode) {
  if (mode === state.mode) return;
  if (mode === "entity" && !state.data.entity.loaded) return;
  state.mode = mode; state.selectedPath = null; state.results = []; state.activeResult = -1; $("search").value = "";
  const isEntity = mode === "entity";
  if ($("tab-event")) $("tab-event").setAttribute("aria-pressed", String(!isEntity));
  if ($("tab-entity")) $("tab-entity").setAttribute("aria-pressed", String(isEntity));
  if ($("common-toggle")) $("common-toggle").hidden = isEntity;
  $("search").placeholder = isEntity ? "Search graph fields, or /regex/…" : "Search fields, paths, kinds (hash, ip…), or /regex/…";
  clearBanner(); setView("tree"); renderTree(); renderWelcome(); renderFooter();
}

function renderWelcome() {
  const isEntity = state.mode === "entity";
  $("details").innerHTML = '<div class="welcome"><p class="welcome-lead">Select a field from the tree, or press <kbd>Ctrl</kbd> <kbd>K</kbd> to search.</p><p class="welcome-sub">Click any field to see its type, description, and ready-to-copy parser path (<code>' + escHtml(PARSER_PREFIXES[isEntity ? "entity" : "event"]) + '…</code>).</p><ul class="welcome-tips"><li><kbd>↑</kbd> <kbd>↓</kbd> move through search results, <kbd>Enter</kbd> opens one</li><li><kbd>Esc</kbd> clears the search</li><li>Search a <strong>kind</strong> like <code class="badge-demo">hash</code> or <code class="badge-demo">ip</code> to find every matching field</li><li>Search an <strong>example value</strong> like <code class="badge-demo">docx</code> or <code class="badge-demo">203.0.113</code> — toggle <strong>Field</strong>/<strong>Value</strong> above results</li><li>Wrap a query in slashes for <strong>regex</strong>, e.g. <code class="badge-demo">/\\.sha(1|256)$/</code></li><li><code class="badge-demo">string[]</code> means the field is repeated</li>' + (isEntity ? '<li>The Graph tree holds contextual records (users, assets, files) that enrich events — "graph" is a real structure: official rules write it literally as <code class="badge-demo">$var.graph.entity…</code></li>' : '') + '</ul></div>';
}

/* -------------------- tree rendering -------------------- */

function renderTree() { const tree = $("tree"); tree.innerHTML = ""; tree.appendChild(buildList("")); }
function buildList(parentPath) {
  const ul = document.createElement("ul"); ul.className = "tree-list";
  (cur().children[parentPath] || []).forEach(f => {
    const li = document.createElement("li");
    const row = document.createElement("button");
    row.type = "button"; row.className = "tree-row" + (f.hasChildren ? " group" : ""); row.dataset.path = f.path;
    const tag = treeTag(f);
    row.innerHTML = '<span class="caret">' + (f.hasChildren ? "▶" : "") + '</span><span class="tree-name">' + escHtml(f.name) + '</span>' + (tag ? '<span class="type-tag ' + typeClass(f.type) + '">' + escHtml(tag) + '</span>' : "");
    li.appendChild(row);
    if (f.hasChildren) {
      const childUl = buildList(f.path); childUl.hidden = true; li.appendChild(childUl);
      row.setAttribute("aria-expanded", "false");
    }
    ul.appendChild(li);
  });
  return ul;
}

/* -------------------- selection & details -------------------- */

function setExpanded(row, expanded) {
  const ul = row.parentElement.querySelector("ul.tree-list");
  if (ul) { ul.hidden = !expanded; row.setAttribute("aria-expanded", String(expanded)); }
}

function selectField(path, opts) {
  opts = opts || {};
  const ds = cur(); const field = ds.byPath[path];
  if (!field) return;
  state.selectedPath = path; renderDetails(field);
  if (opts.reveal) {
    const row = document.querySelector('.tree-row[data-path="' + path + '"]');
    if (row) { row.scrollIntoView({ behavior: "smooth", block: "nearest" }); row.focus(); }
    while (row && row.parentElement) {
      if (row.parentElement.tagName === "LI") { const btn = row.parentElement.querySelector(".tree-row.group"); if (btn && btn.getAttribute("aria-expanded") === "false") setExpanded(btn, true); }
      row = row.parentElement.querySelector(".tree-row");
    }
  }
}

function renderDetails(field) {
  const parserPath = toParserPath(field.path, state.mode);
  const kindBadge = field.kind ? '<span class="kind-badge">' + escHtml(field.kind) + '</span>' : '';
  const categoryBadge = field.category ? '<span class="category-badge">' + escHtml(field.category) + '</span>' : '';
  const rep = field.repeated ? '<span class="pill repeated">repeated</span>' : '';
  const examplesHtml = field.examples.map((e, i) => '<div class="example"><span class="example-label">Example ' + (i+1) + '</span><code>' + escHtml(e) + '</code><button class="copy-btn" data-copy="' + escHtml(e) + '">Copy</button></div>').join("");
  const aliasesHtml = field.aliases.length ? field.aliases.map(a => '<span class="alias">' + escHtml(a) + '</span>').join(" ") : "—";
  const children = cur().children[field.path] || [];
  const childrenHtml = children.length ? children.map(c => '<button class="child-link" data-goto="' + escHtml(c.path) + '">' + escHtml(c.name) + ' <span class="type-tag ' + typeClass(c.type) + '">' + escHtml(treeTag(c)) + '</span></button>').join(" ") : "—";

  $("details").innerHTML = '<div class="detail">' +
    '<h1>' + escHtml(field.name) + ' <span class="subid">' + escHtml(field.path) + '</span></h1>' +
    '<div class="badges"><span class="type-tag ' + typeClass(field.type) + '">' + typeLabel(field) + '</span>' + rep + kindBadge + categoryBadge + '</div>' +
    '<div class="section"><h2>Parser path</h2><div class="code-wrap"><button class="copy-btn" data-copy="' + escHtml(parserPath) + '">Copy</button><code>' + escHtml(parserPath) + '</code></div></div>' +
    '<div class="section"><h2>Description</h2><p>' + escHtml(field.description || "—") + '</p></div>' +
    (field.examples.length ? '<div class="section"><h2>Examples</h2>' + examplesHtml + '</div>' : '') +
    (field.aliases.length ? '<div class="section"><h2>Aliases</h2><p>' + aliasesHtml + '</p></div>' : '') +
    '<div class="section"><h2>Child fields</h2><div class="children">' + childrenHtml + '</div></div>' +
    '<div class="section"><h2>Full definition (JSON)</h2><pre class="json">' + escHtml(JSON.stringify({ _type: field.type, _repeated: field.repeated, _description: field.description, _examples: field.examples, _aliases: field.aliases, _category: field.category, _kind: field.kind }, null, 2)) + '</pre></div>' +
  '</div>';
}

/* -------------------- search -------------------- */

function runSearch(q) {
  const scope = state.searchScope;
  const res = searchFields(cur().fields, q, 100, scope);
  state.results = res.results; state.activeResult = -1;
  renderResults(res, q);
  if (res.error) showBanner("⚠ Regex error: " + escHtml(res.error)); else clearBanner();
  if (state.view !== "search") setView("search");
}

function renderResults(res, q) {
  const ul = $("results"); ul.innerHTML = "";
  if (res.results.length === 0) { ul.innerHTML = '<li class="no-results">No matches for "' + escHtml(q) + '"</li>'; return; }
  res.results.forEach((f, i) => {
    const li = document.createElement("li"); li.className = "result-row"; li.dataset.path = f.path;
    const tag = treeTag(f); const kindBadge = f.kind ? '<span class="kind-badge">' + escHtml(f.kind) + '</span>' : '';
    const matched = res.matchedExamples && res.matchedExamples[i] ? '<span class="matched-hint">matched example: <code>' + escHtml(res.matchedExamples[i]) + '</code></span>' : '';
    li.innerHTML = '<span class="tree-name">' + escHtml(f.name) + '</span>' + (tag ? '<span class="type-tag ' + typeClass(f.type) + '">' + escHtml(tag) + '</span>' : '') + kindBadge + matched;
    ul.appendChild(li);
  });
}

function moveActive(dir) {
  const rows = document.querySelectorAll("#results .result-row");
  if (!rows.length) return;
  state.activeResult = (state.activeResult + dir + rows.length) % rows.length;
  rows.forEach((r, i) => r.classList.toggle("active", i === state.activeResult));
  if (rows[state.activeResult]) rows[state.activeResult].scrollIntoView({ block: "nearest" });
}

/* -------------------- common view -------------------- */

function renderCommon() {
  const ul = $("common"); ul.innerHTML = "";
  cur().common.forEach(path => {
    const f = cur().byPath[path]; if (!f) return;
    const li = document.createElement("li"); li.className = "result-row"; li.dataset.path = f.path;
    const tag = treeTag(f);
    li.innerHTML = '<span class="tree-name">' + escHtml(f.name) + '</span>' + (tag ? '<span class="type-tag ' + typeClass(f.type) + '">' + escHtml(tag) + '</span>' : '');
    ul.appendChild(li);
  });
}

/* -------------------- footer -------------------- */

function renderFooter() {
  const ev = state.data.event, en = state.data.entity;
  const parts = [];
  if (ev.loaded) parts.push("Events: " + ev.fields.length + " fields (" + ev.meta.udm + ")");
  if (en.loaded) parts.push("Entities: " + en.fields.length + " fields (" + en.meta.udm + ")");
  $("footer-count").textContent = parts.join(" | ");
}

/* -------------------- theme & resizer -------------------- */

function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", saved || (prefersDark ? "dark" : "light"));
}
function applyTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  localStorage.setItem("theme", dark ? "dark" : "light");
}

function initResizer() {
  const divider = document.querySelector(".divider"); if (!divider) return;
  const left = document.querySelector(".left-panel"), right = document.querySelector(".details-panel");
  let dragging = false, startX = 0, startLeft = 0;
  divider.addEventListener("mousedown", e => { dragging = true; startX = e.clientX; startLeft = left.offsetWidth; document.body.style.cursor = "col-resize"; e.preventDefault(); });
  document.addEventListener("mousemove", e => { if (!dragging) return; const delta = e.clientX - startX; const newWidth = Math.max(280, Math.min(window.innerWidth - 320, startLeft + delta)); left.style.width = newWidth + "px"; });
  document.addEventListener("mouseup", () => { if (dragging) { dragging = false; document.body.style.cursor = ""; } });
  divider.addEventListener("keydown", e => { if (e.key === "ArrowLeft") left.style.width = Math.max(280, left.offsetWidth - 20) + "px"; else if (e.key === "ArrowRight") left.style.width = Math.min(window.innerWidth - 320, left.offsetWidth + 20) + "px"; });
}

/* -------------------- events -------------------- */

function bindChrome() {
  if ($("theme-toggle")) $("theme-toggle").addEventListener("click", () => applyTheme(document.documentElement.getAttribute("data-theme") !== "dark"));
  if ($("tab-event")) $("tab-event").addEventListener("click", () => setMode("event"));
  if ($("tab-entity")) $("tab-entity").addEventListener("click", () => setMode("entity"));
  if ($("expand-all")) $("expand-all").addEventListener("click", () => expandAll(true));
  if ($("collapse-all")) $("collapse-all").addEventListener("click", () => expandAll(false));
  if ($("common-toggle")) $("common-toggle").addEventListener("click", () => { if (state.view === "common") setView($("search").value.trim() ? "search" : "tree"); else setView("common"); });

  const search = $("search");
  search.addEventListener("input", () => runSearch(search.value));
  search.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Enter") { const i = state.activeResult >= 0 ? state.activeResult : 0; if (state.results[i]) selectField(state.results[i].path, { reveal: true }); }
    else if (e.key === "Escape") { search.value = ""; runSearch(""); }
  });

  ["field", "value"].forEach(scope => {
    const btn = $("scope-" + scope);
    if (!btn) return;
    btn.addEventListener("click", () => { state.searchScope[scope] = !state.searchScope[scope]; btn.setAttribute("aria-pressed", String(state.searchScope[scope])); if (search.value.trim()) runSearch(search.value); });
  });

  document.addEventListener("keydown", e => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.focus(); search.select(); }
    else if (e.key === "/" && !typing) { e.preventDefault(); search.focus(); }
  });

  document.querySelector(".left-panel").addEventListener("click", e => {
    const mini = e.target.closest("[data-minicopy]");
    if (mini) { e.stopPropagation(); copyText(mini.getAttribute("data-minicopy"), mini); return; }
    const treeRow = e.target.closest(".tree-row");
    if (treeRow) { if (treeRow.hasAttribute("aria-expanded")) setExpanded(treeRow, treeRow.getAttribute("aria-expanded") !== "true"); selectField(treeRow.dataset.path, { scroll: !treeRow.hasAttribute("aria-expanded") }); return; }
    const resultRow = e.target.closest(".result-row");
    if (resultRow) selectField(resultRow.dataset.path, { reveal: true, scroll: true });
  });

  $("details").addEventListener("click", e => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) { copyText(copyBtn.getAttribute("data-copy"), copyBtn); return; }
    const goto = e.target.closest("[data-goto]");
    if (goto) selectField(goto.getAttribute("data-goto"), { reveal: true });
  });
}

function expandAll(expand) {
  document.querySelectorAll(".tree-row.group").forEach(row => setExpanded(row, expand));
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(() => btn.textContent = orig, 1400);
  }).catch(() => alert("Copy failed"));
}

/* -------------------- router -------------------- */

function navigate(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

function wireRouteLinks() {
  document.querySelectorAll("[data-route]").forEach(el => {
    if (el._wired) return; el._wired = true;
    el.addEventListener("click", e => { e.preventDefault(); navigate(el.dataset.route); });
  });
}

function render() {
  if (!state.data.event.loaded) return;
  const hash = location.hash || "#/"; const parts = hash.replace(/^#\//, "").split("/");

  wireRouteLinks();

  if (hash === "#/" || parts[0] === "") {
    $("app").innerHTML = "";
  } else if (parts[0] === "admin") {
    if (!Auth.current()) { navigate("#/admin"); return; }
    $("app").innerHTML = renderAdmin(); wireAdminDashboard();
  } else {
    $("app").innerHTML = '<p class="loading">Page not found. <span class="back" data-route="#/">Home</span></p>';
  }
  window.scrollTo(0, 0);
}

/* -------------------- bootstrap (attack-detect pattern) -------------------- */

(async function boot() {
  try {
    await loadData();
    render();
  } catch (e) {
    console.error(e);
    showBanner("⚠ Init failed: " + escHtml(e.message));
  }
})();

/* Allow pure logic to be unit-tested in Node */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildIndex, searchFields, toParserPath, treeTag, typeLabel, VALID_TYPES, PARSER_PREFIXES };
}