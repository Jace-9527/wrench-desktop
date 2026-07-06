# Wrench Desktop

Wrench Desktop 是一个本地桌面工具箱，目标是把常用文本转换工具做成桌面应用，并默认保存每次转换的输入和输出，便于回看和复用。

## 当前工具

- JSON 格式化
- JSON 压缩
- JSON 表格视图
- PG Array 转换
- Base64 编码
- Base64 解码
- URL 编码
- URL 解码
- CSR 格式化/解析
- 证书链格式化/解析

## 历史记录

转换成功后会自动保存历史。当前核心存储使用标准库 JSONL 文件，Wails 服务会把文件放在用户配置目录：

- macOS: `~/Library/Application Support/Wrench Desktop/history.jsonl`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/Wrench Desktop/history.jsonl`
- Windows: `%AppData%\Wrench Desktop\history.jsonl`

前端在普通浏览器中打开时会退化到 `localStorage` 预览模式；在 Wails3 中运行后应通过生成的 `frontend/bindings` 调用 Go 侧 `HistoryService` 持久化。`make frontend-build` 会把已生成的 JS bindings 一起复制到 `frontend/dist`。

## 开发要求

当前依赖的 Wails3 版本会把 `go.mod` 提升到 Go 1.25.0；本机建议使用 Go 1.25+，并通过以下命令安装 CLI：

```shell
go install -v github.com/wailsapp/wails/v3/cmd/wails3@latest
wails3 setup
```

本机当前如果还没有 `wails3` 或 Go 版本不足，需要先升级 Go 和安装 Wails3。

## 常用命令

```shell
make test
make frontend-build
make wails-dev
make wails-build
```

`frontend-build` 只是把无打包器前端复制到 `frontend/dist`，让 Go 的 `embed` 能打包静态资源。

## 官方参考

- Wails3 Quickstart: https://v3.wails.io/
- Wails3 Installation: https://v3.wails.io/getting-started/installation/
- Wails3 Method Bindings: https://v3.wails.io/features/bindings/methods/
