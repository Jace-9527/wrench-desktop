# Wrench Desktop 项目审查报告

> 审查日期：2026-07-06
> 审查范围：Go 后端 + Wails3 + 无打包器前端，约 3000 行代码
> 审查视角：资深产品经理 + 研发

## 概览

**定位**：本地桌面工具箱（JSON / Base64 / URL / PG Array / CSR / 证书），带本地历史记录持久化。
**技术栈**：Go 1.25 + Wails3 alpha + 原生 JS（无框架、无打包器）。
**状态**：`go test ./internal/...` 通过。

整体评价：定位清晰、完成度不错的小工具。代码风格统一、XSS 防护到位、隐私模型（纯本地）讲得通。但存在几处真实的健壮性 bug、测试与工程化缺口，以及产品层面的取舍问题。

---

## 一、产品经理视角

| 维度 | 评价 |
|---|---|
| 场景聚焦 | ✅ 好。工具都是研发日常高频（日志里抠 JSON、SQL IN 数组、证书解析），离线可用是真实卖点 |
| 差异化 | ⚠️ 一般。同类在线 devtools 很多，本地化 + 历史是卖点，但历史目前没有导出/归档/收藏，价值没吃满 |
| 完整闭环 | ⚠️ 历史只能"看和载入"，缺导出 JSON/CSV、置顶收藏、批量清理、去重 |
| 数据治理 | ❌ 历史无上限、无过期。证书/CSR/含 token 的 JSON 会明文永久留存在配置目录，且 README 刚删掉了隐私说明——产品承诺缺失 |
| 一致性 | ⚠️ JSON 工具是独立大特例（单独 workspace + 单独保存路径），其它工具走通用面板，抬高用户心智与维护成本 |
| 可发现性 | ⚠️ 有搜索/别名 tag，不错；但没有"最近使用""快捷键总览"，1280×820 固定初始窗口对小屏不友好 |

**产品建议（按价值排序）**：
1. 历史加容量上限 + 一键导出，并在设置里明确"数据存在本地、永不上传"的承诺（补回被删的隐私文案）。
2. 历史项支持收藏/置顶——工具箱类产品复用率高，这是最自然的留存点。
3. 评估是否把 JSON 的"独立工作台"能力（表格视图、行号高亮）下沉成通用能力，而不是硬编码 `if activeTool.id === "json"`。

---

## 二、研发视角

### 🔴 正确性 / 健壮性 Bug（建议修）

**1. 一条坏行会让整个历史不可读** — `internal/history/store.go:189`
```go
if err := json.Unmarshal([]byte(line), &entry); err != nil {
    return nil, fmt.Errorf("decode history line %d: %w", lineNo, err)
}
```
`Create` 用 `O_APPEND` 追加，一旦进程写入中途崩溃/断电，会留下半行 JSON。此后 `readAllLocked` 对任意一行解析失败就整体报错，导致 `List / Delete / Clear` 全部失效——用户所有历史一次性"消失"。JSONL 的核心优势就是容错，这里反而放弃了。建议：坏行跳过并计数，而不是 `return err`。

**2. ID 非唯一，Delete 可能误删** — `store.go:241`
```go
func newID(now time.Time) string { return fmt.Sprintf("%d", now.UnixNano()) }
```
纳秒时间戳作唯一 ID，理论上同一纳秒的两次 `Create` 会撞 ID；而 `Delete` 是"匹配即删"，撞 ID 会连带删掉另一条。建议加随机后缀或单调计数器（已在锁内，加自增字段最省事）。

**3. 配置目录取不到时静默写进当前工作目录** — `historyservice.go:44`
```go
if err != nil || base == "" { base = "." }
```
异常环境下历史会落到 CWD，用户几乎找不到，且升级后丢失。至少 log 一条，或退回到 `os.UserHomeDir`。

**4. 手写 DER 解析无递归深度限制** — `tool-utils.js:140 parseNode`
构造深度嵌套的 ASN.1 可触发栈溢出。本地工具风险低，但既然要解析外部输入的证书，加个 depth/长度上限是低成本防御。

### 🟡 测试

- `frontend/src/tool-utils.test.js` 写得很好（覆盖 JSON/Base64/URL/PG/证书/CSR），但 `make test` 只跑 Go，这套 JS 测试没有任何入口会执行它（无 `frontend/package.json`、Taskfile 也没引用），等于写了不设防。→ 加 `node --test frontend/src` 进 Makefile。
- 后端测试只有一个 happy-path 用例（`store_test.go`），缺：坏行容错、并发 Create、limit 边界、按 tool 过滤后的 Clear。上面的 bug #1/#2 正是被测试盲区遮住的。

