import "./tool-utils.js";

const utils = globalThis.WrenchUtils;
const $ = (id) => document.getElementById(id);
const categoryOrder = ["数据处理", "编码转换", "证书工具"];

const tools = [
  {
    id: "json",
    name: "JSON",
    category: "数据处理",
    desc: "提取、格式化、压缩和表格查看 JSON",
    placeholder: "2026-07-06 INFO {\"ok\":true,\"items\":[1,2]}",
    options: [
      { id: "jsonMode", label: "处理方式", type: "select", value: "format", choices: [["format", "格式化"], ["minify", "压缩"], ["table", "表格视图"]] }
    ],
    async transform(input) {
      const mode = optionValue("jsonMode");
      if (mode === "minify") {
        return { output: utils.minifyJSONText(input) };
      }
      if (mode === "table") {
        const value = JSON.parse(utils.extractJSONText(input));
        return { output: jsonToRows(value).map((row) => `${row.path}\t${row.value}`).join("\n") };
      }
      return { output: utils.formatJSONText(input, 2) };
    }
  },
  {
    id: "pg-array",
    name: "PG Array 转换",
    category: "数据处理",
    desc: "把换行、逗号或空格分隔的 ID 转为 SQL IN 片段",
    placeholder: "1001\n1002,1003",
    options: [
      { id: "pgMode", label: "输出模式", type: "select", value: "auto", choices: [["auto", "自动"], ["number", "数字"], ["string", "字符串"]] },
      { id: "pgUnique", label: "去重", type: "checkbox", checked: true }
    ],
    async transform(input) {
      return {
        output: utils.toPGArray(input, {
          mode: optionValue("pgMode"),
          unique: $("pgUnique").checked
        })
      };
    }
  },
  {
    id: "base64",
    name: "Base64",
    category: "编码转换",
    desc: "UTF-8 文本 Base64 编码和解码",
    placeholder: "中文 test",
    options: [
      { id: "base64Mode", label: "处理方式", type: "select", value: "encode", choices: [["encode", "编码"], ["decode", "解码"]] }
    ],
    async transform(input) {
      if (optionValue("base64Mode") === "decode") {
        return { output: utils.base64ToUtf8(input) };
      }
      return { output: utils.utf8ToBase64(input) };
    }
  },
  {
    id: "url",
    name: "URL",
    category: "编码转换",
    desc: "URL percent-encoding 编码和解码",
    placeholder: "name=张三&x=1 2",
    options: [
      { id: "urlMode", label: "处理方式", type: "select", value: "encode", choices: [["encode", "编码"], ["decode", "解码"]] }
    ],
    async transform(input) {
      if (optionValue("urlMode") === "decode") {
        return { output: utils.decodeURLText(input) };
      }
      return { output: utils.encodeURLText(input) };
    }
  },
  {
    id: "csr",
    name: "CSR 格式化/解析",
    category: "证书工具",
    desc: "规范化 CSR PEM，并解析 Subject、SAN 和算法",
    placeholder: "-----BEGIN CERTIFICATE REQUEST-----\\n...\\n-----END CERTIFICATE REQUEST-----",
    async transform(input) {
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
    name: "证书链格式化/解析",
    category: "证书工具",
    desc: "拆分证书链、规范化 PEM，并解析 X.509 基础字段",
    placeholder: "-----BEGIN CERTIFICATE-----\\n...\\n-----END CERTIFICATE-----",
    async transform(input) {
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

let activeTool = tools[0];
let historyItems = [];
let historyScope = "current";

const localHistory = {
  async Create(req) {
    const entry = {
      id: String(Date.now()),
      createdAt: new Date().toISOString(),
      title: req.title || summarize(req.input) || req.tool,
      ...req
    };
    const items = JSON.parse(localStorage.getItem("wrench-desktop-history") || "[]");
    items.push(entry);
    localStorage.setItem("wrench-desktop-history", JSON.stringify(items));
    return entry;
  },
  async List(tool, limit) {
    const items = JSON.parse(localStorage.getItem("wrench-desktop-history") || "[]");
    return items.filter((item) => !tool || item.tool === tool).slice().reverse().slice(0, limit || 100);
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

function renderTools() {
  const nav = $("toolNav");
  const query = $("toolSearch").value.trim().toLowerCase();
  nav.innerHTML = "";

  const filtered = tools.filter((tool) => matchesTool(tool, query));
  if (filtered.length === 0) {
    nav.innerHTML = `<div class="empty compact">没有匹配的工具</div>`;
    return;
  }

  categoryOrder
    .filter((category) => filtered.some((tool) => tool.category === category))
    .forEach((category) => {
      const group = document.createElement("section");
      group.className = "tool-group";
      const categoryTools = filtered.filter((tool) => tool.category === category);
      group.innerHTML = `<div class="tool-category"><span>${category}</span><small>${categoryTools.length}</small></div>`;
      categoryTools.forEach((tool) => {
        const button = document.createElement("button");
        button.className = "tool-button";
        button.classList.toggle("active", tool.id === activeTool.id);
        button.innerHTML = `<strong>${tool.name}</strong><span>${tool.category}</span><small>${tool.desc}</small>`;
        button.addEventListener("click", () => selectTool(tool.id));
        group.appendChild(button);
      });
      nav.appendChild(group);
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

async function selectTool(id, options = {}) {
  activeTool = tools.find((tool) => tool.id === id) || tools[0];
  $("toolName").textContent = activeTool.name;
  $("toolCategory").textContent = activeTool.category;
  $("inputText").placeholder = activeTool.placeholder;
  $("primaryAction").textContent = "转换并保存";
  $("outputText").value = "";
  $("statusText").textContent = "";
  renderDetails();
  renderTools();
  renderOptions();
  if (!options.keepHistory) {
    await refreshHistory();
  }
}

async function runTransform() {
  const input = $("inputText").value;
  if (!input.trim()) {
    setStatus("请输入内容", true);
    return;
  }

  try {
    setStatus("处理中...", false);
    const result = await activeTool.transform(input);
    $("outputText").value = result.output;
    renderDetails(result.details);
    await historyService.Create({
      tool: activeTool.id,
      title: activeTool.name,
      input,
      output: result.output
    });
    setStatus("已转换并保存", false);
    await refreshHistory();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function refreshHistory() {
  const tool = historyScope === "current" ? activeTool.id : "";
  historyItems = await historyService.List(tool, 100) || [];
  renderHistoryScope();
  renderHistory();
}

function renderHistory() {
  const query = $("historySearch").value.trim().toLowerCase();
  const list = $("historyList");
  list.innerHTML = "";

  const filtered = historyItems.filter((item) => `${historyTitle(item)} ${item.input} ${item.output}`.toLowerCase().includes(query));
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty">暂无历史</div>`;
    return;
  }

  filtered.forEach((item) => {
    const row = document.createElement("article");
    row.className = "history-item";
    row.innerHTML = `
      <button class="history-load">
        <strong>${escapeHtml(historyTitle(item))}</strong>
        <span>${formatTime(item.createdAt)}</span>
        <small>${escapeHtml(item.input || item.output)}</small>
      </button>
      <button class="history-delete">删除</button>
    `;
    row.querySelector(".history-load").addEventListener("click", async () => {
      if (item.tool && item.tool !== activeTool.id) {
        await selectTool(item.tool, { keepHistory: true });
      }
      $("inputText").value = item.input || "";
      $("outputText").value = item.output || "";
      renderDetails();
      setStatus("已载入历史", false);
    });
    row.querySelector(".history-delete").addEventListener("click", async () => {
      await historyService.Delete(item.id);
      await refreshHistory();
    });
    list.appendChild(row);
  });
}

function renderHistoryScope() {
  $("historyCurrent").classList.toggle("active", historyScope === "current");
  $("historyAll").classList.toggle("active", historyScope === "all");
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

function jsonToRows(value, prefix = "$") {
  if (value === null || typeof value !== "object") {
    return [{ path: prefix, value: JSON.stringify(value) }];
  }
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

function matchesTool(tool, query) {
  if (!query) return true;
  return [tool.name, tool.category, tool.desc, tool.id].join(" ").toLowerCase().includes(query);
}

function historyTitle(item) {
  const tool = tools.find((candidate) => candidate.id === item.tool);
  if (historyScope === "all" && tool) {
    return `${tool.name} · ${item.title || summarize(item.input) || item.tool}`;
  }
  return item.title || item.tool;
}

function setStatus(text, isError) {
  $("statusText").textContent = text;
  $("statusText").classList.toggle("error", Boolean(isError));
}

function summarize(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 48);
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

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

$("primaryAction").addEventListener("click", runTransform);
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
$("clearHistory").addEventListener("click", async () => {
  await historyService.Clear(historyScope === "current" ? activeTool.id : "");
  await refreshHistory();
});
$("historySearch").addEventListener("input", renderHistory);
$("toolSearch").addEventListener("input", renderTools);
$("historyCurrent").addEventListener("click", async () => {
  historyScope = "current";
  await refreshHistory();
});
$("historyAll").addEventListener("click", async () => {
  historyScope = "all";
  await refreshHistory();
});

$("historyPath").textContent = await historyService.DataPath();
await selectTool(activeTool.id);
