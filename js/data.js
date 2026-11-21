/* data.js — constants and shared state */
const PARSER_PREFIXES = { event: "event.idm.read_only_udm.", entity: "event.idm." };
const VALID_TYPES = ["string", "int32", "int64", "uint32", "uint64", "float", "double", "bool", "boolean", "bytes", "timestamp", "enum", "object"];
const TYPE_LABELS = { string: "STRING", int32: "INT32", int64: "INT64", uint32: "UINT32", uint64: "UINT64", float: "FLOAT", double: "DOUBLE", bool: "BOOL", boolean: "BOOL", bytes: "BYTES", timestamp: "TIME", enum: "ENUM", object: "OBJECT" };
const TYPE_CLASSES = { string: "t-string", int32: "t-number", int64: "t-number", uint32: "t-number", uint64: "t-number", float: "t-number", double: "t-number", bool: "t-bool", boolean: "t-bool", bytes: "t-bytes", timestamp: "t-time", enum: "t-enum", object: "t-object" };

function emptyDataset() { return { meta: {}, fields: [], byPath: {}, children: {}, common: [], loaded: false, error: null }; }
var state = { mode: "event", data: { event: emptyDataset(), entity: emptyDataset() }, view: "tree", selectedPath: null, results: [], activeResult: -1, searchScope: { field: true, value: true } };
function cur() { return state.data[state.mode]; }
function $(id) { return document.getElementById(id); }
function escHtml(s) { return String(s).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, """).replace(/'/g, "'"); }
function typeClass(type) { return TYPE_CLASSES[type] || "t-object"; }
function typeLabel(field) { return TYPE_LABELS[field.type] || field.type.toUpperCase(); }
function treeTag(field) { if (field.type === "object" && !field.repeated) return ""; return field.type + (field.repeated ? "[]" : ""); }