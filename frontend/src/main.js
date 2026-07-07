import "./tool-utils.js";

const utils = globalThis.WrenchUtils;
const $ = (id) => document.getElementById(id);

const categoryOrder = ["数据处理", "编码转换", "证书工具"];
const homeCategoryOrder = ["数据处理", "证书工具", "编码转换"];
const toolCatalog = [
  {
    id: "json",
    name: "JSON 解析器",
    category: "数据处理",
    desc: "提取、格式化、压缩和表格查看 JSON 数据",
    tags: ["json", "format", "minify", "格式化", "压缩", "校验", "解析", "表格"],
    placeholder: "2026-07-06 INFO {\"ok\":true,\"items\":[1,2]} trailing",
    actions: [
      { id: "format", label: "格式化", primary: true },
      { id: "minify", label: "压缩" },
      { id: "table", label: "表格视图" }
    ],
    async run(action, input) {
      if (action === "minify") return { output: utils.minifyJSONText(input) };
      if (action === "table") {
        const value = JSON.parse(utils.extractJSONText(input));
        return {
          output: jsonToRows(value).map((row) => `${row.path}\t${row.value}`).join("\n"),
          details: [["视图", "路径和值"], ["行数", String(jsonToRows(value).length)]]
        };
      }
      return { output: utils.formatJSONText(input, 2) };
    }
  },
  {
    id: "base64",
    name: "Base64 编解码",
    category: "编码转换",
    desc: "UTF-8 文本 Base64 编码和解码",
    tags: ["base64", "b64", "编码", "解码"],
    placeholder: "中文 test",
    actions: [
      { id: "encode", label: "编码", primary: true },
      { id: "decode", label: "解码" }
    ],
    async run(action, input) {
      if (action === "decode") return { output: utils.base64ToUtf8(input) };
      return { output: utils.utf8ToBase64(input) };
    }
  },
  {
    id: "url",
    name: "URL 编解码",
    category: "编码转换",
    desc: "URL 参数和文本片段 percent-encoding 编解码",
    tags: ["url", "uri", "encode", "decode", "编码", "解码"],
    placeholder: "name=张三&x=1 2",
    actions: [
      { id: "encode", label: "编码", primary: true },
      { id: "decode", label: "解码" }
    ],
    async run(action, input) {
      if (action === "decode") return { output: utils.decodeURLText(input) };
      return { output: utils.encodeURLText(input) };
    }
  },
  {
    id: "pg-array",
    name: "PG Array 转换",
    category: "数据处理",
    desc: "把一串 ID 转成 PostgreSQL IN 查询数组",
    tags: ["postgres", "pg", "sql", "array", "in", "id", "数组"],
    placeholder: "1001\n1002,1003",
    actions: [{ id: "convert", label: "转换", primary: true }],
    options: [
      { id: "pgMode", label: "输出模式", type: "select", value: "auto", choices: [["auto", "自动"], ["number", "数字"], ["string", "字符串"]] },
      { id: "pgUnique", label: "去重", type: "checkbox", checked: true }
    ],
    async run(action, input) {
      return {
        output: utils.toPGArray(input, {
          mode: optionValue("pgMode"),
          unique: $("pgUnique").checked
        })
      };
    }
  },
  {
    id: "csr",
    name: "CSR 格式化",
    category: "证书工具",
    desc: "输入 JSON 或原始 CSR，输出规范化 PEM",
    tags: ["csr", "pem", "证书请求", "格式化"],
    placeholder: "-----BEGIN CERTIFICATE REQUEST-----\\n...\\n-----END CERTIFICATE REQUEST-----",
    actions: [{ id: "parse", label: "格式化/解析", primary: true }],
    async run(action, input) {
      const csr = utils.parseCSRPEM(input);
      return {
        output: csr.pem,
        details: [
          ["Subject", csr.subject],
          ["CN", csr.commonName],
          ["DNS", csr.dnsNames.join(", ")],
          ["Email", csr.emailAddresses.join(", ")],
          ["IP", csr.ipAddresses.join(", ")],
          ["URI", csr.uris.join(", ")],
          ["公钥", formatKey(csr)],
          ["签名算法", csr.signatureAlgorithm]
        ]
      };
    }
  },
  {
    id: "cert",
    name: "证书格式化",
    category: "证书工具",
    desc: "拆分证书链并查看证书信息",
    tags: ["cert", "certificate", "pem", "证书链", "x509"],
    placeholder: "-----BEGIN CERTIFICATE-----\\n...\\n-----END CERTIFICATE-----",
    actions: [{ id: "parse", label: "格式化/解析", primary: true }],
    async run(action, input) {
      const certs = await Promise.all(utils.splitCertificatePEMs(input).map((pem) => utils.parseCertificatePEM(pem)));
      return {
        output: certs.map((cert) => cert.pem).join("\n"),
        details: certs.flatMap((cert, index) => [
          [`证书 #${index + 1}`, cert.subject],
          ["Issuer", cert.issuer],
          ["有效期", `${formatDate(cert.notBefore)} 至 ${formatDate(cert.notAfter)}`],
          ["序列号", cert.serialNumber],
          ["SHA1", cert.sha1],
          ["CA", cert.isCA ? "是" : "否"],
          ["公钥", formatKey(cert)],
          ["签名算法", cert.signatureAlgorithm]
        ])
      };
    }
  }
];

