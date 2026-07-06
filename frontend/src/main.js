const tools = [
  {
    id: "json",
    name: "JSON",
    category: "数据处理",
    placeholder: "{\"name\":\"Wrench\"}",
    transform(input) {
      return JSON.stringify(JSON.parse(input), null, 2);
    }
  },
  {
    id: "base64-encode",
    name: "Base64 编码",
    category: "编码转换",
    placeholder: "需要编码的 UTF-8 文本",
    transform(input) {
      return btoa(unescape(encodeURIComponent(input)));
    }
  },
  {
    id: "base64-decode",
    name: "Base64 解码",
    category: "编码转换",
    placeholder: "5L2g5aW9",
    transform(input) {
      return decodeURIComponent(escape(atob(input.trim())));
    }
  },
  {
    id: "url-encode",
    name: "URL 编码",
    category: "编码转换",
    placeholder: "https://example.com/?q=本地工具",
    transform(input) {
      return encodeURIComponent(input);
    }
  },
  {
    id: "url-decode",
    name: "URL 解码",
    category: "编码转换",
    placeholder: "https%3A%2F%2Fexample.com%2F%3Fq%3D%E6%9C%AC%E5%9C%B0%E5%B7%A5%E5%85%B7",
    transform(input) {
      return decodeURIComponent(input);
    }
  }
];

const $ = (id) => document.getElementById(id);
let activeTool = tools[0];
let historyItems = [];

const localHistory = {
  async Create(req) {
    const entry = {
      id: String(Date.now()),
      createdAt: new Date().toISOString(),
      title: req.title || req.input.replace(/\s+/g, " ").slice(0, 48) || req.tool,
      ...req
    };
    const items = JSON.parse(localStorage.getItem("wrench-desktop-history") || "[]");
    items.push(entry);
    localStorage.setItem("wrench-desktop-history", JSON.stringify(items));
    return entry;
  },
  async List(tool, limit) {
    const items = JSON.parse(localStorage.getItem("wrench-desktop-history") || "[]");
    return items
      .filter((item) => !tool || item.tool === tool)
      .slice()
      .reverse()
      .slice(0, limit || 100);
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
    button.innerHTML = `<strong>${tool.name}</strong><span>${tool.category}</span>`;
    button.addEventListener("click", () => selectTool(tool.id));
    $("toolNav").appendChild(button);
  });
}

async function selectTool(id) {
  activeTool = tools.find((tool) => tool.id === id) || tools[0];
  $("toolName").textContent = activeTool.name;
  $("toolCategory").textContent = activeTool.category;
  $("inputText").placeholder = activeTool.placeholder;
  $("outputText").value = "";
  $("statusText").textContent = "";
  renderTools();
  await refreshHistory();
}

async function runTransform() {
  const input = $("inputText").value;
  if (!input.trim()) {
    $("statusText").textContent = "请输入内容";
    return;
  }

  try {
    const output = activeTool.transform(input);
    $("outputText").value = output;
    await historyService.Create({
      tool: activeTool.id,
      title: activeTool.name,
      input,
      output
    });
    $("statusText").textContent = "已转换并保存";
    await refreshHistory();
  } catch (error) {
    $("statusText").textContent = error instanceof Error ? error.message : String(error);
  }
}

async function refreshHistory() {
  historyItems = await historyService.List(activeTool.id, 100);
  renderHistory();
}

function renderHistory() {
  const query = $("historySearch").value.trim().toLowerCase();
  const list = $("historyList");
  list.innerHTML = "";

  const filtered = historyItems.filter((item) => {
    const text = `${item.title} ${item.input} ${item.output}`.toLowerCase();
    return text.includes(query);
  });

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
      $("statusText").textContent = "已载入历史";
    });
    row.querySelector(".history-delete").addEventListener("click", async () => {
      await historyService.Delete(item.id);
      await refreshHistory();
    });
    list.appendChild(row);
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

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

$("primaryAction").addEventListener("click", runTransform);
$("copyOutput").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("outputText").value);
  $("statusText").textContent = "已复制";
});
$("clearInput").addEventListener("click", () => {
  $("inputText").value = "";
  $("outputText").value = "";
  $("statusText").textContent = "";
});
$("clearHistory").addEventListener("click", async () => {
  await historyService.Clear(activeTool.id);
  await refreshHistory();
});
$("historySearch").addEventListener("input", renderHistory);

$("historyPath").textContent = await historyService.DataPath();
await selectTool(activeTool.id);