### 🟡 架构 / 可维护性

- **JSON 工具双码路**：`main.js` 里 `formatJSON`/`minifyJSON`/`setJSONOutput` 与通用 `runTool` 是两套保存历史、两套状态管理逻辑（`saveHistoryEntry` 被调用了 3 处），后续加工具容易漏掉一边。
- **`List` 每次全量读文件 + `Delete/Clear` 全量重写**（`store.go:171/197`）。历史无上限时是 O(n) 增长的隐性性能债——配合"产品建议 1"的容量上限一起解决最合适。
- 依赖 **Wails3 `v3.0.0-alpha2.114`** 且强制 **Go 1.25.0**：alpha 版 API 不稳定、bindings 会随版本变动，README 也承认本机可能还没 `wails3`。建议在 go.mod/README 锁定并记录已验证的具体 alpha 版本，避免 `@latest` 漂移。

### 🟢 做得好的地方（值得保持）

- **XSS 防护扎实**：所有动态内容要么 `escapeHtml()`（`main.js:879`），要么走 `textContent`/`textarea.value`，历史项标题/输入/输出都转义了。
- Go 侧 `writeAllLocked` 用临时文件 + rename 原子替换（`store.go:198-222`），文件权限 `0600`，并发有 `sync.Mutex` 保护——很专业。
- 证书解析纯前端 WebCrypto/本地实现，不出网，隐私叙事自洽。
- 代码风格、命名、注释密度一致，README 写清了跨平台存储路径。

### 🟡 工程化 hygiene

- **Makefile 与 Taskfile 职责重叠**（都管 build/dev），且 Taskfile 硬编码 `GO: /usr/local/go/bin/go`——换机器/CI 会断。二选一或明确分工。
- 无 **CI（.github/workflows）**、无 lint（gofmt/vet/eslint）。对一个要分发的桌面应用，至少该有一条 "test + vet + js test" 的流水线。
- `build/`、`cmd/` 是空目录；`.idea/` 已 ignore 但仍在工作区。

---

## 建议的优先级 Backlog

| 优先级 | 事项 | 来源 |
|---|---|---|
| P0 | 历史坏行容错（跳过而非整体报错） | Bug #1 |
| P0 | 把 `node --test` 接入 `make test` / CI | 测试缺口 |
| P1 | ID 加随机/计数后缀，补 Delete 唯一性测试 | Bug #2 |
| P1 | 历史容量上限 + 导出，补回隐私承诺文案 | 产品 + 性能债 |
| P2 | 收敛 JSON 双码路 / 通用化表格视图 | 可维护性 |
| P2 | DER 解析加深度上限；CWD 兜底加日志 | Bug #3/#4 |
| P2 | 锁定 Wails3 alpha 版本，统一 Make/Task | 工程化 |

---

## 三、工程化与架构专项建议

聚焦"从'能用的小工具'走向'可持续演进 / 可分发产品'该动哪几刀"。

### 架构层面

**1. 证书/CSR 解析：保持共享 JS，但把它当共享库做扎实（原"移到 Go"建议已修正）**

背景：`tool-utils.js` 里约 300 行 DER/ASN.1 解析器沿用自网页版。网页版用 JS 是因为"没有后端 = 不上传"的隐私约束；复刻到桌面端时保留 JS，是为了 web/desktop 共享一份已验证逻辑、降低验证成本。

- 澄清：桌面端 Go 跑在本机，改用 Go `crypto/x509` 解析同样一个字节都不出机器——所以"隐私"不再是选 JS 的理由。
- 但"web 与 desktop 不分叉、一份实现一套测试"是正当的工程理由。**因此结论是保持 JS，不改写 Go**（改写反而制造两份平行实现，维护/回归成本翻倍）。
- 落地应做的是把这份共享代码做扎实：
  1. 手写 DER 递归加深度/长度上限，消除栈溢出（即 Bug #4，与语言无关）。
  2. 把解析逻辑当真正的共享库：独立测试套件，web 与 desktop 都引用同一份、都跑同一套测试（当前 desktop 侧 `tool-utils.test.js` 无入口执行，共享价值未兑现——见 P0）。
  3. （可选）若未来要覆盖更多曲线/扩展字段，评估换成 `asn1js`/`pkijs` 等成熟库，但会引入依赖、可能需要打包器，权衡后再定。