let activeTool = toolCatalog[0];
let activeAction = activeTool.actions[0].id;
let jsonTableRows = [];
const collapsedSidebarCategories = new Set();
let historyItems = [];
let historyScope = "current";
let historyHasMore = false;
let historyLoading = false;
const HISTORY_PAGE_SIZE = 30;

const localHistory = {
  async Create(req) {
    const entry = {
      id: String(Date.now()),
      createdAt: new Date().toISOString(),
      title: req.title || summarizeText(req.input) || req.tool,
      ...req
    };
    const items = JSON.parse(localStorage.getItem("wrench-desktop-history") || "[]");
    items.push(entry);
    localStorage.setItem("wrench-desktop-history", JSON.stringify(items));
    return entry;
  },
  async List(tool, limit) {
    return this.Search(tool, "", limit || 100, 0);
  },
  async Search(tool, query, limit, offset) {
    const search = String(query || "").trim().toLowerCase();
    const items = JSON.parse(localStorage.getItem("wrench-desktop-history") || "[]");
    return items
      .filter((item) => !tool || item.tool === tool)
      .filter((item) => !search || `${item.title || ""} ${item.input || ""} ${item.output || ""}`.toLowerCase().includes(search))
      .slice()
      .reverse()
      .slice(offset || 0, (offset || 0) + (limit || 100));
  },
  async Delete(id) {
    const items = JSON.parse(localStorage.getItem("wrench-desktop-history") || "[]");
    localStorage.setItem("wrench-desktop-history", JSON.stringify(items.filter((item) => item.id !== id)));
  },
  async Clear(tool) {
    if (!tool) {
      localStorage.removeItem("wrench-desktop-history");
      return;
    }
    const items = JSON.parse(localStorage.getItem("wrench-desktop-history") || "[]");
    localStorage.setItem("wrench-desktop-history", JSON.stringify(items.filter((item) => item.tool !== tool)));
  },
  async DataPath() {
    return "浏览器预览模式：localStorage";
  }
};

async function loadHistoryService() {
  try {
    const bindings = await import("../bindings/wrench-desktop/index.js");
    return bindings.HistoryService || localHistory;
  } catch {
    return localHistory;
  }
}

const historyService = await loadHistoryService();
const panelState = {
  leftWidth: readNumberSetting("wrench-left-panel-width", 300),
  rightWidth: readNumberSetting("wrench-right-panel-width", 340),
  leftCollapsed: localStorage.getItem("wrench-left-panel-collapsed") === "true",
  rightCollapsed: localStorage.getItem("wrench-right-panel-collapsed") === "true"
};

function matchesTool(tool, query) {
  if (!query) return true;
  return [tool.name, tool.category, tool.desc, ...(tool.tags || [])].join(" ").toLowerCase().includes(query.toLowerCase());
}

