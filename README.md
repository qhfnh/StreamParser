# H.264/H.265 裸码流在线解析器

一个纯静态前端工具，用于解析 Annex B 格式的 H.264/H.265 裸码流文件。页面在浏览器中读取本地文件，通过 Web Worker 执行 NAL 扫描、参数集解析、帧类型识别、GOP 统计和二进制字段高亮。

## 功能特性

- 支持 `.h264`、`.h265`、`.264`、`.265`、`.hevc`、`.bin` 文件。
- 支持拖拽上传或单击“选择文件”，重复选择同一文件也会重新触发解析。
- 扫描 Annex B 起始码，展示 NAL 偏移、长度、类型、Temporal ID 等信息。
- NAL 单元列表使用紧凑名称显示，完整协议名称保留在悬停提示中，并将 Frame 列放在起始码列之前便于快速查看帧类型。
- 解析 H.264 SPS/PPS/slice/SEI/AUD/EOS/EOB/filler 和 H.265 VPS/SPS/PPS/slice/SEI。
- H.264 字段名、顺序和条件读取按 ITU-T H.264 (08/2024) syntax table 对齐，SEI message 只计入真实 payload，并把 `uuid_iso_iec_11578`、`user_data_payload_byte`、`rbsp_trailing_bits` 和常见 non-VCL RBSP 字段映射到二进制高亮。
- H.265 字段名、顺序和条件读取按 ITU-T H.265 (01/2026) syntax table 对齐，覆盖 PTL、VUI HRD、scaling list、SPS/PPS range/SCC extension、SEI、AUD/EOS/EOB/FD 和 slice header 字段。
- Selected NAL 以树形结构显示字段，支持展开、收起和点击字段高亮二进制范围。
- 支持 H.265 emulation prevention byte 的非连续 bit 高亮。
- 区分固定宽度字段 `u(n)` 与 Exp-Golomb 字段 `ue(v)` / `se(v)`，并显示 codeword 到解析值的关系。
- 提供 I/P/B/IDR、GOP、Total Frames 等统计信息。

## 项目结构

```text
.
├── index.html              # 页面结构与结果面板
├── main.js                 # 前端交互、渲染、筛选和二进制高亮
├── parser-worker.js        # Web Worker 解析核心
├── style.css               # 页面样式
├── tests/                  # Node 回归测试
├── docs/specs/             # 本地协议 PDF
├── ouput.h264              # H.264 回归样本
├── outp.h265               # H.265 回归样本
└── AGENTS.md               # 贡献者/代理协作指南
```

## 协议文档

本仓库已下载 ITU 官方协议 PDF，解析实现应优先参考这些本地文件：

- `docs/specs/ITU-T_H.264_2024-08.pdf`：ITU-T H.264 (08/2024)，Advanced video coding for generic audiovisual services。
- `docs/specs/ITU-T_H.265_2026-01.pdf`：ITU-T H.265 (01/2026)，High efficiency video coding。

## 本地运行

本项目没有构建步骤，直接启动静态服务器即可：

```powershell
python -m http.server 8000
```

然后访问：

```text
http://127.0.0.1:8000/
```

在页面中选择或拖拽码流文件即可开始解析。

## 测试

语法检查：

```powershell
node --check main.js
node --check parser-worker.js
```

运行全部测试：

```powershell
Get-ChildItem -Path tests -Filter *.test.js | ForEach-Object { node $_.FullName }
```

测试覆盖内容包括字段映射、二进制高亮、H.264/H.265 样本解析、布局约束和 UI 文本约束。

## 开发说明

- 解析逻辑集中在 `parser-worker.js`，UI 渲染逻辑集中在 `main.js`。
- 修改字段解析时，需要同步维护 `fieldMap`，否则 Selected NAL 中字段无法点击高亮。
- 修改 H.264/H.265 bit 映射时，要保留 `segments` 逻辑，避免把 `0x03` 防竞争字节计入字段高亮。
- 修改 `main.js` 或 `parser-worker.js` 后，建议更新 `index.html` / worker 引用中的版本号，避免浏览器缓存旧文件。

## 已知说明

Exp-Golomb 字段的高亮码字不等于普通二进制值。例如 H.264 中 `max_dec_frame_buffering = 4` 的 `ue(v)` 码字是 `00101`，普通二进制看是 5，但按 `ue(v)` 解码值为 4。
