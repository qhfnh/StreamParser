# H.264/H.265 裸码流在线解析器

一个纯静态前端工具，用于解析 Annex B 格式的 H.264/H.265 裸码流文件。页面在浏览器中读取本地文件，通过 Web Worker 执行 NAL 扫描、参数集解析、帧类型识别、GOP 统计和二进制字段高亮。

## 功能特性

- 支持 H.264/H.265 Annex B 裸码流文件上传与本地解析。
- 自动扫描起始码并列出 NAL 单元的类型、名称、偏移、长度、帧类型和层级信息。
- 支持按 NAL 类型、名称、Frame 编号和 I/P/B/IDR 帧类型筛选。
- 解析 H.264 SPS、PPS、slice、SEI、AUD、EOS、EOB、filler 等结构。
- 解析 H.265 VPS、SPS、PPS、slice、SEI 等结构。
- 以树形方式展示 Selected NAL 字段，支持展开、收起和字段定位。
- 点击字段可高亮对应二进制 bit，支持固定宽度字段和 Exp-Golomb 字段。
- 支持 H.265 防竞争字节场景下的非连续 bit 范围高亮。
- 提供参数集详情、I/P/B/IDR 统计、GOP 统计和 Total Frames 信息。
- 支持中文和英文界面切换。

## 项目结构

```text
.
├── index.html              # 首页、上传入口与结果面板
├── pages/                  # 独立内容页、FAQ、关于和合规页面
│   ├── h264-guide.html
│   ├── h265-guide.html
│   ├── h264-vs-h265.html
│   ├── annex-b-vs-mp4.html
│   ├── sps-pps-vps-explained.html
│   ├── examples.html
│   ├── faq.html
│   ├── about.html
│   ├── privacy.html
│   ├── terms.html
│   └── contact.html
├── assets/                 # 浏览器端脚本与样式
│   ├── main.js             # 前端交互、渲染、筛选和二进制高亮
│   ├── site-i18n.js        # 独立内容页中英文切换
│   ├── parser-worker.js    # Web Worker 解析核心
│   └── style.css           # 页面样式
├── samples/                # 本地回归样本
│   ├── ouput.h264
│   └── outp.h265
├── robots.txt              # 搜索引擎抓取规则
├── tests/                  # Node 回归测试
└── docs/specs/             # 本地协议 PDF
```

## 协议文档

本仓库包含以下 ITU 官方协议 PDF：

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
node --check assets/main.js
node --check assets/parser-worker.js
node --check assets/site-i18n.js
```

运行全部测试：

```powershell
Get-ChildItem -Path tests -Filter *.test.js | ForEach-Object { node $_.FullName }
```

测试覆盖内容包括字段映射、二进制高亮、H.264/H.265 样本解析、布局约束、UI 文本约束和内容页中英文切换约束。

## 已知说明

Exp-Golomb 字段的高亮码字不等于普通二进制值。例如 H.264 中 `max_dec_frame_buffering = 4` 的 `ue(v)` 码字是 `00101`，普通二进制看是 5，但按 `ue(v)` 解码值为 4。