function toolsForCategory(category) {
  if (category === "全部") return toolCatalog;
  return toolCatalog.filter((tool) => tool.category === category);
}

function renderSidebarTools() {
  const query = $("toolSearch").value.trim();
  const nav = $("sidebarTools");
  nav.innerHTML = "";

  const home = document.createElement("button");
  home.className = "app-sidebar-home";
  home.type = "button";
  home.classList.toggle("active", $("toolView").hidden);
  home.innerHTML = `<span>首页</span><small>全部工具概览</small>`;
  home.addEventListener("click", showHome);
  nav.appendChild(home);

  categoryOrder.forEach((category) => {
    const tools = toolsForCategory(category).filter((tool) => matchesTool(tool, query));
    if (query && tools.length === 0) return;

    const group = document.createElement("section");
    group.className = "app-sidebar-group";
    const collapsed = collapsedSidebarCategories.has(category);
    group.classList.toggle("collapsed", collapsed);

    const header = document.createElement("button");
    header.className = "app-sidebar-category";
    header.type = "button";
    header.innerHTML = `<span>${escapeHtml(category)}</span><span class="app-sidebar-count">${tools.length}</span>`;
    header.addEventListener("click", () => {
      if (collapsedSidebarCategories.has(category)) {
        collapsedSidebarCategories.delete(category);
      } else {
        collapsedSidebarCategories.add(category);
      }
      renderSidebarTools();
    });

    const list = document.createElement("div");
    list.className = "app-sidebar-list";
    tools.forEach((tool) => {
      const button = document.createElement("button");
      button.className = "app-sidebar-tool";
      button.type = "button";
      button.classList.toggle("active", tool.id === activeTool.id && !$("toolView").hidden);
      button.innerHTML = `<span>${tool.name}</span><small>${tool.desc}</small>`;
      button.addEventListener("click", () => selectTool(tool.id));
      list.appendChild(button);
    });

    group.append(header, list);
    nav.appendChild(group);
  });
}

function renderHomeTools() {
  const query = $("homeToolSearch").value.trim();
  const filtered = toolCatalog.filter((tool) => matchesTool(tool, query));
  $("toolListTitle").textContent = "全部工具";
  $("toolResultCount").textContent = `${filtered.length} 个`;

  const groups = $("toolGroups");
  const empty = $("emptyTools");
  groups.innerHTML = "";
  empty.hidden = filtered.length > 0;

  homeCategoryOrder.filter((category) => filtered.some((tool) => tool.category === category)).forEach((category) => {
    const section = document.createElement("section");
    section.className = "tool-group";
    const heading = document.createElement("h3");
    heading.textContent = category;
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = "tool-list";
    filtered.filter((tool) => tool.category === category).forEach((tool) => list.appendChild(renderToolRow(tool)));
    section.appendChild(list);
    groups.appendChild(section);
  });
}

function renderToolRow(tool) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool-row";
  button.innerHTML = `
    <span class="tool-row-main">
      <span class="tool-row-name">${escapeHtml(tool.name)}</span>
      <span class="tool-row-desc">${escapeHtml(tool.desc)}</span>
    </span>
    <span class="tool-row-meta">${escapeHtml(tool.category)}</span>
    <span class="tool-row-arrow">打开</span>
  `;
  button.addEventListener("click", () => selectTool(tool.id));
  return button;
}

function showHome() {
  $("homeView").hidden = false;
  $("toolView").hidden = true;
  renderSidebarTools();
  renderHomeTools();
  refreshHistory();
}

