import "./tool-utils.js";

const utils = globalThis.WrenchUtils;
const $ = (id) => document.getElementById(id);

const tools = [
  {
    id: "json-format",
    name: "JSON 格式化",
    category: "数据处理",
    desc: "从日志或混杂文本中提取 JSON 并格式化",
    placeholder: "2026-07-06 INFO {\"ok\":true,\"items\":[1,2]}",
    async transform(input) {
      return { output: utils.formatJSONText(input, 2) };
    }
  },
  {
    id: "json-minify",
    name: "JSON 压缩",
    category: "数据处理",
    desc: "提取 JSON 并压缩为单行",
    placeholder: "{\n  \"ok\": true\n}",
    async transform(input) {
      return { output: utils.minifyJSONText(input) };
    }
  },
  {
    id: "json-table",
    name: "JSON 表格视图",
    category: "数据处理",
    desc: "把对象或数组展开为路径和值",
    placeholder: "{\"user\":{\"name\":\"Alice\"},\"roles\":[\"admin\"]}",
    async transform(input) {
      const value = JSON.parse(utils.extractJSONText(input));
      return { output: jsonToRows(value).map((row) => `${row.path}\t${row.value}`).join("\n") };
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
    id: "base64-encode",
    name: "Base64 编码",
    category: "编码转换",
    desc: "UTF-8 文本编码为 Base64",
    placeholder: "中文 test",
    async transform(input) {
      return { output: utils.utf8ToBase64(input) };
    }
  },
  {
    id: "base64-decode",
    name: "Base64 解码",
    category: "编码转换",
    desc: "Base64 解码为 UTF-8 文本，兼容 URL-safe Base64",
    placeholder: "5Lit5paHIHRlc3Q=",
    async transform(input) {
      return { output: utils.base64ToUtf8(input) };
    }
  },
  {
    id: "url-encode",
    name: "URL 编码",
    category: "编码转换",
    desc: "URL percent-encoding 编码",
    placeholder: "name=张三&x=1 2",
    async transform(input) {
      return { output: utils.encodeURLText(input) };
    }
  },
  {
    id: "url-decode",
    name: "URL 解码",
    category: "编码转换",
    desc: "URL percent-encoding 解码，+ 会按空格处理",
    placeholder: "name%3D%E5%BC%A0%E4%B8%89%26x%3D1+2",
    async transform(input) {
      return { output: utils.decodeURLText(input) };
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
  $("toolNav").innerHTML = "";
  tools.forEach((tool) => {
    const button = document.createElement("button");
    button.className = "tool-button";
    button.classList.toggle("active", tool.id === activeTool.id);
    button.innerHTML = `<strong>${tool.name}</strong><span>${tool.category}</span><small>${tool.desc}</small>`;
    button.addEventListener("click", () => selectTool(tool.id));
    $("toolNav").appendChild(button);
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

async function selectTool(id) {
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
  await refreshHistory();
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
  historyItems = await historyService.List(activeTool.id, 100) || [];
  renderHistory();
}

function renderHistory() {
  const query = $("historySearch").value.trim().toLowerCase();
  const list = $("historyList");
  list.innerHTML = "";

  const filtered = historyItems.filter((item) => `${item.title} ${item.input} ${item.output}`.toLowerCase().includes(query));
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty">暂无历史</div>`;
    return;
  }

  filtered.forEach((item) => {
    const row = document.createElement("article");
    row.className = "history-item";
    row.innerHTML = `
      <button class="history-load">
        <strong>${escapeHtml(item.title || item.tool)}</strong>
        <span>${formatTime(item.createdAt)}</span>
        <small>${escapeHtml(item.input || item.output)}</small>
      </button>
      <button class="history-delete">删除</button>
    `;
    row.querySelector(".history-load").addEventListener("click", () => {
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
  await historyService.Clear(activeTool.id);
  await refreshHistory();
});
$("historySearch").addEventListener("input", renderHistory);

$("historyPath").textContent = await historyService.DataPath();
await selectTool(activeTool.id);