**2. 定义真正的 Tool 接口，消灭 JSON 特例**
JSON 工具整个绕过了 `run(action, input) -> {output, details}` 契约：单独 `jsonWorkspace`、单独 `formatJSON/minifyJSON`，`selectTool`/`loadHistoryEntry`/`saveHistoryEntry` 里到处是 `if (isJSONTool)` 分支（`main.js:311/320/776`）。本质是接口表达力不够，只能返回一段字符串，撑不起"行号高亮 + 表格视图"。
建议升级接口：
```text
{
  id, meta, actions,
  run(action, input, options) => { output, details?, view? }
  // view 是可选自定义渲染器：(mountEl, result) => void
}
```
让 JSON 的表格/高亮作为一个 `view` 实现，而非主流程硬编码分支。新增工具只碰 `tools/` 目录，历史保存/载入只有一条路径。

**3. 让 `run()` 不依赖 DOM**
PG Array 的 `run()` 直接读全局 DOM：`optionValue("pgMode")`、`$("pgUnique").checked`（`main.js:79-82`），使 tool 逻辑不可单测、与布局耦合。建议框架根据 `tool.options` 收集出纯 options 对象传给 `run()`。`tool-utils.js` 已是纯函数，别让 `main.js` 的 run 闭包污染回去。

**4. 别把 DOM 当状态存储**
判断"当前是否工具视图"靠读 `$("toolView").hidden`（`main.js:727` 等多处），DOM 作为 single source of truth 很脆。建议一个显式 `appState = { view, activeToolId, activeAction, historyScope }` + 一个 `render()`，几十行即可，无需引入框架。

**5. 拆分 963 行的 `main.js`**
一个模块混了工具目录、DOM 渲染、状态、事件绑定、历史、面板布局、JSON 特化。已在用 ES module，零成本可拆：
```
frontend/src/
  tools/          # 每个工具 = 数据 + 纯 run
  history.js
  layout.js       # 面板折叠/拖拽
  render.js       # 通用渲染
  app.js          # 装配 + 状态
```

### 后端 / 存储

**6. 评估用 SQLite 替换 JSONL**
`List` 每次全量读、`Delete/Clear` 全量重写（`store.go:171/197`），历史无上限即线性增长的性能债；且历史搜索目前是前端 load 100 条再 filter（`main.js:744`），数据一多搜不全。若"历史搜索/归档"是产品方向，`modernc.org/sqlite`（纯 Go、无 cgo）可一次解决分页、按 tool 过滤、FTS 全文搜索、容量裁剪。**先在 `Store` 上定义 `Repository` 接口**（`Create/List/Delete/Clear`），JSONL 作为一个实现，SQLite 作为另一个，可平滑切换、可 mock 测试，顺带满足 P1 的"历史容量上限"。

**7. 稳定的错误契约**
`HistoryService` 直接把 Go 原始 error 抛给前端并展示（`refreshHistory` 里 `escapeHtml(error.message)`）。建议后端返回结构化/可读错误码，前端做本地化提示，而非把 `decode history line 5: unexpected end of JSON` 直接甩给用户。

### 工程化 / CI / 交付

**8. 建立最小 CI（当前完全没有）**
一条 GitHub Actions 即可挡住大部分回归：
```
gofmt -l . && go vet ./... && go test ./... && go build ./...
node --test frontend/src && eslint frontend/src
```
配合 P0——JS 测试现在根本没有入口跑，加个 `frontend/package.json` + `node --test` 即可，不必上 bundler。

**9. 收敛构建工具**
Make 与 Taskfile 目标重叠，且 Taskfile 硬编码 `GO: /usr/local/go/bin/go`（换机/CI 必断）。二选一；Wails 项目倾向留 Taskfile（跨平台、能编排 bindings 生成），但去掉硬编码路径，用 PATH 里的 `go`。

**10. 锁定 alpha 依赖 + 防 bindings 漂移**
- README 让人 `wails3@latest`，代码却锁在 `alpha2.114`。把工具链版本写死（`go.mod` 的 `toolchain` 指令 + README 明确 wails3 tag）。
- `frontend/bindings` 是已提交的生成物——CI 加一步"重新生成后 `git diff --exit-code`"，防止提交的 bindings 与源不一致。

**11. 交付面（暂缓，但要有意识）**
`build/` 空、无应用图标、无 macOS 签名/公证、无 Windows 签名、无自增更新。对外分发时是硬门槛，现在自用可放着，backlog 留位。

### 如果只做 3 件事

1. **给共享 JS 解析器补边界防御（Bug #4）+ 让它的测试真正跑起来** —— 保持 web/desktop 复用，同时堵住最脆弱代码的风险（架构 #1 + 工程 #8）。
2. **建最小 CI** —— 最低成本堵住回归（工程 #8）。
3. **给 Store 定义 `Repository` 接口，为 SQLite/容量上限铺路** —— 解掉存储性能债与历史搜索天花板（架构 #6）。