function selectTool(id) {
  activeTool = toolCatalog.find((tool) => tool.id === id) || toolCatalog[0];
  activeAction = activeTool.actions.find((action) => action.primary)?.id || activeTool.actions[0].id;
  const isJSONTool = activeTool.id === "json";

  $("homeView").hidden = true;
  $("toolView").hidden = false;
  $("toolCategory").textContent = activeTool.category;
  $("toolName").textContent = activeTool.name;
  $("toolDesc").textContent = activeTool.desc;
  $("genericWorkspace").hidden = isJSONTool;
  $("jsonWorkspace").hidden = !isJSONTool;
  if (isJSONTool) {
    resetJSONWorkspace();
    renderSidebarTools();
    refreshHistory();
    return;
  }

  $("inputText").placeholder = activeTool.placeholder;
  $("inputText").value = "";
  $("outputText").value = "";
  setStatus("", false);
  renderDetails();
  renderActions();
  renderOptions();
  renderSidebarTools();
  refreshHistory();
}

function renderActions() {
  const primary = activeTool.actions.find((action) => action.primary) || activeTool.actions[0];
  const secondary = activeTool.actions.find((action) => !action.primary);
  $("primaryAction").textContent = primary.label;
  $("primaryAction").dataset.action = primary.id;
  $("secondaryAction").hidden = !secondary;
  if (secondary) {
    $("secondaryAction").textContent = secondary.label;
    $("secondaryAction").dataset.action = secondary.id;
  }

  const extraActions = activeTool.actions.filter((action) => !action.primary).slice(1);
  document.querySelectorAll(".dynamic-action").forEach((button) => button.remove());
  let insertBefore = $("clearInput");
  extraActions.forEach((action) => {
    const button = document.createElement("button");
    button.className = "btn secondary dynamic-action";
    button.type = "button";
    button.textContent = action.label;
    button.dataset.action = action.id;
    button.addEventListener("click", () => runTool(action.id));
    insertBefore.parentElement.insertBefore(button, insertBefore);
  });
}

