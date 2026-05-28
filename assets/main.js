/**
 * H.264/H.265 Bitstream Analyzer — Main Thread UI
 *
 * Handles file upload (drag-drop / click), Worker lifecycle,
 * tab navigation, and result rendering.
 */

(function () {
  'use strict';

  // === DOM References ===
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileInfo = document.getElementById('file-info');
  const progressBar = document.getElementById('progress-bar');
  const progressFill = progressBar.querySelector('.progress-fill');
  const progressText = progressBar.querySelector('.progress-text');
  const resultsSection = document.getElementById('results-section');
  const errorSection = document.getElementById('error-section');
  const errorContent = document.getElementById('error-content');
  const summaryStats = document.getElementById('summary-stats');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const nalTbody = document.getElementById('nal-tbody');
  const nalFieldList = document.getElementById('nal-field-list');
  const nalDetailTitle = document.getElementById('nal-detail-title');
  const nalDetailBadge = document.getElementById('nal-detail-badge');
  const nalBinaryTitle = document.getElementById('nal-binary-title');
  const nalBinaryRange = document.getElementById('nal-binary-range');
  const nalBinaryView = document.getElementById('nal-binary-view');
  const nalCodecHeader = document.getElementById('nal-codec-header');
  const nalFilter = document.getElementById('nal-filter');
  const languageButtons = document.querySelectorAll('#language-switch [data-lang]');

  // === Localization ===
  const LANGUAGE_STORAGE_KEY = 'bitstream-parser-language';
  const DEFAULT_LANGUAGE = 'zh';
  const I18N = {
    zh: {
      'document.title': 'H.264/H.265 码流解析器 - 什么是 H.264/H.265 | NAL 单元分析 | 帧类型检测',
      'document.description': '了解什么是 H.264、什么是 H.265/HEVC，并在线解析 H.264/H.265 Annex B 裸码流。支持 NAL 单元、SPS/PPS/VPS 参数集、I/P/B/IDR 帧类型、GOP 与 SEI 消息分析，所有解析在本地浏览器执行。',
      skip: '跳转到主要内容',
      'app.title': 'H.264/H.265 裸码流在线解析器',
      'app.subtitle': 'Annex B 字节流分析 - NAL 单元扫描 · 参数集深度解析 · 帧类型与 GOP 检测',
      'nav.tool': '解析工具',
      'nav.docs': '文档',
      'nav.h264': 'H.264 教程',
      'nav.h265': 'H.265 教程',
      'nav.compare': 'H.264 vs H.265',
      'nav.examples': '示例解析',
      'nav.faq': 'FAQ',
      'nav.about': '关于',
      'nav.privacy': '隐私政策',
      'nav.terms': '使用条款',
      'nav.contact': '联系',
      'portal.tools': '解析工具',
      'portal.mainNavAria': '主导航',
      'portal.tutorials': '教程',
      'portal.protocol': '协议',
      'sub.parser': '在线解析器',
      'sub.navAria': '二级导航',
      'docs.quickStart': '快速开始',
      'docs.h264': 'H.264',
      'docs.h265': 'H.265',
      'docs.compare': 'H.264 vs H.265',
      'docs.annex': 'Annex B / MP4',
      'docs.params': '参数集',
      'upload.title': '上传码流文件',
      'upload.dropAria': '拖拽 .h264 或 .h265 文件到此处，或点击选择文件',
      'upload.dropText': '拖拽 <strong>.h264</strong> 或 <strong>.h265</strong> 裸流文件到此处',
      'upload.or': '- 或 -',
      'upload.choose': '选择文件',
      'upload.hint': '支持 Annex B 字节流格式（起始码 0x000001 / 0x00000001）',
      'results.title': '解析结果',
      'results.tabsAria': '解析结果分类',
      'tabs.nal': 'NAL 单元列表',
      'tabs.params': '参数集详情',
      'tabs.frames': '帧分析 & GOP',
      'tabs.sei': 'SEI 消息',
      'inspector.aria': 'NAL 字段解析',
      'inspector.kicker': 'Selected NAL',
      'inspector.emptyTitle': '未选择 NAL',
      'inspector.selectRow': '请选择一个 NAL 行。',
      'inspector.noFields': '没有可显示的解析字段。',
      'inspector.nalTitle': 'NAL #{index}',
      'inspector.typeBadge': '类型 {type}',
      'binary.title': '二进制',
      'binary.nalTitle': '二进制 · NAL #{index}',
      'binary.noBytesLoaded': '未加载字节。',
      'binary.noBytesAvailable': '没有可显示的字节。',
      'binary.allBytes': '显示全部 {total} 字节',
      'binary.windowBytes': '显示字节 {start}-{end} / {total}（预览窗口）',
      'table.type': '类型',
      'table.name': '名称',
      'table.offset': '偏移',
      'table.length': '长度',
      'table.frame': 'Frame',
      'table.startCode': '起始码',
      'table.refIdc': 'Ref IDC',
      'table.layerId': 'Layer ID',
      'search.placeholder': '搜索 NAL 类型、名称或 I/P/B...',
      'summary.totalNals': 'NAL 总数',
      'summary.totalFrames': '总帧数',
      'summary.iFrames': 'I 帧',
      'summary.idrFrames': 'IDR 帧',
      'summary.pFrames': 'P 帧',
      'summary.bFrames': 'B 帧',
      'summary.gops': 'GOP（平均 {avg}）',
      'summary.maxTid': '最大 Temporal ID',
      'summary.codec': '编码格式',
      'tree.nalUnit': 'NAL 单元',
      'tree.header': 'Header',
      'tree.parsedFields': '解析字段',
      'collection.itemOne': '1 项',
      'collection.itemMany': '{count} 项',
      'collection.fieldOne': '1 个字段',
      'collection.fieldMany': '{count} 个字段',
      'collection.arrayPreview': '[{count} 项]',
      'value.na': 'N/A',
      'coding.codeword': '{coding} codeword {codeword} -> {value} | ',
      'coding.codingOnly': '{coding} | ',
      'range.bitsSingle': 'bits {start}-{end}',
      'range.bitsMulti': 'bits {preview}{suffix}',
      'range.bitsMore': ' +{count}',
      'params.empty': '此码流中未找到参数集。',
      'frames.total': 'Total',
      'frames.gops': 'GOPs',
      'frames.avgGopSize': '平均 GOP 长度',
      'frames.truncated': '显示前 120 / {total} 帧',
      'sei.empty': '未找到 SEI 消息。',
      'sei.type': '类型 {type}',
      'sei.meta': 'NAL #{index} · {bytes} 字节',
      'error.title': '解析错误',
      'error.worker': 'Worker 错误：{message}',
      'error.workerFallback': '加载 parser-worker.js 失败',
      'error.workerMessage': 'Worker 返回了无法读取的消息。',
      'error.unsupportedFile': '不支持的文件类型。请上传 .h264 或 .h265 Annex B 裸码流文件。',
      'error.startWorker': '启动解析 Worker 失败：{message}',
      'error.readFile': '读取文件失败。',
      'error.nal': '[NAL #{index}] {type}: {message}',
      'error.containerMp4': '检测到 MP4/MOV 容器，请先提取原始 Annex B 裸码流。',
      'error.containerMkv': '检测到 MKV/WebM 容器，请先提取原始 Annex B 裸码流。',
      'error.noNal': '未找到 NAL 单元。请确认文件是原始 .h264 或 .h265 Annex B 裸码流，而不是 MP4/MKV 等容器格式。',
      'error.unknownCodec': '无法判断编码格式（H.264 或 H.265）。码流可能已损坏，或不是可识别的格式。',
      'error.fatalParse': '严重解析错误：{message}',
      'file.info': '文件：{name}（{size}）',
      'unit.bytes': '{count} 字节',
      'resources.title': '视频码流学习与排查',
      'resources.h264Title': 'H.264/AVC 基础指南',
      'resources.h264Body': '了解 H.264 编码、Annex B 裸流、SPS/PPS、slice header 和常见 NAL 类型。',
      'resources.h265Title': 'H.265/HEVC 基础指南',
      'resources.h265Body': '理解 VPS/SPS/PPS、Temporal ID、HEVC NAL 类型和 H.265 相比 H.264 的变化。',
      'resources.annexTitle': 'Annex B 与 MP4 容器区别',
      'resources.annexBody': '解释为什么本工具解析裸码流，以及如何从 MP4/MKV 中提取 .h264 或 .h265。',
      'resources.paramsTitle': '参数集字段怎么看',
      'resources.paramsBody': '用实际字段说明分辨率、profile、level、VUI、HRD 与码流兼容性信息。',
      'progress.scanning': '正在扫描 NAL 单元...',
      'progress.found': '找到 {count} 个 NAL 单元，正在检测编码格式...',
      'progress.detected': '检测到 {codec} 编码，正在解析头部...',
      'progress.parsingNal': '正在解析 NAL {current}/{total}...',
      'progress.gop': '正在计算 GOP 统计...',
      'progress.preparing': '正在准备结果...',
      'progress.complete': '解析完成。',
      'tech.title': '关于 H.264/H.265 码流结构',
      'tech.whatH264Title': '什么是 H.264？',
      'tech.whatH264Body': 'H.264 又称 <strong>AVC（Advanced Video Coding）</strong>，是一种广泛使用的视频压缩编码标准。它通过帧内预测、帧间预测、变换、量化和熵编码压缩视频数据，常见于 MP4 视频、直播、视频会议、监控录像和网页视频。本工具解析的是 H.264 <strong>Annex B 裸码流</strong>，可以直接查看 NAL 单元、SPS/PPS、I/P/B/IDR 帧和二进制字段。',
      'tech.whatH265Title': '什么是 H.265？',
      'tech.whatH265Body': 'H.265 又称 <strong>HEVC（High Efficiency Video Coding）</strong>，是 H.264 之后的视频压缩标准。它使用更灵活的编码树单元、预测和变换结构，通常在相近画质下比 H.264 提供更高压缩效率，适合 4K、8K 和高码率视频。本工具支持解析 H.265/HEVC Annex B 裸码流中的 VPS/SPS/PPS、slice header、SEI 和 Temporal ID 等信息。',
      'tech.nalTitle': 'NAL 单元与 Annex B 字节流',
      'tech.nalBody': 'H.264（AVC）与 H.265（HEVC）编码的视频在传输和存储时通常采用 <strong>Annex B 字节流格式</strong>。该格式通过<strong>起始码（Start Code）</strong>来分隔连续的 NAL（Network Abstraction Layer）单元。起始码可以是 3 字节的 <code>0x000001</code> 或 4 字节的 <code>0x00000001</code>，解析器通过扫描这些特征字节序列来定位每个 NAL 单元的边界，从而完成<strong>码流解析</strong>的第一步。',
      'tech.paramTitle': '参数集：SPS、PPS 与 VPS',
      'tech.paramBody': 'H.264 码流中，<strong>SPS（序列参数集）</strong>包含图像分辨率（通过 <code>frame_cropping</code> 偏移量计算实际宽高）、profile 与 level 标识、色度采样格式（<code>chroma_format_idc</code>）等全局信息。H.265/HEVC 在此基础上增加了 <strong>VPS（视频参数集）</strong>，用于描述多层编码、可伸缩视频等高级特性。VPS 中的 <code>profile_tier_level</code> 结构定义了编码器的能力等级，而 <code>conformance_window</code> 标志用于从编码分辨率推导显示分辨率。',
      'tech.frameTitle': '帧类型识别与 GOP 分析',
      'tech.frameBody': '通过解析 VCL NAL 单元中的 <strong>Slice Header</strong>，可以提取 <code>slice_type</code> 字段，从而判断当前帧是 <strong>I 帧（帧内预测）</strong>、<strong>P 帧（前向预测）</strong> 还是 <strong>B 帧（双向预测）</strong>。连续的编码帧组成一个 <strong>GOP（Group of Pictures）</strong>，通常以 I 帧为起始。GOP 长度和结构直接影响视频的随机访问性能和压缩效率。本工具自动统计 I/P/B 帧数量与 GOP 分布，辅助分析编码器配置。',
      'tech.seiTitle': 'SEI 消息与补充增强信息',
      'tech.seiBody': '<strong>SEI（Supplemental Enhancement Information）</strong>负载携带不影响解码的辅助信息，常见的包括缓冲周期（<code>buffering_period</code>）、图像时序（<code>pic_timing</code>）、用户自定义数据（<code>user_data_unregistered</code>）等。这些消息在码流分析、调试和合规性检测中具有重要价值。',
      'tech.bitstreamTitle': '位流读取与标准参照',
      'tech.bitstreamBody': '裸码流解析的核心是<strong>基于标准的位流读取</strong>。H.264 语法参照 ITU-T H.264 (08/2024) 第 7.3 节，H.265 语法参照 ITU-T H.265 (01/2026) 第 7.3 节。本解析器实现了完整的 Exp-Golomb 熵解码、定长和变长字段读取，以及对 <code>ue(v)</code>、<code>se(v)</code> 等描述符的精确处理。所有解析逻辑在 Web Worker 中异步执行，确保大文件解析时不影响页面交互。',
      'footer.security': '<strong>安全声明：</strong>所有文件解析仅在您的本地浏览器中执行，码流数据不会上传至任何服务器。本工具完全离线可用，无需网络连接。',
      'footer.linksAria': '站点链接',
      'footer.compatibility': '支持格式：H.264 Annex B 裸流（.h264）、H.265/HEVC Annex B 裸流（.h265）。不支持 MP4、MKV 等容器格式。',
      'footer.tech': '基于 ITU-T H.264 (08/2024) 与 ITU-T H.265 (01/2026) 标准语法实现。纯原生 JavaScript，无第三方依赖，Web Worker 多线程解析。'
    },
    en: {
      'document.title': 'H.264/H.265 Bitstream Analyzer - What Are H.264 and H.265 | NAL Analysis | Frame Detection',
      'document.description': 'Learn what H.264 and H.265/HEVC are, then analyze H.264/H.265 Annex B raw bitstreams in the browser. Supports NAL units, SPS/PPS/VPS parameter sets, I/P/B/IDR frame types, GOPs, and SEI messages.',
      skip: 'Skip to main content',
      'app.title': 'H.264/H.265 Raw Bitstream Analyzer',
      'app.subtitle': 'Annex B byte stream analysis - NAL scanning · parameter set parsing · frame type and GOP detection',
      'nav.tool': 'Parser',
      'nav.docs': 'Docs',
      'nav.h264': 'H.264 Guide',
      'nav.h265': 'H.265 Guide',
      'nav.compare': 'H.264 vs H.265',
      'nav.examples': 'Examples',
      'nav.faq': 'FAQ',
      'nav.about': 'About',
      'nav.privacy': 'Privacy',
      'nav.terms': 'Terms',
      'nav.contact': 'Contact',
      'portal.tools': 'Parser',
      'portal.mainNavAria': 'Primary navigation',
      'portal.tutorials': 'Tutorials',
      'portal.protocol': 'Protocol',
      'sub.parser': 'Online Parser',
      'sub.navAria': 'Secondary navigation',
      'docs.quickStart': 'Quick Start',
      'docs.h264': 'H.264',
      'docs.h265': 'H.265',
      'docs.compare': 'H.264 vs H.265',
      'docs.annex': 'Annex B / MP4',
      'docs.params': 'Parameter Sets',
      'upload.title': 'Upload Bitstream File',
      'upload.dropAria': 'Drop a .h264 or .h265 file here, or click to choose a file',
      'upload.dropText': 'Drop a <strong>.h264</strong> or <strong>.h265</strong> raw stream file here',
      'upload.or': '- or -',
      'upload.choose': 'Choose File',
      'upload.hint': 'Supports Annex B byte streams with start codes 0x000001 / 0x00000001',
      'results.title': 'Parse Results',
      'results.tabsAria': 'Parse result categories',
      'tabs.nal': 'NAL Unit List',
      'tabs.params': 'Parameter Sets',
      'tabs.frames': 'Frame Analysis & GOP',
      'tabs.sei': 'SEI Messages',
      'inspector.aria': 'NAL field parser',
      'inspector.kicker': 'Selected NAL',
      'inspector.emptyTitle': 'No NAL selected',
      'inspector.selectRow': 'Select a NAL row.',
      'inspector.noFields': 'No parsed fields.',
      'inspector.nalTitle': 'NAL #{index}',
      'inspector.typeBadge': 'Type {type}',
      'binary.title': 'Binary',
      'binary.nalTitle': 'Binary · NAL #{index}',
      'binary.noBytesLoaded': 'No bytes loaded.',
      'binary.noBytesAvailable': 'No bytes available.',
      'binary.allBytes': 'Showing all {total} bytes',
      'binary.windowBytes': 'Showing bytes {start}-{end} of {total} (preview window)',
      'table.type': 'Type',
      'table.name': 'Name',
      'table.offset': 'Offset',
      'table.length': 'Length',
      'table.frame': 'Frame',
      'table.startCode': 'Start Code',
      'table.refIdc': 'Ref IDC',
      'table.layerId': 'Layer ID',
      'search.placeholder': 'Search NAL type, name, or I/P/B...',
      'summary.totalNals': 'Total NAL Units',
      'summary.totalFrames': 'Total Frames',
      'summary.iFrames': 'I Frames',
      'summary.idrFrames': 'IDR Frames',
      'summary.pFrames': 'P Frames',
      'summary.bFrames': 'B Frames',
      'summary.gops': 'GOPs (avg {avg})',
      'summary.maxTid': 'Max Temporal ID',
      'summary.codec': 'Codec',
      'tree.nalUnit': 'NAL Unit',
      'tree.header': 'Header',
      'tree.parsedFields': 'Parsed Fields',
      'collection.itemOne': '1 item',
      'collection.itemMany': '{count} items',
      'collection.fieldOne': '1 field',
      'collection.fieldMany': '{count} fields',
      'collection.arrayPreview': '[{count} items]',
      'value.na': 'N/A',
      'coding.codeword': '{coding} codeword {codeword} -> {value} | ',
      'coding.codingOnly': '{coding} | ',
      'range.bitsSingle': 'bits {start}-{end}',
      'range.bitsMulti': 'bits {preview}{suffix}',
      'range.bitsMore': ' +{count}',
      'params.empty': 'No parameter sets found in this bitstream.',
      'frames.total': 'Total',
      'frames.gops': 'GOPs',
      'frames.avgGopSize': 'Avg GOP Size',
      'frames.truncated': 'Showing first 120 of {total} frames',
      'sei.empty': 'No SEI messages found.',
      'sei.type': 'Type {type}',
      'sei.meta': 'NAL #{index} · {bytes} bytes',
      'error.title': 'Parse Error',
      'error.worker': 'Worker error: {message}',
      'error.workerFallback': 'failed to load parser-worker.js',
      'error.workerMessage': 'Worker returned an unreadable message.',
      'error.unsupportedFile': 'Unsupported file type. Please upload a .h264 or .h265 raw Annex B bitstream file.',
      'error.startWorker': 'Failed to start parser worker: {message}',
      'error.readFile': 'Failed to read file.',
      'error.nal': '[NAL #{index}] {type}: {message}',
      'error.containerMp4': 'MP4/MOV container detected. Please extract the raw Annex B bitstream first.',
      'error.containerMkv': 'MKV/WebM container detected. Please extract the raw Annex B bitstream first.',
      'error.noNal': 'No NAL units found. This may not be a valid Annex B bitstream. Check that the file is a raw .h264 or .h265 file, not a container format (MP4/MKV).',
      'error.unknownCodec': 'Could not determine codec (H.264 or H.265). The bitstream may be corrupted or is not a recognized format.',
      'error.fatalParse': 'Fatal parse error: {message}',
      'file.info': 'File: {name} ({size})',
      'unit.bytes': '{count} bytes',
      'resources.title': 'Bitstream Learning and Troubleshooting',
      'resources.h264Title': 'H.264/AVC Basics',
      'resources.h264Body': 'Learn H.264 coding, Annex B raw streams, SPS/PPS, slice headers, and common NAL unit types.',
      'resources.h265Title': 'H.265/HEVC Basics',
      'resources.h265Body': 'Understand VPS/SPS/PPS, Temporal ID, HEVC NAL types, and the main changes from H.264 to H.265.',
      'resources.annexTitle': 'Annex B vs MP4 Containers',
      'resources.annexBody': 'Why this tool parses raw streams, and how to extract .h264 or .h265 data from MP4/MKV files.',
      'resources.paramsTitle': 'Reading Parameter Sets',
      'resources.paramsBody': 'Use real syntax elements to inspect resolution, profile, level, VUI, HRD, and stream compatibility information.',
      'progress.scanning': 'Scanning NAL units...',
      'progress.found': 'Found {count} NAL units, detecting codec...',
      'progress.detected': 'Detected {codec} codec. Parsing headers...',
      'progress.parsingNal': 'Parsing NAL {current}/{total}...',
      'progress.gop': 'Computing GOP statistics...',
      'progress.preparing': 'Preparing results...',
      'progress.complete': 'Parse complete.',
      'tech.title': 'About H.264/H.265 Bitstream Structure',
      'tech.whatH264Title': 'What Is H.264?',
      'tech.whatH264Body': 'H.264, also known as <strong>AVC (Advanced Video Coding)</strong>, is a widely used video compression standard. It reduces video size through intra prediction, inter prediction, transform, quantization, and entropy coding, and is common in MP4 video, streaming, video conferencing, surveillance recordings, and web video. This tool analyzes H.264 <strong>Annex B raw streams</strong> so you can inspect NAL units, SPS/PPS, I/P/B/IDR frames, and binary fields.',
      'tech.whatH265Title': 'What Is H.265?',
      'tech.whatH265Body': 'H.265, also known as <strong>HEVC (High Efficiency Video Coding)</strong>, is the successor to H.264. It uses more flexible coding tree units, prediction, and transform structures, and usually delivers better compression at similar visual quality. It is common in 4K, 8K, and high-bitrate video workflows. This tool parses VPS/SPS/PPS, slice headers, SEI messages, and Temporal ID data from H.265/HEVC Annex B raw streams.',
      'tech.nalTitle': 'NAL Units and Annex B Byte Streams',
      'tech.nalBody': 'H.264 (AVC) and H.265 (HEVC) video streams commonly use the <strong>Annex B byte stream format</strong> for transport and storage. This format separates consecutive NAL (Network Abstraction Layer) units with a <strong>Start Code</strong>. Start codes can be 3-byte <code>0x000001</code> or 4-byte <code>0x00000001</code> sequences, and the analyzer scans them to locate each NAL boundary.',
      'tech.paramTitle': 'Parameter Sets: SPS, PPS, and VPS',
      'tech.paramBody': 'In H.264 streams, <strong>SPS (Sequence Parameter Set)</strong> carries global information such as coded dimensions, profile and level identifiers, and chroma format. H.265/HEVC adds <strong>VPS (Video Parameter Set)</strong> for higher-level properties such as layered or scalable coding. Structures such as <code>profile_tier_level</code> and <code>conformance_window</code> are exposed using their protocol syntax element names.',
      'tech.frameTitle': 'Frame Type Detection and GOP Analysis',
      'tech.frameBody': 'By parsing the <strong>Slice Header</strong> in VCL NAL units, the tool extracts <code>slice_type</code> and identifies <strong>I</strong>, <strong>P</strong>, <strong>B</strong>, and <strong>IDR</strong> frames. Consecutive coded pictures form a <strong>GOP (Group of Pictures)</strong>, whose length and layout affect random access and compression behavior.',
      'tech.seiTitle': 'SEI Messages and Supplemental Information',
      'tech.seiBody': '<strong>SEI (Supplemental Enhancement Information)</strong> messages carry auxiliary data that does not directly affect decoding, such as <code>buffering_period</code>, <code>pic_timing</code>, and <code>user_data_unregistered</code>. These messages are useful for stream analysis, debugging, and conformance checks.',
      'tech.bitstreamTitle': 'Bitstream Reading and Standards',
      'tech.bitstreamBody': 'Raw bitstream parsing depends on <strong>standards-based bit reading</strong>. H.264 syntax follows ITU-T H.264 (08/2024) section 7.3, and H.265 syntax follows ITU-T H.265 (01/2026) section 7.3. The analyzer implements fixed-width fields, Exp-Golomb decoding, and accurate handling for descriptors such as <code>ue(v)</code> and <code>se(v)</code> inside a Web Worker.',
      'footer.security': '<strong>Security:</strong> files are parsed only in your local browser. Bitstream data is not uploaded to any server, and the tool works offline after the page loads.',
      'footer.linksAria': 'Site links',
      'footer.compatibility': 'Supported formats: H.264 Annex B raw streams (.h264) and H.265/HEVC Annex B raw streams (.h265). MP4, MKV, and other container formats are not supported.',
      'footer.tech': 'Implemented with ITU-T H.264 (08/2024) and ITU-T H.265 (01/2026) syntax. Native JavaScript only, no third-party dependencies, with parsing in a Web Worker.'
    }
  };
  let currentLanguage = getInitialLanguage();

  function getInitialLanguage() {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === 'zh' || stored === 'en') return stored;
    } catch (err) {
      // Ignore storage errors in private or restricted browser contexts.
    }
    return DEFAULT_LANGUAGE;
  }

  function t(key, params = {}) {
    const dict = I18N[currentLanguage] || I18N[DEFAULT_LANGUAGE];
    const fallback = I18N[DEFAULT_LANGUAGE][key];
    const template = dict[key] || fallback || key;
    return template.replace(/\{(\w+)\}/g, function (_, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : `{${name}}`;
    });
  }

  function setLanguage(lang) {
    if (!I18N[lang]) return;
    currentLanguage = lang;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch (err) {
      // UI language still switches even if storage is unavailable.
    }
    applyTranslations();
    updateLanguageButtons();
    if (parseResults) {
      const selected = selectedNalIndex;
      renderAll(parseResults, { preserveScroll: true, preserveSelection: selected });
    } else {
      clearNALInspector();
    }
  }

  function applyTranslations() {
    document.documentElement.lang = currentLanguage === 'zh' ? 'zh-CN' : 'en';
    document.title = t('document.title');
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t('document.description'));

    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });
    updateCodecHeader();
  }

  function updateLanguageButtons() {
    languageButtons.forEach(btn => {
      const active = btn.dataset.lang === currentLanguage;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateCodecHeader() {
    if (!nalCodecHeader) return;
    nalCodecHeader.textContent = codec === 'H265' ? t('table.layerId') : t('table.refIdc');
  }

  function translateProgressMessage(message) {
    if (!message) return '';
    let match = String(message).match(/^Found\s+(\d+)\s+NAL units, detecting codec\.\.\.$/);
    if (match) return t('progress.found', { count: match[1] });
    match = String(message).match(/^Detected\s+(H26[45])\s+codec\. Parsing headers\.\.\.$/);
    if (match) return t('progress.detected', { codec: match[1] });
    match = String(message).match(/^Parsing NAL\s+(\d+)\/(\d+)\.\.\.$/);
    if (match) return t('progress.parsingNal', { current: match[1], total: match[2] });
    const exact = {
      'Scanning NAL units...': 'progress.scanning',
      'Computing GOP statistics...': 'progress.gop',
      'Preparing results...': 'progress.preparing',
      'Parse complete.': 'progress.complete'
    };
    return exact[message] ? t(exact[message]) : message;
  }

  function translateWorkerError(message) {
    if (!message) return '';
    const exact = {
      'MP4/MOV container detected — please extract the raw Annex B bitstream first': 'error.containerMp4',
      'MKV/WebM container detected — please extract the raw Annex B bitstream first': 'error.containerMkv',
      'No NAL units found. This may not be a valid Annex B bitstream. Check that the file is a raw .h264 or .h265 file, not a container format (MP4/MKV).': 'error.noNal',
      'Could not determine codec (H.264 or H.265). The bitstream may be corrupted or is not a recognized format.': 'error.unknownCodec'
    };
    if (exact[message]) return t(exact[message]);
    const fatal = String(message).match(/^Fatal parse error:\s*(.+)$/);
    if (fatal) return t('error.fatalParse', { message: fatal[1] });
    return message;
  }

  // === Worker ===
  let worker = null;
  let parseResults = null;
  let codec = null;
  let selectedNalIndex = null;
  let activeFieldPath = null;

  languageButtons.forEach(btn => {
    btn.addEventListener('click', function () {
      setLanguage(this.dataset.lang);
    });
  });
  applyTranslations();
  updateLanguageButtons();
  clearNALInspector();

  function ensureWorker() {
    if (!worker) {
      worker = new Worker('assets/parser-worker.js?v=20260526-1');
      worker.onmessage = handleWorkerMessage;
      worker.onerror = function (event) {
        showProgress(false);
        showError(t('error.worker', { message: event.message || t('error.workerFallback') }));
      };
      worker.onmessageerror = function () {
        showProgress(false);
        showError(t('error.workerMessage'));
      };
    }
    return worker;
  }

  // === File Handling ===
  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });

  function isFileInputActivator(target) {
    return Boolean(target && target.closest && target.closest('label[for="file-input"], #file-input'));
  }

  function openFilePicker() {
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.addEventListener('click', function () {
    fileInput.value = '';
  });

  dropZone.addEventListener('click', function (e) {
    if (isFileInputActivator(e.target)) return;
    openFilePicker();
  });

  dropZone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFilePicker();
    }
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
    }
  });

  function handleFile(file) {
    const name = file.name.toLowerCase();
    const validExts = ['.h264', '.h265', '.264', '.265', '.hevc', '.bin'];
    const isValid = validExts.some(ext => name.endsWith(ext));

    if (!isValid) {
      showError(t('error.unsupportedFile'));
      return;
    }

    fileInfo.textContent = t('file.info', { name: file.name, size: formatFileSize(file.size) });
    resetUI();
    showProgress(true);

    const reader = new FileReader();
    reader.onload = function () {
      try {
        const w = ensureWorker();
        w.postMessage({ type: 'parse', buffer: reader.result }, [reader.result]);
      } catch (err) {
        showProgress(false);
        showError(t('error.startWorker', { message: err.message }));
      }
    };
    reader.onerror = function () {
      showError(t('error.readFile'));
    };
    reader.readAsArrayBuffer(file);
  }

  // === Worker Message Handler ===
  function handleWorkerMessage(e) {
    const { type } = e.data;

    switch (type) {
      case 'progress':
        updateProgress(e.data.progress, e.data.message);
        break;
      case 'error':
        showError(translateWorkerError(e.data.message));
        showProgress(false);
        break;
      case 'result':
        parseResults = e.data;
        codec = e.data.codec;
        showProgress(false);
        renderAll(e.data);
        break;
    }
  }

  // === Progress ===
  function updateProgress(pct, msg) {
    progressFill.style.width = pct + '%';
    const localized = translateProgressMessage(msg);
    progressText.textContent = localized ? `${localized} (${pct}%)` : `${pct}%`;
  }

  function showProgress(visible) {
    progressBar.hidden = !visible;
    if (!visible) {
      progressFill.style.width = '0%';
      progressText.textContent = '';
    }
  }

  // === Render All Results ===
  function renderAll(data, options = {}) {
    renderSummary(data.summary);
    renderNALTable(data.nals, data.codec);
    renderParams(data.paramSets, data.codec);
    renderFrames(data.frames, data.gop, data.summary);
    renderSEI(data.sei);
    renderErrors(data.errors);

    resultsSection.hidden = false;
    if (data.errors.length === 0) {
      errorSection.hidden = true;
    }

    // Enable tabs that have content
    const tabContent = {
      nal: data.nals.length > 0,
      params: (data.paramSets.SPS && data.paramSets.SPS.length > 0) ||
              (data.paramSets.PPS && data.paramSets.PPS.length > 0) ||
              (data.paramSets.VPS && data.paramSets.VPS.length > 0),
      frames: data.frames.length > 0,
      sei: data.sei.length > 0
    };
    tabBtns.forEach(btn => {
      const tab = btn.dataset.tab;
      btn.disabled = !tabContent[tab];
    });

    if (data.nals.length > 0) {
      const targetNal = options.preserveSelection != null ? options.preserveSelection : data.nals[0].index;
      selectNAL(targetNal);
    } else {
      clearNALInspector();
    }

    // Scroll to results
    if (!options.preserveScroll) {
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // === Summary Stats ===
  function renderSummary(summary) {
    summaryStats.innerHTML = `
      <div class="stat-card stat-total">
        <div class="stat-value">${summary.totalNALs}</div>
        <div class="stat-label">${t('summary.totalNals')}</div>
      </div>
      <div class="stat-card stat-total">
        <div class="stat-value">${summary.totalFrames}</div>
        <div class="stat-label">${t('summary.totalFrames')}</div>
      </div>
      <div class="stat-card stat-i">
        <div class="stat-value">${summary.iFrames}</div>
        <div class="stat-label">${t('summary.iFrames')}</div>
      </div>
      <div class="stat-card stat-idr">
        <div class="stat-value">${summary.idrFrames || 0}</div>
        <div class="stat-label">${t('summary.idrFrames')}</div>
      </div>
      <div class="stat-card stat-p">
        <div class="stat-value">${summary.pFrames}</div>
        <div class="stat-label">${t('summary.pFrames')}</div>
      </div>
      <div class="stat-card stat-b">
        <div class="stat-value">${summary.bFrames}</div>
        <div class="stat-label">${t('summary.bFrames')}</div>
      </div>
      <div class="stat-card stat-gop">
        <div class="stat-value">${summary.gopCount}</div>
        <div class="stat-label">${t('summary.gops', { avg: summary.avgGopSize })}</div>
      </div>
      <div class="stat-card stat-total">
        <div class="stat-value">${summary.maxTemporalId}</div>
        <div class="stat-label">${t('summary.maxTid')}</div>
      </div>
      <div class="stat-card stat-total">
        <div class="stat-value">${summary.codec}</div>
        <div class="stat-label">${t('summary.codec')}</div>
      </div>
    `;
  }

  // === NAL Table ===
  function renderNALTable(nals, codec) {
    const isH265 = codec === 'H265';

    updateCodecHeader();

    let html = '';
    for (const nal of nals) {
      const isVCL = nal.is_vcl;
      const isSEI = nal.nal_unit_type === 6 || nal.nal_unit_type === 39 || nal.nal_unit_type === 40;
      const rowClass = isVCL ? 'nal-vcl' : (isSEI ? 'nal-sei' : 'nal-non-vcl');
      const startCodeType = nal.startCodeLen === 4 ? '0x00000001' : '0x000001';
      const frameType = getNALFrameType(nal);
      const frameClass = frameType === 'IDR' ? 'frame-idr' : (frameType === 'I' ? 'frame-i' : (frameType === 'P' ? 'frame-p' : (frameType === 'B' ? 'frame-b' : 'frame-none')));
      const frameSearchType = frameType === 'IDR' || frameType === 'I' || frameType === 'P' || frameType === 'B' ? frameType.toLowerCase() : '';
      const searchText = buildNALSearchText(nal, frameType, startCodeType);
      const displayName = getNALDisplayName(nal);

      const selectedClass = nal.index === selectedNalIndex ? ' selected' : '';

      html += `<tr class="nal-row${selectedClass}" data-nal-index="${nal.index}" data-frame-type="${frameSearchType}" data-search-text="${escapeHtml(searchText)}" tabindex="0">
        <td>${nal.index + 1}</td>
        <td class="nal-type-num">${nal.nal_unit_type}</td>
        <td class="${rowClass}" title="${escapeHtml(nal.type_name)}">${escapeHtml(displayName)}</td>
        <td class="offset-col">0x${nal.offset.toString(16).toUpperCase().padStart(8, '0')}</td>
        <td class="offset-col">${nal.length.toLocaleString()}</td>
        <td><span class="frame-pill ${frameClass}">${escapeHtml(frameType)}</span></td>
        <td class="offset-col">${startCodeType}</td>
        <td class="codec-col">${isH265 ? (nal.layer_id != null ? nal.layer_id : '-') : (nal.nal_ref_idc != null ? nal.nal_ref_idc : '-')}</td>
        <td class="tid-col">${nal.temporal_id != null ? nal.temporal_id : '-'}</td>
      </tr>`;
    }
    nalTbody.innerHTML = html;
  }

  function getNALDisplayName(nal) {
    if (!nal) return '-';
    if (codec === 'H265') return nal.type_name || '-';
    const h264Names = {
      1: 'Non-IDR slice',
      2: 'Slice data A',
      3: 'Slice data B',
      4: 'Slice data C',
      5: 'IDR slice',
      6: 'SEI',
      7: 'SPS',
      8: 'PPS',
      9: 'AUD',
      10: 'EOS',
      11: 'EOB',
      12: 'Filler',
      13: 'SPS ext',
      14: 'Prefix',
      15: 'Subset SPS',
      16: 'DPS',
      18: 'Aux slice',
      19: 'Ext slice',
      20: 'Depth slice',
      21: 'Depth slice'
    };
    return h264Names[nal.nal_unit_type] || nal.type_name || '-';
  }

  function buildNALSearchText(nal, frameType, startCodeType) {
    const parts = [
      String(nal.index + 1),
      String(nal.nal_unit_type),
      getNALDisplayName(nal),
      nal.type_name,
      `0x${nal.offset.toString(16).toUpperCase().padStart(8, '0')}`,
      String(nal.length),
      startCodeType,
      String(nal.temporal_id ?? '')
    ];

    if (frameType === 'IDR' || frameType === 'I' || frameType === 'P' || frameType === 'B') {
      parts.push(
        frameType,
        `frame ${frameType.toLowerCase()}`,
        `${frameType.toLowerCase()} frame`,
        `slice ${frameType.toLowerCase()}`
      );
    }

    if (nal.nal_ref_idc != null) parts.push(String(nal.nal_ref_idc));
    if (nal.layer_id != null) parts.push(String(nal.layer_id));
    return normalizeSearchText(parts.filter(Boolean).join(' '));
  }

  function getNALFrameType(nal) {
    if (!nal || !nal.is_vcl || !nal.parseResult) return '-';
    if (isIDRFrame(nal)) return 'IDR';
    const type = nal.parseResult.slice_type_name || nal.parseResult.slice_type;
    if (typeof type === 'string') {
      const normalized = type.toUpperCase();
      if (normalized.startsWith('I')) return 'I';
      if (normalized.startsWith('P')) return 'P';
      if (normalized.startsWith('B')) return 'B';
    }
    if (typeof type === 'number') {
      const normalized = type % 5;
      if (normalized === 2) return 'I';
      if (normalized === 0) return 'P';
      if (normalized === 1) return 'B';
    }
    return '?';
  }

  function isIDRFrame(nal) {
    if (!nal) return false;
    if (nal.parseResult && nal.parseResult.is_idr) return true;
    if (nal.nal_unit_type === 5) return true;
    return nal.type_name === 'IDR_W_RADL' || nal.type_name === 'IDR_N_LP';
  }

  // NAL filter
  nalFilter.addEventListener('input', function () {
    const query = normalizeSearchText(this.value);
    const frameTypeQuery = getFrameTypeSearchQuery(query);
    const rows = document.querySelectorAll('#nal-tbody tr');
    rows.forEach(row => {
      if (!query) {
        row.style.display = '';
        return;
      }
      if (frameTypeQuery) {
        row.style.display = row.dataset.frameType === frameTypeQuery ? '' : 'none';
        return;
      }
      const text = normalizeSearchText(`${row.textContent} ${row.dataset.searchText || ''}`);
      row.style.display = text.includes(query) ? '' : 'none';
    });
  });

  function normalizeSearchText(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function getFrameTypeSearchQuery(query) {
    const normalized = normalizeSearchText(query).replace(/[-_:]+/g, ' ');
    if (/^(i|p|b|idr)$/.test(normalized)) return normalized;
    const match = normalized.match(/^(frame|slice|type)\s+(i|p|b|idr)$/);
    return match ? match[2] : '';
  }

  nalTbody.addEventListener('click', function (event) {
    const row = event.target.closest('tr[data-nal-index]');
    if (!row) return;
    selectNAL(Number(row.dataset.nalIndex));
  });

  nalTbody.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('tr[data-nal-index]');
    if (!row) return;
    event.preventDefault();
    selectNAL(Number(row.dataset.nalIndex));
  });

  nalFieldList.addEventListener('click', function (event) {
    const field = event.target.closest('[data-field-path]');
    if (!field) return;
    activeFieldPath = field.dataset.fieldPath;
    const nal = getSelectedNAL();
    if (!nal) return;
    const range = getClickedFieldRange(field, nal, activeFieldPath);
    updateActiveFieldRow();
    renderBinaryView(nal, range);
  });

  function selectNAL(index) {
    if (!parseResults || !parseResults.nals) return;
    const nal = parseResults.nals.find(item => item.index === index);
    if (!nal) return;
    selectedNalIndex = index;
    activeFieldPath = null;
    updateNalSelectionRows();
    renderNALInspector(nal);
    revealNALInspector();
  }

  function getSelectedNAL() {
    if (!parseResults || selectedNalIndex == null) return null;
    return parseResults.nals.find(item => item.index === selectedNalIndex) || null;
  }

  function updateNalSelectionRows() {
    nalTbody.querySelectorAll('tr[data-nal-index]').forEach(row => {
      const isSelected = Number(row.dataset.nalIndex) === selectedNalIndex;
      row.classList.toggle('selected', isSelected);
      row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
  }

  function clearNALInspector() {
    selectedNalIndex = null;
    activeFieldPath = null;
    nalDetailTitle.textContent = t('inspector.emptyTitle');
    nalDetailBadge.textContent = '-';
    nalFieldList.innerHTML = `<div class="empty-state">${t('inspector.selectRow')}</div>`;
    nalBinaryTitle.textContent = t('binary.title');
    nalBinaryRange.textContent = '';
    nalBinaryView.innerHTML = `<div class="empty-state">${t('binary.noBytesLoaded')}</div>`;
  }

  const FLAG_GROUP_RULES = [
    {
      parentPath: 'parseResult',
      flag: 'vui_parameters_present_flag',
      children: ['vui']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'aspect_ratio_info_present_flag',
      children: ['aspect_ratio_idc', 'sar_width', 'sar_height']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'overscan_info_present_flag',
      children: ['overscan_appropriate_flag']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'colour_description_present_flag',
      children: ['colour_primaries', 'transfer_characteristics', 'matrix_coefficients', 'matrix_coeffs']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'video_signal_type_present_flag',
      children: ['video_format', 'video_full_range_flag', 'colour_description_present_flag']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'chroma_loc_info_present_flag',
      children: ['chroma_sample_loc_type_top_field', 'chroma_sample_loc_type_bottom_field']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'timing_info_present_flag',
      children: ['num_units_in_tick', 'time_scale', 'fixed_frame_rate_flag']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'vui_timing_info_present_flag',
      children: ['vui_num_units_in_tick', 'vui_time_scale', 'vui_poc_proportional_to_timing_flag', 'vui_hrd_parameters_present_flag']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'vui_poc_proportional_to_timing_flag',
      children: ['vui_num_ticks_poc_diff_one_minus1']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'vui_hrd_parameters_present_flag',
      children: ['hrd_parameters']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'nal_hrd_parameters_present_flag',
      children: ['nal_hrd_parameters']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'vcl_hrd_parameters_present_flag',
      children: ['vcl_hrd_parameters']
    },
    {
      parentPath: 'parseResult.vui',
      flag: 'bitstream_restriction_flag',
      children: [
        'tiles_fixed_structure_flag',
        'motion_vectors_over_pic_boundaries_flag',
        'restricted_ref_pic_lists_flag',
        'min_spatial_segmentation_idc',
        'max_bytes_per_pic_denom',
        'max_bits_per_mb_denom',
        'max_bits_per_min_cu_denom',
        'log2_max_mv_length_horizontal',
        'log2_max_mv_length_vertical',
        'max_num_reorder_frames',
        'max_dec_frame_buffering'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'seq_scaling_matrix_present_flag',
      children: ['seq_scaling_list_present_flag', 'seq_scaling_list']
    },
    {
      parentPath: 'parseResult',
      flag: 'scaling_list_enabled_flag',
      children: ['sps_scaling_list_data_present_flag']
    },
    {
      parentPath: 'parseResult',
      flag: 'sps_scaling_list_data_present_flag',
      children: ['scaling_list_data']
    },
    {
      parentPath: 'parseResult',
      flag: 'pcm_enabled_flag',
      children: [
        'pcm_sample_bit_depth_luma_minus1',
        'pcm_sample_bit_depth_chroma_minus1',
        'log2_min_pcm_luma_coding_block_size_minus3',
        'log2_diff_max_min_pcm_luma_coding_block_size',
        'pcm_loop_filter_disabled_flag'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'long_term_ref_pics_present_flag',
      children: ['num_long_term_ref_pics_sps', 'lt_ref_pic_poc_lsb_sps', 'used_by_curr_pic_lt_sps_flag']
    },
    {
      parentPath: 'parseResult',
      flag: 'sps_extension_present_flag',
      children: [
        'sps_range_extension_flag',
        'sps_multilayer_extension_flag',
        'sps_3d_extension_flag',
        'sps_scc_extension_flag',
        'sps_extension_4bits',
        'sps_extension_data_flag'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'sps_range_extension_flag',
      children: [
        'transform_skip_rotation_enabled_flag',
        'transform_skip_context_enabled_flag',
        'implicit_rdpcm_enabled_flag',
        'explicit_rdpcm_enabled_flag',
        'extended_precision_processing_flag',
        'intra_smoothing_disabled_flag',
        'high_precision_offsets_enabled_flag',
        'persistent_rice_adaptation_enabled_flag',
        'cabac_bypass_alignment_enabled_flag'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'sps_scc_extension_flag',
      children: ['sps_scc_extension']
    },
    {
      parentPath: 'parseResult',
      flag: 'frame_cropping_flag',
      children: [
        'frame_crop_left_offset',
        'frame_crop_right_offset',
        'frame_crop_top_offset',
        'frame_crop_bottom_offset'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'pic_scaling_matrix_present_flag',
      children: ['pic_scaling_list_present_flag', 'pic_scaling_list']
    },
    {
      parentPath: 'parseResult',
      flag: 'tiles_enabled_flag',
      children: [
        'num_tile_columns_minus1',
        'num_tile_rows_minus1',
        'uniform_spacing_flag',
        'column_width_minus1',
        'row_height_minus1',
        'loop_filter_across_tiles_enabled_flag'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'cu_qp_delta_enabled_flag',
      children: ['diff_cu_qp_delta_depth']
    },
    {
      parentPath: 'parseResult',
      flag: 'deblocking_filter_control_present_flag',
      children: [
        'deblocking_filter_override_enabled_flag',
        'pps_deblocking_filter_disabled_flag',
        'pps_beta_offset_div2',
        'pps_tc_offset_div2'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'pps_scaling_list_data_present_flag',
      children: ['pps_scaling_list_data']
    },
    {
      parentPath: 'parseResult',
      flag: 'pps_extension_present_flag',
      children: [
        'pps_range_extension_flag',
        'pps_multilayer_extension_flag',
        'pps_3d_extension_flag',
        'pps_scc_extension_flag',
        'pps_extension_4bits',
        'pps_extension_data_flag'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'pps_range_extension_flag',
      children: [
        'log2_max_transform_skip_block_size_minus2',
        'cross_component_prediction_enabled_flag',
        'chroma_qp_offset_list_enabled_flag',
        'diff_cu_chroma_qp_offset_depth',
        'chroma_qp_offset_list_len_minus1',
        'cb_qp_offset_list',
        'cr_qp_offset_list',
        'log2_sao_offset_scale_luma',
        'log2_sao_offset_scale_chroma'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'pps_scc_extension_flag',
      children: ['pps_scc_extension']
    },
    {
      parentPath: 'parseResult',
      flag: 'num_ref_idx_active_override_flag',
      children: ['num_ref_idx_l0_active_minus1', 'num_ref_idx_l1_active_minus1']
    },
    {
      parentPath: 'parseResult',
      flag: 'short_term_ref_pic_set_sps_flag',
      children: ['short_term_ref_pic_set_idx', 'short_term_ref_pic_set']
    },
    {
      parentPath: 'parseResult',
      flag: 'slice_temporal_mvp_enabled_flag',
      children: ['collocated_from_l0_flag', 'collocated_ref_idx']
    },
    {
      parentPath: 'parseResult',
      flag: 'slice_segment_header_extension_present_flag',
      children: ['slice_segment_header_extension_length', 'slice_segment_header_extension_data_byte']
    },
    {
      parentPath: 'parseResult',
      flag: 'vps_timing_info_present_flag',
      children: [
        'vps_num_units_in_tick',
        'vps_time_scale',
        'vps_poc_proportional_to_timing_flag',
        'vps_num_hrd_parameters',
        'hrd_layer_set_idx',
        'cprms_present_flag',
        'hrd_parameters'
      ]
    },
    {
      parentPath: 'parseResult',
      flag: 'vps_poc_proportional_to_timing_flag',
      children: ['vps_num_ticks_poc_diff_one_minus1']
    },
    {
      parentPath: 'parseResult',
      flag: 'vps_extension_flag',
      children: ['vps_extension_data_flag']
    },
    {
      parentPath: 'parseResult',
      flag: 'disable_deblocking_filter_idc',
      children: ['slice_alpha_c0_offset_div2', 'slice_beta_offset_div2']
    },
    {
      parentPath: 'parseResult.ref_pic_list_modification',
      flag: 'ref_pic_list_modification_flag_l0',
      children: ['modifications_l0']
    },
    {
      parentPath: 'parseResult.ref_pic_list_modification',
      flag: 'ref_pic_list_modification_flag_l1',
      children: ['modifications_l1']
    },
    {
      parentPath: 'parseResult.dec_ref_pic_marking',
      flag: 'adaptive_ref_pic_marking_mode_flag',
      children: ['memory_management_control_operations']
    }
  ];

  const LOCAL_FLAG_GROUP_RULES = [
    { flag: 'luma_weight_l0_flag', children: ['luma_weight_l0', 'luma_offset_l0', 'delta_luma_weight_l0'] },
    { flag: 'luma_weight_l1_flag', children: ['luma_weight_l1', 'luma_offset_l1', 'delta_luma_weight_l1'] },
    { flag: 'chroma_weight_l0_flag', children: ['chroma_weight_l0', 'chroma_offset_l0', 'delta_chroma_weight_l0', 'delta_chroma_offset_l0'] },
    { flag: 'chroma_weight_l1_flag', children: ['chroma_weight_l1', 'chroma_offset_l1', 'delta_chroma_weight_l1', 'delta_chroma_offset_l1'] }
  ];

  const SYNTHETIC_GROUP_RULES = [
    {
      parentPath: 'parseResult',
      groupName: 'pps_extension',
      label: 'PPS Extension',
      children: [
        'transform_8x8_mode_flag',
        'pic_scaling_matrix_present_flag',
        'second_chroma_qp_index_offset'
      ]
    }
  ];

  function renderNALInspector(nal) {
    nalDetailTitle.textContent = t('inspector.nalTitle', { index: nal.index + 1 });
    nalDetailBadge.textContent = t('inspector.typeBadge', { type: nal.nal_unit_type });

    const fieldTree = buildNALFieldTree(nal);
    if (fieldTree.length === 0) {
      nalFieldList.innerHTML = `<div class="empty-state">${t('inspector.noFields')}</div>`;
    } else {
      nalFieldList.innerHTML = renderFieldTree(fieldTree);
    }

    renderBinaryView(nal, null);
  }

  function buildNALFieldTree(nal) {
    const fieldRanges = buildFieldRangeMap(nal);
    const roots = [];
    const rootMap = new Map();

    const metadata = {
      index: nal.index + 1,
      type: nal.nal_unit_type,
      name: nal.type_name,
      offset: formatHexOffset(nal.offset),
      length: t('unit.bytes', { count: nal.length.toLocaleString() }),
      start_code_length: t('unit.bytes', { count: nal.startCodeLen }),
      trailing_zero_length: t('unit.bytes', { count: nal.trailingZeroLen || 0 }),
      payload_offset: nal.payloadOffset == null ? null : formatHexOffset(nal.payloadOffset),
      payload_length: nal.payloadLength == null ? null : t('unit.bytes', { count: nal.payloadLength.toLocaleString() }),
      frame_type: getNALFrameType(nal),
      temporal_id: nal.temporal_id
    };
    if (codec === 'H265') {
      metadata.layer_id = nal.layer_id;
    } else {
      metadata.ref_idc = nal.nal_ref_idc;
    }
    mergeObjectIntoTree(addRootNode(roots, rootMap, 'nal', t('tree.nalUnit')), metadata, 'nal', fieldRanges);

    if (nal.header && typeof nal.header === 'object') {
      mergeObjectIntoTree(addRootNode(roots, rootMap, 'header', t('tree.header')), nal.header, 'header', fieldRanges);
    }

    if (nal.parseResult && typeof nal.parseResult === 'object') {
      mergeObjectIntoTree(addRootNode(roots, rootMap, 'parseResult', t('tree.parsedFields')), nal.parseResult, 'parseResult', fieldRanges);
    }

    mergeFieldMapIntoTree(roots, rootMap, nal);
    groupConditionalFieldNodes(roots);
    assignAggregateFieldRanges(roots);
    return roots.filter(node => node.children.length > 0 || node.value != null);
  }

  function buildFieldRangeMap(nal) {
    const ranges = new Map();
    if (!Array.isArray(nal.fieldMap)) return ranges;
    for (const field of nal.fieldMap) {
      ranges.set(field.path, field);
    }
    return ranges;
  }

  function createFieldTreeNode(label, path, value = null, range = null) {
    return {
      label,
      path,
      value,
      range,
      children: [],
      childMap: new Map()
    };
  }

  function addRootNode(roots, rootMap, path, label) {
    if (rootMap.has(path)) return rootMap.get(path);
    const node = createFieldTreeNode(label, path);
    rootMap.set(path, node);
    roots.push(node);
    return node;
  }

  function ensureChildNode(parent, label, path) {
    if (parent.childMap.has(path)) {
      const existing = parent.childMap.get(path);
      if (!existing.label) existing.label = label;
      return existing;
    }
    const node = createFieldTreeNode(label, path);
    parent.childMap.set(path, node);
    parent.children.push(node);
    return node;
  }

  function mergeObjectIntoTree(parent, value, path, fieldRanges) {
    const range = fieldRanges.get(path);
    if (range) parent.range = range;

    if (Array.isArray(value)) {
      parent.value = describeCollection(value);
      value.forEach((item, index) => {
        mergeValueIntoTree(parent, `[${index}]`, `${path}[${index}]`, item, fieldRanges);
      });
      return;
    }

    if (value && typeof value === 'object') {
      parent.value = describeCollection(value);
      for (const [key, childValue] of Object.entries(value)) {
        mergeValueIntoTree(parent, key, `${path}.${key}`, childValue, fieldRanges);
      }
      return;
    }

    parent.value = value == null ? t('value.na') : value;
  }

  function mergeValueIntoTree(parent, label, path, value, fieldRanges) {
    const child = ensureChildNode(parent, label, path);
    const range = fieldRanges.get(path);
    if (range) child.range = range;
    mergeObjectIntoTree(child, value, path, fieldRanges);
  }

  function mergeFieldMapIntoTree(roots, rootMap, nal) {
    if (!Array.isArray(nal.fieldMap)) return;
    for (const field of nal.fieldMap) {
      const segments = parseFieldPath(field.path);
      if (segments.length === 0 || segments[0].type !== 'key') continue;

      let currentPath = segments[0].key;
      let current = addRootNode(roots, rootMap, currentPath, rootLabel(currentPath));
      for (let i = 1; i < segments.length; i++) {
        const segment = segments[i];
        currentPath = appendPathSegment(currentPath, segment);
        current = ensureChildNode(current, segmentLabel(segment), currentPath);
        if (i === segments.length - 1) {
          current.range = field;
          if (current.value == null || current.value === 'N/A') {
            current.value = getPathValue(nal, field.path, field.value);
          }
        } else if (current.value == null) {
          current.value = '';
        }
      }
    }
  }

  function groupConditionalFieldNodes(roots) {
    const nodeByPath = new Map();
    indexFieldTreeNodes(roots, nodeByPath);

    for (const rule of FLAG_GROUP_RULES) {
      const parent = nodeByPath.get(rule.parentPath);
      if (parent) {
        moveNamedChildrenUnderFlag(parent, rule.flag, rule.children);
      }
    }

    groupLocalFlagNodes(roots);
    groupSyntheticFieldNodes(roots);
  }

  function assignAggregateFieldRanges(nodes) {
    for (const node of nodes) {
      assignAggregateFieldRange(node);
    }
  }

  function assignAggregateFieldRange(node) {
    const childSegments = [];
    for (const child of node.children) {
      const childRange = assignAggregateFieldRange(child);
      if (childRange) childSegments.push(...getRangeSegments(childRange));
    }

    if (node.range) return node.range;
    if (childSegments.length === 0) return null;

    const segments = normalizeRangeSegments(childSegments);
    node.range = {
      path: node.path,
      label: node.label,
      value: node.value,
      coding: null,
      startBit: segments[0].startBit,
      endBit: segments[segments.length - 1].endBit,
      segments,
      aggregate: true
    };
    return node.range;
  }

  function getRangeSegments(range) {
    if (!range) return [];
    if (Array.isArray(range.segments) && range.segments.length > 0) {
      return range.segments
        .filter(segment => Number.isFinite(segment.startBit) && Number.isFinite(segment.endBit) && segment.endBit > segment.startBit)
        .map(segment => ({ startBit: segment.startBit, endBit: segment.endBit }));
    }
    if (Number.isFinite(range.startBit) && Number.isFinite(range.endBit) && range.endBit > range.startBit) {
      return [{ startBit: range.startBit, endBit: range.endBit }];
    }
    return [];
  }

  function normalizeRangeSegments(segments) {
    const sorted = segments
      .filter(segment => Number.isFinite(segment.startBit) && Number.isFinite(segment.endBit) && segment.endBit > segment.startBit)
      .sort((a, b) => a.startBit - b.startBit || a.endBit - b.endBit);
    const merged = [];
    for (const segment of sorted) {
      const last = merged[merged.length - 1];
      if (last && segment.startBit <= last.endBit) {
        last.endBit = Math.max(last.endBit, segment.endBit);
      } else {
        merged.push({ startBit: segment.startBit, endBit: segment.endBit });
      }
    }
    return merged;
  }

  function indexFieldTreeNodes(nodes, nodeByPath) {
    for (const node of nodes) {
      nodeByPath.set(node.path, node);
      indexFieldTreeNodes(node.children, nodeByPath);
    }
  }

  function groupLocalFlagNodes(nodes) {
    for (const node of nodes) {
      for (const rule of LOCAL_FLAG_GROUP_RULES) {
        moveNamedChildrenUnderFlag(node, rule.flag, rule.children);
      }
      groupLocalFlagNodes(node.children);
    }
  }

  function groupSyntheticFieldNodes(roots) {
    const nodeByPath = new Map();
    indexFieldTreeNodes(roots, nodeByPath);
    for (const rule of SYNTHETIC_GROUP_RULES) {
      const parent = nodeByPath.get(rule.parentPath);
      if (parent) {
        moveNamedChildrenIntoGroup(parent, rule.groupName, rule.label, rule.children);
      }
    }
  }

  function moveNamedChildrenUnderFlag(parent, flagName, childNames) {
    const flagPath = buildChildPath(parent.path, flagName);
    const flagNode = parent.childMap.get(flagPath);
    if (!flagNode) return;

    let moved = false;
    for (const childName of childNames) {
      const childPath = buildChildPath(parent.path, childName);
      const child = parent.childMap.get(childPath);
      if (!child || child === flagNode || flagNode.childMap.has(child.path)) continue;

      parent.childMap.delete(childPath);
      parent.children = parent.children.filter(item => item !== child);
      flagNode.childMap.set(child.path, child);
      flagNode.children.push(child);
      moved = true;
    }

    if (moved) {
      flagNode.isConditionGroup = true;
    }
  }

  function moveNamedChildrenIntoGroup(parent, groupName, groupLabel, childNames) {
    const groupPath = buildChildPath(parent.path, groupName);
    let groupNode = parent.childMap.get(groupPath);
    let created = false;
    if (!groupNode) {
      groupNode = createFieldTreeNode(groupLabel, groupPath);
      parent.childMap.set(groupPath, groupNode);
      parent.children.push(groupNode);
      created = true;
    }

    let moved = false;
    for (const childName of childNames) {
      const childPath = buildChildPath(parent.path, childName);
      const child = parent.childMap.get(childPath);
      if (!child || child === groupNode || groupNode.childMap.has(child.path)) continue;

      parent.childMap.delete(childPath);
      parent.children = parent.children.filter(item => item !== child);
      groupNode.childMap.set(child.path, child);
      groupNode.children.push(child);
      moved = true;
    }

    if (moved) {
      groupNode.value = describeCollection(groupNode.children);
    } else if (created) {
      parent.childMap.delete(groupPath);
      parent.children = parent.children.filter(item => item !== groupNode);
    }
  }

  function buildChildPath(parentPath, childName) {
    return `${parentPath}.${childName}`;
  }

  function renderFieldTree(nodes) {
    return `<div class="field-tree">${nodes.map(node => renderFieldTreeNode(node, 0)).join('')}</div>`;
  }

  function renderFieldTreeNode(node, depth) {
    const hasChildren = node.children.length > 0;
    if (!hasChildren) {
      return renderFieldLeaf(node);
    }

    const value = node.value == null ? '' : formatDisplayValue(node.value);
    const range = node.range;
    const activeClass = node.path === activeFieldPath ? ' active' : '';
    const rangeClass = range ? ' has-range' : '';
    const interactionClass = range ? ' field-clickable' : ' field-static';
    const rangeAttrs = range ? renderFieldRangeAttrs(node.path, range) : '';
    const conditionClass = node.isConditionGroup ? ' condition-field-node' : '';
    return `<details class="field-tree-node${conditionClass}" open>
      <summary class="field-tree-toggle${rangeClass}${activeClass}${interactionClass}"${rangeAttrs}>
        <span class="field-name">${escapeHtml(node.label)}</span>
        <span class="field-node-value">${escapeHtml(value)}</span>
        <span class="field-count">${node.children.length}</span>
      </summary>
      <div class="field-tree-children">
        ${node.children.map(child => renderFieldTreeNode(child, depth + 1)).join('')}
      </div>
    </details>`;
  }

  function renderFieldLeaf(node) {
    const range = node.range;
    const rangeText = range ? formatRangeText(range) : '';
    const codingText = range ? formatCodingText(range, node.value) : '';
    const activeClass = node.path === activeFieldPath ? ' active' : '';
    const rangeClass = range ? ' has-range' : '';
    const interactionClass = range ? ' field-clickable' : ' field-static';
    const tag = range ? 'button' : 'div';
    const typeAttr = range ? ' type="button"' : '';
    const rangeAttrs = range ? renderFieldRangeAttrs(node.path, range) : '';
    return `<${tag}${typeAttr} class="field-row${rangeClass}${activeClass}${interactionClass}"${rangeAttrs}>
      <span class="field-name">${escapeHtml(node.label)}</span>
      <span class="field-value">${escapeHtml(formatDisplayValue(node.value))}</span>
      <span class="field-bits">${escapeHtml(codingText + rangeText)}</span>
    </${tag}>`;
  }

  function formatCodingText(range, value) {
    if (!range.coding) return '';
    if ((range.coding === 'ue(v)' || range.coding === 'se(v)') && range.codeword) {
      return t('coding.codeword', { coding: range.coding, codeword: range.codeword, value: formatDisplayValue(value) });
    }
    return t('coding.codingOnly', { coding: range.coding });
  }

  function renderFieldRangeAttrs(path, range) {
    const segments = getRangeSegments(range);
    const encodedSegments = encodeURIComponent(JSON.stringify(segments));
    return ` data-field-path="${escapeHtml(path)}" data-field-start-bit="${range.startBit}" data-field-end-bit="${range.endBit}" data-field-segments="${encodedSegments}"`;
  }

  function formatRangeText(range) {
    const segments = getRangeSegments(range);
    if (segments.length === 0) return '';
    if (segments.length === 1) {
      return t('range.bitsSingle', { start: segments[0].startBit, end: segments[0].endBit - 1 });
    }
    const preview = segments.slice(0, 2).map(segment => `${segment.startBit}-${segment.endBit - 1}`).join(', ');
    const suffix = segments.length > 2 ? t('range.bitsMore', { count: segments.length - 2 }) : '';
    return t('range.bitsMulti', { preview, suffix });
  }

  function describeCollection(value) {
    if (Array.isArray(value)) {
      return value.length === 1 ? t('collection.itemOne') : t('collection.itemMany', { count: value.length });
    }
    const count = Object.keys(value || {}).length;
    return count === 1 ? t('collection.fieldOne') : t('collection.fieldMany', { count });
  }

  function rootLabel(path) {
    if (path === 'header') return t('tree.header');
    if (path === 'parseResult') return t('tree.parsedFields');
    if (path === 'nal') return t('tree.nalUnit');
    return path;
  }

  function segmentLabel(segment) {
    return segment.type === 'index' ? `[${segment.index}]` : segment.key;
  }

  function appendPathSegment(path, segment) {
    if (segment.type === 'index') return `${path}[${segment.index}]`;
    return `${path}.${segment.key}`;
  }

  function formatHexOffset(value) {
    return `0x${Number(value || 0).toString(16).toUpperCase().padStart(8, '0')}`;
  }

  function getPathValue(root, path, fallback) {
    const parts = parseFieldPath(path);
    let current = root;
    for (const part of parts) {
      if (part.type === 'index') {
        if (!Array.isArray(current) || part.index >= current.length) {
          return fallback;
        }
        current = current[part.index];
        continue;
      }
      if (current == null || typeof current !== 'object' || !(part.key in current)) {
        return fallback;
      }
      current = current[part.key];
    }
    return current == null ? fallback : current;
  }

  function parseFieldPath(path) {
    const segments = [];
    const matcher = /([^[.\]]+)|\[(\d+)\]/g;
    let match;
    while ((match = matcher.exec(path)) !== null) {
      if (match[1] != null) {
        segments.push({ type: 'key', key: match[1] });
      } else {
        segments.push({ type: 'index', index: Number(match[2]) });
      }
    }
    return segments;
  }

  function revealNALInspector() {
    if (window.matchMedia && window.matchMedia('(min-width: 981px)').matches) return;
    const inspector = document.querySelector('.nal-inspector');
    if (!inspector || typeof inspector.getBoundingClientRect !== 'function') return;
    const rect = inspector.getBoundingClientRect();
    const hiddenAbove = rect.top < 0;
    const hiddenBelow = rect.top > window.innerHeight || rect.bottom > window.innerHeight + 80;
    if (hiddenAbove || hiddenBelow) {
      inspector.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function getFieldRange(nal, path) {
    if (!nal.fieldMap) return null;
    return nal.fieldMap.find(field => field.path === path) || null;
  }

  function getClickedFieldRange(field, nal, path) {
    const mappedRange = getFieldRange(nal, path);
    if (mappedRange) return mappedRange;
    const segments = parseRangeSegments(field.dataset.fieldSegments);
    const startBit = Number(field.dataset.fieldStartBit);
    const endBit = Number(field.dataset.fieldEndBit);
    if (segments.length > 0) {
      return {
        path,
        startBit: segments[0].startBit,
        endBit: segments[segments.length - 1].endBit,
        segments
      };
    }
    if (Number.isFinite(startBit) && Number.isFinite(endBit) && endBit > startBit) {
      return { path, startBit, endBit, segments: [{ startBit, endBit }] };
    }
    return null;
  }

  function parseRangeSegments(encoded) {
    if (!encoded) return [];
    try {
      const parsed = JSON.parse(decodeURIComponent(encoded));
      return normalizeRangeSegments(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      return [];
    }
  }

  function updateActiveFieldRow() {
    nalFieldList.querySelectorAll('[data-field-path]').forEach(row => {
      row.classList.toggle('active', row.dataset.fieldPath === activeFieldPath);
    });
  }

  function renderBinaryView(nal, range) {
    const bytes = nal.bytes || [];
    nalBinaryTitle.textContent = t('binary.nalTitle', { index: nal.index + 1 });
    if (bytes.length === 0) {
      nalBinaryRange.textContent = '';
      nalBinaryView.innerHTML = `<div class="empty-state">${t('binary.noBytesAvailable')}</div>`;
      return;
    }

    const win = getBinaryWindow(bytes.length, range);
    nalBinaryRange.textContent = range
      ? formatRangeText(range)
      : t('unit.bytes', { count: bytes.length.toLocaleString() });

    let html = '';
    html += `<div class="binary-note">${formatBinaryWindowNote(win, bytes.length)}</div>`;
    html += '<div class="binary-grid">';
    for (let i = win.start; i < win.end; i++) {
      const byte = bytes[i];
      const byteStart = i * 8;
      const byteEnd = byteStart + 8;
      const byteActive = range && isRangeByteActive(range, byteStart, byteEnd);
      let bits = '';
      for (let bit = 0; bit < 8; bit++) {
        const absoluteBit = byteStart + bit;
        const bitActive = range && isRangeBitActive(range, absoluteBit);
        bits += `<span class="binary-bit${bitActive ? ' active' : ''}">${(byte >> (7 - bit)) & 1}</span>`;
      }
      html += `<div class="binary-byte${byteActive ? ' active' : ''}">
        <span class="binary-offset">${i.toString(16).toUpperCase().padStart(4, '0')}</span>
        <span class="binary-hex">${byte.toString(16).toUpperCase().padStart(2, '0')}</span>
        <span class="binary-bits">${bits}</span>
      </div>`;
    }
    html += '</div>';
    nalBinaryView.innerHTML = html;
  }

  function isRangeBitActive(range, bit) {
    return getRangeSegments(range).some(segment => bit >= segment.startBit && bit < segment.endBit);
  }

  function isRangeByteActive(range, byteStart, byteEnd) {
    return getRangeSegments(range).some(segment => segment.startBit < byteEnd && segment.endBit > byteStart);
  }

  function formatBinaryWindowNote(win, totalBytes) {
    const shownStart = win.start.toLocaleString();
    const shownEnd = (win.end - 1).toLocaleString();
    const total = totalBytes.toLocaleString();
    if (win.start === 0 && win.end === totalBytes) {
      return t('binary.allBytes', { total });
    }
    return t('binary.windowBytes', { start: shownStart, end: shownEnd, total });
  }

  function getBinaryWindow(totalBytes, range) {
    const maxBytes = 192;
    if (!range) {
      return { start: 0, end: Math.min(totalBytes, maxBytes) };
    }
    const segments = getRangeSegments(range);
    const firstBit = segments.length > 0 ? segments[0].startBit : range.startBit;
    const rangeStartByte = Math.floor(firstBit / 8);
    const start = Math.max(0, rangeStartByte - 24);
    return { start, end: Math.min(totalBytes, start + maxBytes) };
  }

  function formatDisplayValue(value) {
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      if (value.length <= 6) return JSON.stringify(value);
      return t('collection.arrayPreview', { count: value.length });
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return Number.isInteger(value) ? value.toString() : value.toFixed(4);
    return String(value);
  }

  // === Parameter Sets ===
  function renderParams(paramSets, codec) {
    const container = document.getElementById('params-content');
    let html = '';

    if (paramSets.VPS && paramSets.VPS.length > 0) {
      for (const vps of paramSets.VPS) {
        html += renderCard('VPS', 'vps', formatParamObject(vps));
      }
    }
    if (paramSets.SPS && paramSets.SPS.length > 0) {
      for (const sps of paramSets.SPS) {
        html += renderCard('SPS', 'sps', formatParamObject(sps));
      }
    }
    if (paramSets.PPS && paramSets.PPS.length > 0) {
      for (const pps of paramSets.PPS) {
        html += renderCard('PPS', 'pps', formatParamObject(pps));
      }
    }

    if (!html) {
      html = `<p style="color: var(--text-muted); padding: 16px;">${t('params.empty')}</p>`;
    }

    container.innerHTML = html;
  }

  function renderCard(title, badgeClass, items) {
    let rows = '';
    for (const item of items) {
      if (item.full) {
        rows += `<div class="param-full" style="color: var(--text-secondary); font-size:0.82rem;">${escapeHtml(String(item.value))}</div>`;
      } else {
        rows += `
          <div class="param-key">${escapeHtml(item.key)}</div>
          <div class="param-val">${escapeHtml(String(item.value))}</div>
        `;
      }
    }
    return `
      <div class="param-card">
        <div class="param-card-header">
          <span class="badge badge-${badgeClass}">${badgeClass.toUpperCase()}</span>
          ${escapeHtml(title)}
        </div>
        <div class="param-card-body">${rows}</div>
      </div>
    `;
  }

  function formatParamObject(obj, prefix = '') {
    const items = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value === null || value === undefined) {
        items.push({ key: fullKey, value: t('value.na') });
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        items.push(...formatParamObject(value, fullKey));
      } else if (Array.isArray(value) && value.length > 20) {
        items.push({ key: fullKey, value: t('collection.arrayPreview', { count: value.length }) });
      } else if (Array.isArray(value)) {
        items.push({ key: fullKey, value: JSON.stringify(value) });
      } else if (typeof value === 'boolean') {
        items.push({ key: fullKey, value: value ? 'true' : 'false' });
      } else if (typeof value === 'number') {
        items.push({ key: fullKey, value: Number.isInteger(value) ? value.toString() : value.toFixed(4) });
      } else {
        items.push({ key: fullKey, value: String(value) });
      }
    }
    return items;
  }

  // === Frames & GOP ===
  function renderFrames(frames, gopInfo, summary) {
    // Stats
    const statsDiv = document.getElementById('frames-stats');
    statsDiv.innerHTML = `
      <div class="frame-stat"><div class="fs-val" style="color:var(--green)">${summary.iFrames}</div><div class="fs-label">${t('summary.iFrames')}</div></div>
      <div class="frame-stat"><div class="fs-val" style="color:var(--cyan)">${summary.idrFrames || 0}</div><div class="fs-label">${t('summary.idrFrames')}</div></div>
      <div class="frame-stat"><div class="fs-val" style="color:var(--orange)">${summary.pFrames}</div><div class="fs-label">${t('summary.pFrames')}</div></div>
      <div class="frame-stat"><div class="fs-val" style="color:var(--purple)">${summary.bFrames}</div><div class="fs-label">${t('summary.bFrames')}</div></div>
      <div class="frame-stat"><div class="fs-val">${summary.totalFrames}</div><div class="fs-label">${t('frames.total')}</div></div>
      <div class="frame-stat"><div class="fs-val">${gopInfo.totalGOPs}</div><div class="fs-label">${t('frames.gops')}</div></div>
      <div class="frame-stat"><div class="fs-val">${summary.avgGopSize}</div><div class="fs-label">${t('frames.avgGopSize')}</div></div>
    `;

    // GOP bar chart (show first 120 frames)
    const displayFrames = frames.slice(0, 120);
    let chartHtml = '<div class="gop-chart">';
    for (const f of displayFrames) {
      const cls = f.slice_type === 'IDR' ? 'idr' : (f.slice_type === 'I' ? 'i' : (f.slice_type === 'P' ? 'p' : 'b'));
      const h = f.slice_type === 'IDR' ? 100 : (f.slice_type === 'I' ? 85 : (f.slice_type === 'P' ? 60 : 35));
      chartHtml += `<div class="gop-bar ${cls}" style="height:${h}%" title="#${f.nalIndex}: ${f.slice_type}"></div>`;
    }
    chartHtml += '</div>';
    if (frames.length > 120) {
      chartHtml += `<p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:16px;">${t('frames.truncated', { total: frames.length })}</p>`;
    }
    statsDiv.insertAdjacentHTML('beforeend', chartHtml);

    // Frames table
    const tbody = document.getElementById('frames-tbody');
    let html = '';
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const cls = f.slice_type === 'IDR' ? 'slice-idr' : (f.slice_type === 'I' ? 'slice-i' : (f.slice_type === 'P' ? 'slice-p' : 'slice-b'));
      html += `<tr>
        <td>${i + 1}</td>
        <td>${f.nalIndex + 1}</td>
        <td class="${cls}">${f.slice_type || '?'}</td>
        <td class="offset-col">${f.poc != null ? f.poc : '-'}</td>
        <td class="offset-col">${f.frame_num != null ? f.frame_num : '-'}</td>
        <td class="tid-col">${f.temporal_id != null ? f.temporal_id : '-'}</td>
        <td>${f.gop_index != null ? f.gop_index : '-'}</td>
      </tr>`;
    }
    tbody.innerHTML = html;
  }

  // === SEI ===
  function renderSEI(seiMessages) {
    const container = document.getElementById('sei-content');
    if (seiMessages.length === 0) {
      container.innerHTML = `<p style="color: var(--text-muted); padding: 16px;">${t('sei.empty')}</p>`;
      return;
    }

    let html = '';
    for (const sei of seiMessages) {
      html += `<div class="sei-item">
        <div class="sei-item-header">
          <span class="badge" style="background:var(--cyan);color:#000;font-size:0.78rem;padding:2px 8px;border-radius:10px;">SEI</span>
          <span class="sei-type">${escapeHtml(sei.name || t('sei.type', { type: sei.payloadType }))}</span>
          <span style="color:var(--text-muted);font-size:0.82rem;">${escapeHtml(t('sei.meta', { index: sei.nalIndex + 1, bytes: sei.payloadSize }))}</span>
        </div>
        <div class="sei-item-body">${escapeHtml(JSON.stringify(sei, null, 2))}</div>
      </div>`;
    }
    container.innerHTML = html;
  }

  // === Errors ===
  function renderErrors(errors) {
    if (errors.length === 0) {
      errorSection.hidden = true;
      return;
    }
    errorSection.hidden = false;
    const lines = errors.map(e => t('error.nal', { index: e.nalIndex + 1, type: e.type, message: e.error }));
    errorContent.textContent = lines.join('\n');
  }

  function showError(msg) {
    errorSection.hidden = false;
    errorContent.textContent = msg;
    resultsSection.hidden = true;
  }

  // === Tab Switching ===
  tabBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      if (this.disabled) return;
      const targetTab = this.dataset.tab;

      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      this.classList.add('active');
      this.setAttribute('aria-selected', 'true');

      tabPanels.forEach(panel => {
        panel.classList.remove('active');
        if (panel.id === `panel-${targetTab}`) {
          panel.classList.add('active');
        }
      });
    });
  });

  // === Helpers ===
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function resetUI() {
    resultsSection.hidden = true;
    errorSection.hidden = true;
    summaryStats.innerHTML = '';
    nalTbody.innerHTML = '';
    document.getElementById('params-content').innerHTML = '';
    document.getElementById('frames-tbody').innerHTML = '';
    document.getElementById('sei-content').innerHTML = '';
    parseResults = null;
    clearNALInspector();
  }

})();