function renderOptions() {
  const container = $("toolOptions");
  container.innerHTML = "";
  if (!activeTool.options || activeTool.options.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  activeTool.options.forEach((option) => {
    const label = document.createElement("label");
    label.className = "option-field";
    if (option.type === "select") {
      label.innerHTML = `<span>${option.label}</span><select id="${option.id}">${option.choices.map(([value, text]) => `<option value="${value}"${value === option.value ? " selected" : ""}>${text}</option>`).join("")}</select>`;
    } else if (option.type === "checkbox") {
      label.innerHTML = `<input id="${option.id}" type="checkbox"${option.checked ? " checked" : ""}><span>${option.label}</span>`;
    }
    container.appendChild(label);
  });
}

async function runTool(action) {
  const input = $("inputText").value;
  if (!input.trim()) {
    setStatus("请输入内容", true);
    return;
  }
  try {
    setStatus("处理中...", false);
    const result = await activeTool.run(action || activeAction, input);
    $("outputText").value = result.output;
    renderDetails(result.details);
    await saveHistoryEntry(activeTool, input, result.output, action || activeAction);
    setStatus("已完成并保存历史", false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function renderDetails(details = []) {
  const panel = $("resultDetails");
  panel.innerHTML = "";
  panel.hidden = details.length === 0;
  details.filter(([, value]) => value !== undefined && value !== null && String(value) !== "").forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "detail-row";
    row.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
    panel.appendChild(row);
  });
}

function resetJSONWorkspace() {
  $("jsonInput").value = "";
  $("jsonOutput").value = "";
  $("jsonOutputEditor").hidden = true;
  $("jsonOutput").classList.remove("json-output-source-hidden");
  setJSONStatus("", false);
  setJSONOutputReady(false);
  clearJSONTableView();
}

async function formatJSON() {
  const input = $("jsonInput").value.trim();
  if (!input) {
    setJSONStatus("输入为空", true);
    return;
  }
  try {
    const formatted = utils.formatJSONText(input, 2);
    setJSONOutput(formatted, true);
    await saveHistoryEntry(activeTool, input, formatted, "format");
    setJSONStatus("格式化完成并保存历史", false);
  } catch (error) {
    setJSONOutput("", false);
    clearJSONTableView();
    setJSONStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function minifyJSON() {
  const input = $("jsonInput").value.trim();
  if (!input) {
    setJSONStatus("输入为空", true);
    return;
  }
  try {
    const minified = utils.minifyJSONText(input);
    setJSONOutput(minified, false);
    await saveHistoryEntry(activeTool, input, minified, "minify");
    setJSONStatus("压缩完成并保存历史", false);
  } catch (error) {
    setJSONOutput("", false);
    clearJSONTableView();
    setJSONStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function setJSONOutput(text, showEditor) {
  $("jsonOutput").value = text;
  setJSONOutputReady(Boolean(text));
  clearJSONTableView();
  if (showEditor && text) {
    renderJSONEditor(text);
    $("jsonOutput").classList.add("json-output-source-hidden");
    $("jsonOutputEditor").hidden = false;
    return;
  }
  $("jsonOutput").classList.remove("json-output-source-hidden");
  $("jsonOutputEditor").hidden = true;
}

function setJSONOutputReady(ready) {
  ["jsonCopy", "jsonSave", "jsonTableButton"].forEach((id) => {
    $(id).disabled = !ready;
  });
}

function renderJSONEditor(text) {
  const editor = $("jsonOutputEditor");
  const lines = text.split("\n");
  editor.innerHTML = lines.map((line, index) => `
    <div class="json-line">
      <span class="json-line-number">${index + 1}</span>
      <code class="json-line-code">${highlightJSONLine(line) || "&nbsp;"}</code>
    </div>
  `).join("");
}

function highlightJSONLine(line) {
  return escapeHtml(line).replace(/(&quot;(?:\\.|[^&])*?&quot;)(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g, (match, stringToken, colon) => {
    if (stringToken) {
      return `<span class="${colon ? "json-key" : "json-string"}">${stringToken}</span>${colon || ""}`;
    }
    if (match === "true" || match === "false") return `<span class="json-boolean">${match}</span>`;
    if (match === "null") return `<span class="json-null">${match}</span>`;
    return `<span class="json-number">${match}</span>`;
  });
}

function showJSONTableView() {
  const text = $("jsonOutput").value.trim();
  if (!text) {
    setJSONStatus("没有可转换的 JSON 输出", true);
    clearJSONTableView();
    return;
  }
  try {
    const value = JSON.parse(text);
    jsonTableRows = normalizeJSONTableRows(value);
    const fields = collectJSONTableFields(jsonTableRows);
    if (!fields.length) throw new Error("没有可展示的字段");
    renderJSONFieldList(fields);
    renderJSONTable(fields);
    $("jsonTableCard").hidden = false;
    setJSONStatus("表格视图已生成", false);
  } catch (error) {
    clearJSONTableView();
    setJSONStatus(`表格视图生成失败：${error instanceof Error ? error.message : String(error)}`, true);
  }
}

function normalizeJSONTableRows(value) {
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.length) throw new Error("JSON 数组为空");
  return rows.map((row, index) => {
    if (row && typeof row === "object" && !Array.isArray(row)) return row;
    return { index, value: row };
  });
}

function collectJSONTableFields(rows) {
  const fields = [];
  const seen = new Set();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      fields.push(key);
    });
  });
  return fields;
}

function renderJSONFieldList(fields) {
  const fieldList = $("jsonFieldList");
  fieldList.replaceChildren();
  fields.forEach((field) => {
    const label = document.createElement("label");
    label.className = "json-field-item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = field;
    input.checked = true;
    input.addEventListener("change", () => renderJSONTable());

    const text = document.createElement("span");
    text.textContent = field;

    label.append(input, text);
    fieldList.appendChild(label);
  });
}

function renderJSONTable(fields) {
  const selectedFields = fields?.length ? fields : Array.from(document.querySelectorAll("#jsonFieldList input:checked")).map((input) => input.value);
  $("jsonTableSummary").textContent = `${jsonTableRows.length} 行 / ${selectedFields.length} 列`;

  if (!selectedFields.length) {
    $("jsonTableContainer").innerHTML = `<div class="empty-state">请至少选择一个字段</div>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "json-data-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  selectedFields.forEach((field) => {
    const th = document.createElement("th");
    th.textContent = field;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  jsonTableRows.forEach((row) => {
    const tr = document.createElement("tr");
    selectedFields.forEach((field) => {
      const td = document.createElement("td");
      const content = document.createElement("div");
      content.className = "json-cell-content";
      content.textContent = formatJSONTableCell(row[field]);
      td.appendChild(content);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  $("jsonTableContainer").replaceChildren(table);
}

function clearJSONTableView() {
  jsonTableRows = [];
  $("jsonTableCard").hidden = true;
  $("jsonFieldList").replaceChildren();
  $("jsonTableContainer").replaceChildren();
  $("jsonTableSummary").textContent = "";
}

function formatJSONTableCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function setJSONStatus(text, isError) {
  $("jsonStatus").textContent = text;
  $("jsonStatus").classList.toggle("error", Boolean(isError));
}

function toggleJSONOutputEditor(showEditor) {
  const text = $("jsonOutput").value.trim();
  if (!text) return;
  if (showEditor) {
    try {
      const formatted = JSON.stringify(JSON.parse(text), null, 2);
      $("jsonOutput").value = formatted;
      renderJSONEditor(formatted);
      $("jsonOutput").classList.add("json-output-source-hidden");
      $("jsonOutputEditor").hidden = false;
    } catch (error) {
      setJSONStatus(error instanceof Error ? error.message : String(error), true);
    }
    return;
  }
  try {
    const minified = JSON.stringify(JSON.parse(text));
    $("jsonOutput").value = minified;
    $("jsonOutput").classList.remove("json-output-source-hidden");
    $("jsonOutputEditor").hidden = true;
  } catch (error) {
    setJSONStatus(error instanceof Error ? error.message : String(error), true);
  }
}

function saveJSONOutput() {
  const text = $("jsonOutput").value;
  if (!text) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  link.download = "wrench-output.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function openFullscreen(title, text) {
  let overlay = $("fullscreenOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "fullscreenOverlay";
    overlay.className = "fullscreen-overlay";
    overlay.innerHTML = `
      <div class="fullscreen-header">
        <div class="fullscreen-title"></div>
        <button class="btn secondary" id="fullscreenClose" type="button">关闭</button>
      </div>
      <textarea class="fullscreen-textarea" spellcheck="false"></textarea>
    `;
    document.body.appendChild(overlay);
    $("fullscreenClose").addEventListener("click", () => overlay.classList.remove("active"));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") overlay.classList.remove("active");
    });
  }
  overlay.querySelector(".fullscreen-title").textContent = title;
  overlay.querySelector(".fullscreen-textarea").value = text;
  overlay.classList.add("active");
}

function jsonToRows(value, prefix = "$") {
  if (value === null || typeof value !== "object") return [{ path: prefix, value: JSON.stringify(value) }];
  const rows = [];
  const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
  entries.forEach(([key, child]) => {
    const path = Array.isArray(value) ? `${prefix}[${key}]` : `${prefix}.${key}`;
    rows.push(...jsonToRows(child, path));
  });
  return rows;
}

function optionValue(id) {
  const el = $(id);
  return el ? el.value : "";
}

function setStatus(text, isError) {
  $("statusText").textContent = text;
  $("statusText").classList.toggle("error", Boolean(isError));
}

function formatKey(value) {
  return `${value.publicKeyAlgorithm || "N/A"}${value.publicKeySize ? ` ${value.publicKeySize} bits` : ""}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function saveHistoryEntry(tool, input, output, action) {
  if (!input && !output) return;
  const actionLabel = tool.actions?.find((item) => item.id === action)?.label;
  await historyService.Create({
    tool: tool.id,
    title: actionLabel ? `${tool.name} · ${actionLabel}` : tool.name,
    input,
    output
  });
  await refreshHistory();
}

function activeHistoryTool() {
  return historyScope === "current" && !$("toolView").hidden ? activeTool.id : "";
}

async function refreshHistory({ append = false } = {}) {
  if (historyLoading) return;
  historyLoading = true;
  const tool = activeHistoryTool();
  const query = $("historySearch").value.trim();
  const offset = append ? historyItems.length : 0;
  try {
    const results = await historyService.Search(tool, query, HISTORY_PAGE_SIZE + 1, offset) || [];
    historyHasMore = results.length > HISTORY_PAGE_SIZE;
    const page = results.slice(0, HISTORY_PAGE_SIZE);
    historyItems = append ? historyItems.concat(page) : page;
    $("historyPath").textContent = await historyService.DataPath();
    renderHistoryScope();
    renderHistory();
  } catch (error) {
    $("historyList").innerHTML = `<div class="empty-state">历史读取失败：${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  } finally {
    historyLoading = false;
  }
}

function renderHistoryScope() {
  $("historyCurrent").classList.toggle("active", historyScope === "current");
  $("historyAll").classList.toggle("active", historyScope === "all");
}

function renderHistory() {
  const query = $("historySearch").value.trim();
  const list = $("historyList");
  list.innerHTML = "";

  if (!historyItems.length) {
    list.innerHTML = `<div class="empty-state compact">${query ? "没有匹配的历史" : "暂无历史"}</div>`;
    return;
  }

  historyItems.forEach((item) => {
    const row = document.createElement("article");
    row.className = "history-item";
    row.innerHTML = `
      <button class="history-load" type="button">
        <strong>${escapeHtml(historyTitle(item))}</strong>
        <span>${escapeHtml(toolNameByID(item.tool))} · ${escapeHtml(formatTime(item.createdAt))}</span>
        <small>${escapeHtml(summarizeText(item.input || item.output))}</small>
      </button>
      <button class="history-delete" type="button">删除</button>
    `;
    row.querySelector(".history-load").addEventListener("click", () => loadHistoryEntry(item));
    row.querySelector(".history-delete").addEventListener("click", async () => {
      await historyService.Delete(item.id);
      await refreshHistory();
    });
    list.appendChild(row);
  });

  if (historyHasMore) {
    const more = document.createElement("button");
    more.className = "history-more";
    more.type = "button";
    more.textContent = historyLoading ? "加载中..." : "加载更多";
    more.disabled = historyLoading;
    more.addEventListener("click", () => refreshHistory({ append: true }));
    list.appendChild(more);
  }
}

function loadHistoryEntry(item) {
  selectTool(item.tool);
  const isJSONTool = item.tool === "json";
  if (isJSONTool) {
    $("jsonInput").value = item.input || "";
    setJSONOutput(item.output || "", Boolean(item.output));
    setJSONStatus("已载入历史", false);
    return;
  }
  $("inputText").value = item.input || "";
  $("outputText").value = item.output || "";
  renderDetails();
  setStatus("已载入历史", false);
}

function historyTitle(item) {
  return item.title || toolNameByID(item.tool) || "历史记录";
}

function toolNameByID(id) {
  return toolCatalog.find((tool) => tool.id === id)?.name || id || "未知工具";
}

function summarizeText(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= 64) return value;
  return `${value.slice(0, 64)}...`;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function readNumberSetting(key, fallback) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyPanelState() {
  const leftWidth = clamp(panelState.leftWidth, 220, 460);
  const rightWidth = clamp(panelState.rightWidth, 260, 560);
  panelState.leftWidth = leftWidth;
  panelState.rightWidth = rightWidth;
  document.documentElement.style.setProperty("--left-panel-width", `${leftWidth}px`);
  document.documentElement.style.setProperty("--right-panel-width", `${rightWidth}px`);
  document.body.classList.toggle("left-panel-collapsed", panelState.leftCollapsed);
  document.body.classList.toggle("right-panel-collapsed", panelState.rightCollapsed);
  $("toggleLeftPanel").textContent = panelState.leftCollapsed ? "›" : "‹";
  $("toggleRightPanel").textContent = panelState.rightCollapsed ? "‹" : "›";
}

function persistPanelState() {
  localStorage.setItem("wrench-left-panel-width", String(panelState.leftWidth));
  localStorage.setItem("wrench-right-panel-width", String(panelState.rightWidth));
  localStorage.setItem("wrench-left-panel-collapsed", String(panelState.leftCollapsed));
  localStorage.setItem("wrench-right-panel-collapsed", String(panelState.rightCollapsed));
}

function togglePanel(side, collapsed) {
  if (side === "left") {
    panelState.leftCollapsed = collapsed ?? !panelState.leftCollapsed;
  } else {
    panelState.rightCollapsed = collapsed ?? !panelState.rightCollapsed;
  }
  applyPanelState();
  persistPanelState();
}

function bindPanelResize(handle, side) {
  handle.addEventListener("pointerdown", (event) => {
    if ((side === "left" && panelState.leftCollapsed) || (side === "right" && panelState.rightCollapsed)) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-panels");

    const onMove = (moveEvent) => {
      if (side === "left") {
        panelState.leftWidth = clamp(moveEvent.clientX, 220, 460);
      } else {
        panelState.rightWidth = clamp(window.innerWidth - moveEvent.clientX, 260, 560);
      }
      applyPanelState();
    };

    const onUp = () => {
      document.body.classList.remove("resizing-panels");
      persistPanelState();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

$("primaryAction").addEventListener("click", () => runTool($("primaryAction").dataset.action));
$("secondaryAction").addEventListener("click", () => runTool($("secondaryAction").dataset.action));
$("copyOutput").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("outputText").value);
  setStatus("已复制", false);
});
$("clearInput").addEventListener("click", () => {
  $("inputText").value = "";
  $("outputText").value = "";
  renderDetails();
  setStatus("", false);
});
$("fullscreenInput").addEventListener("click", () => openFullscreen("输入", $("inputText").value));
$("fullscreenOutput").addEventListener("click", () => openFullscreen("输出", $("outputText").value));
$("inputText").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    runTool($("primaryAction").dataset.action);
  }
});
$("jsonFormat").addEventListener("click", formatJSON);
$("jsonMinify").addEventListener("click", minifyJSON);
$("jsonClear").addEventListener("click", resetJSONWorkspace);
$("jsonCopy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("jsonOutput").value);
  setJSONStatus("已复制", false);
});
$("jsonSave").addEventListener("click", saveJSONOutput);
$("jsonTableButton").addEventListener("click", showJSONTableView);
$("jsonExpand").addEventListener("click", () => toggleJSONOutputEditor(true));
$("jsonCollapse").addEventListener("click", () => toggleJSONOutputEditor(false));
$("jsonFullscreenInput").addEventListener("click", () => openFullscreen("输入", $("jsonInput").value));
$("jsonFullscreenOutput").addEventListener("click", () => openFullscreen("输出", $("jsonOutput").value));
$("jsonInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    formatJSON();
  }
});
$("backHome").addEventListener("click", showHome);
$("toolSearch").addEventListener("input", renderSidebarTools);
$("toolSearchClear").addEventListener("click", () => {
  $("toolSearch").value = "";
  renderSidebarTools();
});
$("homeToolSearch").addEventListener("input", renderHomeTools);
$("homeToolSearchClear").addEventListener("click", () => {
  $("homeToolSearch").value = "";
  renderHomeTools();
});
$("historyCurrent").addEventListener("click", () => {
  historyScope = "current";
  refreshHistory();
});
$("historyAll").addEventListener("click", () => {
  historyScope = "all";
  refreshHistory();
});
$("historySearch").addEventListener("input", () => refreshHistory());
$("clearHistory").addEventListener("click", async () => {
  const tool = activeHistoryTool();
  await historyService.Clear(tool);
  await refreshHistory();
});
$("toggleLeftPanel").addEventListener("click", () => togglePanel("left"));
$("leftPanelExpand").addEventListener("click", () => togglePanel("left", false));
$("toggleRightPanel").addEventListener("click", () => togglePanel("right"));
$("rightPanelExpand").addEventListener("click", () => togglePanel("right", false));
bindPanelResize($("leftResizeHandle"), "left");
bindPanelResize($("rightResizeHandle"), "right");

applyPanelState();
renderSidebarTools();
renderHomeTools();
refreshHistory();
