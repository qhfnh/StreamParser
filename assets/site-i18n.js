/**
 * Static content localization for documentation pages.
 *
 * The parser page keeps its interactive labels in main.js. This file is only
 * loaded by static content pages so they can share the same language setting.
 */
(function () {
  'use strict';

  const LANGUAGE_STORAGE_KEY = 'bitstream-parser-language';
  const DEFAULT_LANGUAGE = 'zh';
  const SCRIPT_VERSION = '20260526-1';

  const COMMON_EN = {
    mainNavAria: 'Primary navigation',
    subNavAria: 'Secondary navigation',
    siteLinksAria: 'Site links',
    openTool: 'Open Parser',
    footerSecurity: '<strong>Security:</strong> The parser runs locally in your browser and does not upload bitstream files.',
    links: {
      'index.html': 'Parser',
      'h264-guide.html': 'Tutorials',
      'examples.html': 'Examples',
      'sps-pps-vps-explained.html': 'Protocol',
      'faq.html': 'FAQ',
      'about.html': 'About',
      'privacy.html': 'Privacy Policy',
      'terms.html': 'Terms of Use',
      'contact.html': 'Contact',
      'h265-guide.html': 'H.265 Guide',
      'h264-vs-h265.html': 'H.264 vs H.265',
      'annex-b-vs-mp4.html': 'Annex B / MP4'
    },
    subLinks: {
      'h264-guide.html': 'H.264 Basics',
      'h265-guide.html': 'H.265 Basics',
      'h264-vs-h265.html': 'H.264 vs H.265',
      'examples.html': 'Parsing Examples',
      'sps-pps-vps-explained.html': 'Parameter Sets',
      'annex-b-vs-mp4.html': 'Annex B / MP4',
      'faq.html': 'FAQ',
      'about.html': 'About Project',
      'privacy.html': 'Privacy Policy',
      'terms.html': 'Terms of Use',
      'contact.html': 'Contact'
    }
  };

  const PAGES = {
    'h264-guide': {
      title: 'What Is H.264? AVC Bitstreams, NAL Units, SPS/PPS, and Frame Types',
      description: 'A practical H.264/AVC guide for video developers and bitstream debugging, covering Annex B streams, NAL units, SPS/PPS, I/P/B/IDR frames, and parsing workflows.',
      header: `
        <div class="header-inner">
          <h1>H.264/AVC Basics</h1>
          <p class="subtitle">Understand H.264 raw bitstreams, NAL units, SPS/PPS, and frame types</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">H.264 / AVC</span>
          <h1>What is H.264?</h1>
          <p class="lede">H.264, also known as AVC (Advanced Video Coding), is one of the most widely used video compression standards. It appears in MP4 files, live streaming, video conferencing, surveillance recordings, and web video. Understanding the H.264 bitstream structure helps developers diagnose corruption, decoder failures, unexpected frame types, and incorrect resolution detection.</p>
        </section>

        <div class="article-layout">
          <article class="article-main">
            <h2 id="compression">How H.264 compresses video</h2>
            <p>H.264 is not a file format; it is a video coding standard. It compresses image sequences with intra prediction, inter prediction, integer transforms, quantization, in-loop filtering, and entropy coding. Containers such as MP4 or MKV package audio and video tracks, while the H.264 bitstream itself describes how video pictures are encoded.</p>

            <h2 id="annex-b">What is an Annex B raw stream?</h2>
            <p>Annex B is a common H.264 byte stream format. It separates NAL units with <code>0x000001</code> or <code>0x00000001</code> start codes. Many cameras, encoders, transport protocols, and debugging samples output Annex B. This site's parser reads Annex B raw streams directly, not MP4 or MKV containers.</p>

            <h2 id="nal">NAL units</h2>
            <p>NAL (Network Abstraction Layer) units are the basic packaging units in an H.264 bitstream. Common NAL types include SPS, PPS, SEI, IDR slice, non-IDR slice, AUD, EOS, EOB, and filler data. The NAL list quickly shows whether a file has parameter sets, whether it includes key frames, and where each NAL begins and ends in the file.</p>

            <h2 id="sps-pps">SPS and PPS</h2>
            <p>SPS (Sequence Parameter Set) stores sequence-level parameters such as profile, level, coded size, cropping, chroma format, VUI, and HRD. PPS (Picture Parameter Set) stores picture-level coding configuration such as entropy mode, reference index defaults, quantization parameter offsets, and deblocking control. Missing SPS/PPS data is a common reason a player or decoder cannot initialize.</p>

            <h2 id="frames">I/P/B/IDR frames</h2>
            <p>The H.264 slice header contains <code>slice_type</code>. I frames primarily use intra prediction, P frames reference previous pictures, and B frames can use bidirectional references. IDR frames are special key frames that normally act as random access points; after an IDR, the decoder can discard earlier reference relationships. During bitstream debugging, regular I frames and IDR frames should be inspected separately.</p>

            <div class="callout">After uploading a <code>.h264</code> or Annex B <code>.bin</code> file, this tool shows type, offset, length, Frame, start code, and Ref IDC in the NAL list. In Selected NAL, click a field to highlight the corresponding binary bits.</div>

            <h2 id="next">Next steps</h2>
            <p>If your input comes from MP4, extract a raw stream with FFmpeg first. To compare old and new coding standards, continue with the H.265 guide and the H.264 vs H.265 comparison.</p>

            <nav class="page-footer-nav" aria-label="Related pages">
              <a href="../index.html">Open Parser</a>
              <a href="h265-guide.html">Read the H.265 Guide</a>
              <a href="annex-b-vs-mp4.html">Annex B vs MP4</a>
              <a href="sps-pps-vps-explained.html">Parameter Set Fields</a>
            </nav>
          </article>

          <aside class="article-toc" aria-label="Table of contents">
            <strong>Contents</strong>
            <a href="#compression">Compression</a>
            <a href="#annex-b">Annex B</a>
            <a href="#nal">NAL units</a>
            <a href="#sps-pps">SPS/PPS</a>
            <a href="#frames">Frame types</a>
          </aside>
        </div>
      `
    },
    'h265-guide': {
      title: 'What Is H.265? HEVC Bitstreams, VPS/SPS/PPS, and Temporal ID Basics',
      description: 'A practical H.265/HEVC guide for video developers and bitstream debugging, covering HEVC NAL units, VPS/SPS/PPS, slice headers, SEI, and Temporal ID.',
      header: `
        <div class="header-inner">
          <h1>H.265/HEVC Basics</h1>
          <p class="subtitle">Understand HEVC NAL units, VPS/SPS/PPS, slice headers, and Temporal ID</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">H.265 / HEVC</span>
          <h1>What is H.265?</h1>
          <p class="lede">H.265, also known as HEVC (High Efficiency Video Coding), is the video compression standard that followed H.264. It usually provides higher compression efficiency at similar subjective quality and is common in 4K, 8K, HDR, surveillance, and high-bitrate video workflows.</p>
        </section>

        <div class="article-layout">
          <article class="article-main">
            <h2 id="why">Why H.265 exists</h2>
            <p>H.264 was very successful in the HD era, but higher resolutions and more complex video content require better compression efficiency. H.265 introduced coding tree units (CTUs), more flexible block partitioning, stronger prediction modes, and more advanced transform and filtering tools to reduce bitrate or improve quality.</p>

            <h2 id="nal">HEVC NAL units</h2>
            <p>H.265 still organizes bitstreams with NAL units, but the header structure differs from H.264. An HEVC NAL header contains <code>nal_unit_type</code>, <code>nuh_layer_id</code>, and <code>nuh_temporal_id_plus1</code>. For H.265 analysis, Temporal ID and Layer ID are important debugging fields.</p>

            <h2 id="vps">VPS/SPS/PPS</h2>
            <p>H.265 adds VPS (Video Parameter Set) in addition to SPS and PPS. VPS describes video-parameter-set-level information, SPS describes sequence properties, and PPS describes picture-level coding configuration. In practice, complete VPS/SPS/PPS data, correct <code>profile_tier_level</code>, and VUI/HRD presence all affect decoder compatibility and timestamp handling.</p>

            <h2 id="slice">Slice headers and frame types</h2>
            <p>H.265 VCL NAL types distinguish TRAIL, TSA, STSA, RADL, RASL, IDR, CRA, BLA, and other access-point semantics. Actual I/P/B classification still requires reading <code>slice_type</code> from the slice header. Therefore SEI, VPS, or IDR_N_LP is not the same thing as an ordinary P frame or B frame.</p>

            <h2 id="temporal">Temporal ID</h2>
            <p>Temporal ID identifies temporal layers. Lower layers often form the base layer, while higher layers may depend on lower layers. When analyzing layered coding, low-latency settings, or frame-dropping strategies, Temporal ID helps identify which NAL units are critical for baseline playback.</p>

            <div class="callout">This tool displays H.265 NAL type, Layer ID, TID, start code, offset, and length. Selected NAL uses a tree view for VPS/SPS/PPS, slice header, and SEI fields.</div>

            <nav class="page-footer-nav" aria-label="Related pages">
              <a href="../index.html">Open Parser</a>
              <a href="h264-vs-h265.html">Compare H.264 and H.265</a>
              <a href="sps-pps-vps-explained.html">VPS/SPS/PPS Notes</a>
              <a href="examples.html">View Examples</a>
            </nav>
          </article>

          <aside class="article-toc" aria-label="Table of contents">
            <strong>Contents</strong>
            <a href="#why">Why H.265</a>
            <a href="#nal">HEVC NAL</a>
            <a href="#vps">VPS/SPS/PPS</a>
            <a href="#slice">Slice Header</a>
            <a href="#temporal">Temporal ID</a>
          </aside>
        </div>
      `
    },
    'h264-vs-h265': {
      title: 'H.264 vs H.265: Compression Efficiency, Bitstream Structure, and Compatibility',
      description: 'Compare H.264/AVC and H.265/HEVC by compression efficiency, bitstream structure, parameter sets, NAL types, compatibility, and debugging workflows.',
      header: `
        <div class="header-inner">
          <h1>H.264 vs H.265</h1>
          <p class="subtitle">Compare AVC and HEVC by compression efficiency, bitstream structure, compatibility, and parsing rules</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">Codec Comparison</span>
          <h1>What is the difference between H.264 and H.265?</h1>
          <p class="lede">H.264 is more mature and broadly compatible; H.265 offers higher compression efficiency but has higher encoding complexity and stricter device compatibility requirements. For bitstream parsing, their NAL headers, parameter sets, and slice syntax differ significantly.</p>
        </section>

        <article class="article-main">
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>H.264 / AVC</th>
                <th>H.265 / HEVC</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Positioning</td>
                <td>HD and general-purpose video coding with strong compatibility.</td>
                <td>Higher compression efficiency, often used for 4K/8K/HDR.</td>
              </tr>
              <tr>
                <td>Parameter sets</td>
                <td>SPS and PPS.</td>
                <td>VPS, SPS, and PPS.</td>
              </tr>
              <tr>
                <td>NAL header</td>
                <td>Contains forbidden_zero_bit, nal_ref_idc, and nal_unit_type.</td>
                <td>Contains forbidden_zero_bit, nal_unit_type, nuh_layer_id, and nuh_temporal_id_plus1.</td>
              </tr>
              <tr>
                <td>Frame type detection</td>
                <td>Mainly combines VCL NAL type and slice_type.</td>
                <td>Combines HEVC VCL NAL type, IRAP type, and slice_type.</td>
              </tr>
              <tr>
                <td>Compatibility</td>
                <td>More common support across browsers, players, and hardware decoders.</td>
                <td>Good support on newer devices; older devices or browsers may be limited.</td>
              </tr>
            </tbody>
          </table>

          <h2>Compression efficiency is not the only metric</h2>
          <p>H.265 can usually reduce bitrate at similar quality, but the result depends on the encoder, preset, rate control, content complexity, and playback device. For real-time systems, encoding latency, hardware encoder availability, and decoder power consumption are just as important.</p>

          <h2>Why parsing rules cannot be mixed</h2>
          <p>H.264 and H.265 use different NAL header widths, parameter set structures, and slice header condition branches. If H.265 is read with H.264 logic, fields become misaligned; the reverse is also true. A parser must detect the codec first, then read fields according to the matching specification.</p>

          <h2>Selection guidance</h2>
          <ul>
            <li>Choose H.264 when you need maximum compatibility, web playback, or older device support.</li>
            <li>Consider H.265 when bitrate, 4K/8K delivery, or storage cost is the main concern.</li>
            <li>For bitstream debugging, first confirm whether the file is an H.264 or H.265 Annex B raw stream, then inspect parameter sets and frame types.</li>
          </ul>

          <nav class="page-footer-nav" aria-label="Related pages">
            <a href="../index.html">Open Parser</a>
            <a href="annex-b-vs-mp4.html">Annex B vs MP4</a>
            <a href="sps-pps-vps-explained.html">Parameter Sets</a>
          </nav>
        </article>
      `
    },
    'annex-b-vs-mp4': {
      title: 'Annex B Raw Streams vs MP4/MKV Containers: Extract H.264/H.265 Streams',
      description: 'Explains Annex B raw streams, MP4/MKV containers, start codes, length prefixes, and FFmpeg commands for extracting H.264/H.265 raw bitstreams.',
      header: `
        <div class="header-inner">
          <h1>Annex B and MP4 Containers</h1>
          <p class="subtitle">Why the parser needs .h264/.h265 raw streams instead of direct MP4 uploads</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">Annex B</span>
          <h1>What is the difference between Annex B raw streams and MP4/MKV?</h1>
          <p class="lede">Annex B is a byte stream format for encoded video bitstreams. MP4 and MKV are container formats. A container can package video, audio, subtitles, timestamps, and metadata, while this tool parses extracted H.264/H.265 raw bitstreams.</p>
        </section>

        <article class="article-main">
          <h2>Start codes and length prefixes</h2>
          <p>Annex B separates NAL units with <code>0x000001</code> or <code>0x00000001</code> start codes. MP4 usually stores NAL units differently, using length prefixes and placing SPS/PPS/VPS information in container metadata or sample descriptions. Scanning MP4 as Annex B usually cannot find correct NAL boundaries.</p>

          <h2 id="ffmpeg">Extract H.264 with FFmpeg</h2>
          <p>If the video track in an MP4 file is H.264, use a bitstream filter to convert it to Annex B:</p>
          <pre><code>ffmpeg -i input.mp4 -c:v copy -bsf:v h264_mp4toannexb -an output.h264</code></pre>

          <h2>Extract H.265 with FFmpeg</h2>
          <p>If the video track in an MP4 file is H.265/HEVC, use:</p>
          <pre><code>ffmpeg -i input.mp4 -c:v copy -bsf:v hevc_mp4toannexb -an output.h265</code></pre>

          <h2>When conversion is not needed</h2>
          <p>Cameras, encoder SDKs, transport streams, or debugging tools sometimes output Annex B raw streams directly. These files often use <code>.h264</code>, <code>.h265</code>, <code>.264</code>, <code>.265</code>, or <code>.bin</code> extensions and can be uploaded directly.</p>

          <div class="callout">If the page reports an MP4/MKV container, the input file has not been extracted to a raw stream yet. Convert it with FFmpeg first, then upload the output <code>.h264</code> or <code>.h265</code> file.</div>

          <nav class="page-footer-nav" aria-label="Related pages">
            <a href="../index.html">Open Parser</a>
            <a href="h264-guide.html">H.264 Guide</a>
            <a href="h265-guide.html">H.265 Guide</a>
          </nav>
        </article>
      `
    },
    'sps-pps-vps-explained': {
      title: 'What Are SPS, PPS, and VPS? H.264/H.265 Parameter Set Fields',
      description: 'Explains H.264 SPS/PPS and H.265 VPS/SPS/PPS, common fields, resolution, profile, level, VUI, HRD, and bitstream compatibility details.',
      header: `
        <div class="header-inner">
          <h1>SPS/PPS/VPS Parameter Sets</h1>
          <p class="subtitle">Understand resolution, profile, level, VUI, and compatibility from parameter set fields</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">Parameter Sets</span>
          <h1>What are SPS, PPS, and VPS?</h1>
          <p class="lede">Parameter sets are the foundation a decoder uses to understand a bitstream. To decode video correctly, a player usually needs sequence, picture, or video-level parameters first. Missing parameter sets, mismatched parameter sets, or incorrect field reads can cause decode failures, wrong resolution, or incorrect frame classification.</p>
        </section>

        <article class="article-main">
          <h2>SPS and PPS in H.264</h2>
          <p>H.264 SPS stores sequence-level configuration such as <code>profile_idc</code>, <code>level_idc</code>, <code>pic_width_in_mbs_minus1</code>, <code>pic_height_in_map_units_minus1</code>, cropping window, VUI, and HRD. PPS stores picture-level configuration such as entropy coding mode, default reference indexes, initial QP, deblocking, and slice group information.</p>

          <h2>VPS, SPS, and PPS in H.265</h2>
          <p>H.265 adds VPS for video-parameter-set-level information. SPS continues to describe sequence properties such as <code>chroma_format_idc</code>, <code>pic_width_in_luma_samples</code>, <code>profile_tier_level</code>, and VUI. PPS describes picture-level coding configuration such as tiles, SAO, QP offsets, deblocking, and extension fields.</p>

          <h2>Common fields to inspect</h2>
          <ul>
            <li><code>profile_idc</code> / <code>profile_tier_level</code>: codec capability level and device compatibility.</li>
            <li><code>level_idc</code>: resolution, bitrate, and decoder capability constraints.</li>
            <li><code>frame_cropping_flag</code> / <code>conformance_window_flag</code>: whether display resolution must be cropped from coded resolution.</li>
            <li><code>vui_parameters_present_flag</code>: whether aspect ratio, timing, HRD, and other auxiliary information is present.</li>
            <li><code>bitstream_restriction_flag</code>: affects reordered frame count, buffering limits, and low-latency interpretation.</li>
          </ul>

          <h2>Why fields must be parsed in specification order</h2>
          <p>Many SPS/PPS/VPS fields appear only when earlier flags enable them. If a flag is 0, a following group of fields does not exist. If the parser skips a condition or reads fields out of order, every later bit shifts, causing incorrect values, mismatched binary highlighting, or wrong frame statistics.</p>

          <nav class="page-footer-nav" aria-label="Related pages">
            <a href="../index.html">Open Parser</a>
            <a href="h264-guide.html">H.264 Guide</a>
            <a href="h265-guide.html">H.265 Guide</a>
            <a href="examples.html">Parsing Examples</a>
          </nav>
        </article>
      `
    },
    examples: {
      title: 'H.264/H.265 Bitstream Parsing Examples: NAL List, Parameter Sets, Frames, and Binary Highlighting',
      description: 'Shows what to inspect when parsing H.264/H.265 Annex B raw bitstreams, including NAL units, SPS/PPS/VPS, I/P/B/IDR frames, GOPs, and binary field highlighting.',
      header: `
        <div class="header-inner">
          <h1>Bitstream Parsing Examples</h1>
          <p class="subtitle">Use real debugging workflows to understand NAL units, parameter sets, frame types, and binary fields</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">Examples</span>
          <h1>What should you inspect when parsing a raw bitstream?</h1>
          <p class="lede">After uploading an H.264/H.265 Annex B file, inspect results in this order: whether the file is recognized, whether parameter sets are complete, whether frame types are reasonable, and whether binary field highlighting aligns. This workflow is more reliable than checking a single field value.</p>
        </section>

        <article class="article-main">
          <h2>Step 1: Check the NAL unit list</h2>
          <p>The NAL list shows each NAL type, name, offset, length, Frame, start code, Ref IDC or Layer ID, and Temporal ID. A normal stream often begins with parameter sets such as H.264 SPS/PPS or H.265 VPS/SPS/PPS, followed by VCL slices.</p>

          <h2>Step 2: Inspect parameter set details</h2>
          <p>Parameter set details are useful for checking profile, level, resolution, cropping window, VUI timing, HRD, and bitstream restriction fields. If the displayed resolution is unexpected, inspect crop or conformance window fields first.</p>

          <h2 id="frames">Step 3: Inspect frame analysis and GOP</h2>
          <p>Frame analysis reports I/P/B/IDR and GOP information. If Total Frames differs from another tool, confirm the counting rule: this tool counts VCL picture or slice information and does not count non-VCL NAL units such as SEI, SPS, PPS, or VPS as frames.</p>

          <h2>Step 4: Click fields for binary highlighting</h2>
          <p>In Selected NAL, click a field tree node to highlight the corresponding bits. For <code>ue(v)</code> and <code>se(v)</code>, the highlighted bits are the Exp-Golomb codeword, not an ordinary binary integer. In H.265, emulation prevention bytes can make a field highlight span non-contiguous bit ranges.</p>

          <div class="resource-grid">
            <a class="content-card" href="h264-guide.html">
              <span class="content-kicker">H.264</span>
              <h3>Read H.264 field notes</h3>
              <p>Understand SPS/PPS, IDR, non-IDR slices, and Ref IDC.</p>
            </a>
            <a class="content-card" href="h265-guide.html">
              <span class="content-kicker">H.265</span>
              <h3>Read H.265 field notes</h3>
              <p>Understand VPS/SPS/PPS, IRAP, Layer ID, and Temporal ID.</p>
            </a>
          </div>

          <nav class="page-footer-nav" aria-label="Related pages">
            <a href="../index.html">Open Parser</a>
            <a href="annex-b-vs-mp4.html">Prepare Raw Streams</a>
            <a href="faq.html">Read FAQ</a>
          </nav>
        </article>
      `
    },
    faq: {
      title: 'H.264/H.265 Bitstream Parsing FAQ: File Format, Frame Counting, SPS/PPS/VPS, and Highlighting',
      description: 'Common questions for H.264/H.265 Annex B bitstream parsing, including MP4 uploads, Total Frames counting, SPS/PPS/VPS, SEI, and binary highlighting.',
      header: `
        <div class="header-inner">
          <h1>Bitstream Parsing FAQ</h1>
          <p class="subtitle">Common questions about file formats, frame counting, parameter sets, and binary highlighting</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">FAQ</span>
          <h1>Frequently Asked Questions</h1>
          <p class="lede">These questions focus on input file formats, frame counting rules, specification field parsing, and binary highlighting.</p>
        </section>

        <article class="article-main">
          <h2>Why can't I upload MP4 or MKV directly?</h2>
          <p>MP4/MKV are container formats, not H.264/H.265 Annex B raw streams. NAL units inside a container usually use length prefixes, and parameter sets may live in container metadata. Extract a <code>.h264</code> or <code>.h265</code> file with FFmpeg first.</p>

          <h2>Why does Total Frames differ from other software?</h2>
          <p>Different tools may count packets, access units, slices, or decoded output frames. This tool is designed for bitstream-structure debugging and counts VCL picture or slice information; it does not count non-VCL NAL units such as SEI, SPS, PPS, or VPS as video frames.</p>

          <h2>Why is SEI not an I/P/B frame?</h2>
          <p>SEI carries supplemental enhancement information such as timing, user data, and buffering period payloads. It is not VCL picture data. I/P/B/IDR classification must come from VCL NAL units and slice headers.</p>

          <h2 id="exp-golomb">Why does Exp-Golomb highlighting not look like the displayed value?</h2>
          <p><code>ue(v)</code> and <code>se(v)</code> use Exp-Golomb coding. The highlight shows the encoded codeword bits, while the displayed value is the decoded semantic value. Do not read it as a normal binary integer.</p>

          <h2>Does this tool upload files?</h2>
          <p>No. Parsing runs in a browser Web Worker, and files are read only inside your local browser. A static deployment does not require a backend service.</p>

          <nav class="page-footer-nav" aria-label="Related pages">
            <a href="../index.html">Open Parser</a>
            <a href="annex-b-vs-mp4.html">Extract Raw Streams</a>
            <a href="examples.html">View Examples</a>
          </nav>
        </article>
      `
    },
    about: {
      title: 'About the H.264/H.265 Raw Bitstream Analyzer',
      description: 'Learn what the H.264/H.265 raw bitstream analyzer is for, including protocol references, privacy design, and typical use cases.',
      header: `
        <div class="header-inner">
          <h1>About This Tool</h1>
          <p class="subtitle">A local parser for video developers, testers, and bitstream debugging</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">About</span>
          <h1>H.264/H.265 Raw Bitstream Analyzer</h1>
          <p class="lede">This project is a purely static frontend tool for analyzing NAL units, parameter sets, slice headers, SEI, frame types, and binary field ranges in H.264/H.265 Annex B raw bitstreams.</p>
        </section>

        <h2>Use cases</h2>
        <ul>
          <li>Check whether an encoder outputs correct SPS/PPS/VPS data.</li>
          <li>Debug I/P/B/IDR frame types and GOP structure.</li>
          <li>Inspect the mapping between specification fields and raw binary bits.</li>
          <li>Validate whether an H.264/H.265 Annex B raw stream is complete.</li>
        </ul>

        <h2>Protocol references</h2>
        <p>The parsing logic follows ITU-T H.264 / ISO/IEC 14496-10 and ITU-T H.265 / ISO/IEC 23008-2. Displayed syntax elements keep the original specification names where practical so results can be compared with standards documents and other analysis tools.</p>

        <h2>Privacy design</h2>
        <p>Files are parsed in the browser through a Web Worker and are not uploaded to a server. A static deployment of the site does not need a backend API.</p>

        <nav class="page-footer-nav" aria-label="Related pages">
          <a href="../index.html">Open Parser</a>
          <a href="privacy.html">Privacy Policy</a>
          <a href="terms.html">Terms of Use</a>
          <a href="contact.html">Contact</a>
        </nav>
      `
    },
    privacy: {
      title: 'Privacy Policy - H.264/H.265 Raw Bitstream Analyzer',
      description: 'Privacy policy for the H.264/H.265 raw bitstream analyzer, covering local file parsing, localStorage, logs, third-party services, and contact information.',
      header: `
        <div class="header-inner">
          <h1>Privacy Policy</h1>
          <p class="subtitle">How file parsing, data storage, and third-party services are handled</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">Privacy</span>
          <h1>Privacy Policy</h1>
          <p class="lede">This page explains how files, browser storage, and access data are handled when you use this website.</p>
        </section>

        <h2>File parsing</h2>
        <p>This tool reads and parses H.264/H.265 files locally in your browser. Parsing is performed by a Web Worker, and file contents are not uploaded to a server by the parsing feature.</p>

        <h2>Browser local storage</h2>
        <p>The website may use <code>localStorage</code> to store interface settings such as language preference. This information stays in your browser and can be cleared through browser settings.</p>

        <h2>Server logs</h2>
        <p>If the website is deployed on a hosting platform, the platform may record ordinary access logs such as IP address, access time, User-Agent, and request path. These logs are used for security, stability, and troubleshooting.</p>

        <h2>Third-party services</h2>
        <p>If analytics, ads, or CDN services are added later, third-party cookies or requests may be created. This page should be updated before those services are enabled, and their policy requirements should be followed.</p>

        <h2>Contact us</h2>
        <p>For privacy-related feedback, use the <a href="contact.html">contact page</a> and include the relevant details.</p>
      `
    },
    terms: {
      title: 'Terms of Use - H.264/H.265 Raw Bitstream Analyzer',
      description: 'Terms of use for the H.264/H.265 raw bitstream analyzer, including tool purpose, user responsibility, accuracy limits, prohibited behavior, and disclaimers.',
      header: `
        <div class="header-inner">
          <h1>Terms of Use</h1>
          <p class="subtitle">Understand the scope and responsibility boundaries before using this tool</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">Terms</span>
          <h1>Terms of Use</h1>
          <p class="lede">Last updated: 2026-05-25. This website provides H.264/H.265 Annex B raw bitstream parsing and learning material.</p>
        </section>

        <h2>Tool purpose</h2>
        <p>This tool is intended for video bitstream learning, development debugging, and issue diagnosis. It is not a professional certification tool and does not replace official standards, encoder documentation, or conformance test suites.</p>

        <h2>User responsibility</h2>
        <p>You are responsible for ensuring that uploaded or analyzed files have lawful sources and usage rights. Do not use this tool to process content that infringes copyright, privacy, or other legal rights.</p>

        <h2>Accuracy limits</h2>
        <p>Parsing results are based on the current implementation and public standard syntax. Different tools may use different counting rules. For production decisions, conformance certification, or legal disputes, verify results with official standards and multiple tools.</p>

        <h2>Prohibited behavior</h2>
        <ul>
          <li>Do not attempt to use the website for malicious attacks, scanning, or service disruption.</li>
          <li>Do not create abnormal traffic through automation or interfere with other users' access.</li>
          <li>Do not use page content for misleading, illegal, or infringing purposes.</li>
        </ul>

        <h2>Changes</h2>
        <p>These terms may be updated as features and deployment environments change. Continued use of the website means you understand and accept the updated terms.</p>
      `
    },
    contact: {
      title: 'Contact - H.264/H.265 Raw Bitstream Analyzer',
      description: 'Contact the H.264/H.265 raw bitstream analyzer project to report parsing issues, protocol field differences, content suggestions, or deployment problems.',
      header: `
        <div class="header-inner">
          <h1>Contact and Feedback</h1>
          <p class="subtitle">Report parsing differences, protocol field issues, or content suggestions</p>
        </div>
      `,
      main: `
        <section class="content-hero">
          <span class="content-kicker">Contact</span>
          <h1>Contact and Feedback</h1>
          <p class="lede">If you find that an H.264/H.265 field result differs from the specification or another tool, collect the information below when reporting it.</p>
        </section>

        <h2>Recommended information</h2>
        <ul>
          <li>File type: H.264 or H.265, Annex B raw stream or extracted container result.</li>
          <li>The NAL index, field path, and expected value where the difference appears.</li>
          <li>The comparison tool name, version, and screenshot or text output.</li>
          <li>If a sample can be shared, trim it to the smallest reproducible segment.</li>
        </ul>

        <h2>GitHub project</h2>
        <p>If this site is deployed from a public repository, use GitHub Issues for feedback. After deployment, update this section with the actual repository address.</p>
        <p><a href="https://github.com/qhfnh/StreamParser">StreamParser</a></p>

        <h2>Privacy reminder</h2>
        <p>Do not upload video bitstreams containing private, copyrighted, or commercially sensitive content in public feedback. When needed, provide only a minimal reproducible segment.</p>
      `
    }
  };

  const originals = new WeakMap();
  const originalMeta = captureOriginalMeta();

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(() => {
    captureOriginalBlocks();
    const savedLanguage = readSavedLanguage();
    applyLanguage(savedLanguage);
    bindLanguageSwitch();
    window.__STREAM_PARSER_SITE_I18N_VERSION__ = SCRIPT_VERSION;
  });

  function readSavedLanguage() {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      return saved === 'en' || saved === 'zh' ? saved : DEFAULT_LANGUAGE;
    } catch (err) {
      return DEFAULT_LANGUAGE;
    }
  }

  function bindLanguageSwitch() {
    document.querySelectorAll('#language-switch [data-lang]').forEach(button => {
      button.addEventListener('click', () => {
        const language = button.dataset.lang;
        if (language !== 'en' && language !== 'zh') return;
        try {
          localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
        } catch (err) {
          // Language still switches if storage is unavailable.
        }
        applyLanguage(language);
      });
    });
  }

  function applyLanguage(language) {
    const lang = language === 'en' ? 'en' : 'zh';
    const pageKey = getPageKey();
    const page = PAGES[pageKey];

    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    translateTopNavigation(lang);
    translateFooter(lang);
    translateMeta(lang, page);
    translatePageContent(lang, page);
    updateLanguageButtons(lang);
  }

  function getPageKey() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return file.replace(/\.html$/i, '') || 'index';
  }

  function translateTopNavigation(lang) {
    const isEnglish = lang === 'en';
    const mainNav = document.querySelector('.portal-main-nav');
    if (mainNav) {
      restoreOrCapture(mainNav, 'ariaLabel', 'aria-label');
      mainNav.setAttribute('aria-label', isEnglish ? COMMON_EN.mainNavAria : originals.get(mainNav).ariaLabel);
      mainNav.querySelectorAll('a').forEach(link => translateLink(link, isEnglish, COMMON_EN.links));
    }

    const subNav = document.querySelector('.sub-nav');
    if (subNav) {
      restoreOrCapture(subNav, 'ariaLabel', 'aria-label');
      subNav.setAttribute('aria-label', isEnglish ? COMMON_EN.subNavAria : originals.get(subNav).ariaLabel);
      subNav.querySelectorAll('a').forEach(link => translateLink(link, isEnglish, COMMON_EN.subLinks));
    }

    document.querySelectorAll('.portal-action').forEach(action => {
      restoreOrCapture(action, 'text', 'textContent');
      action.textContent = isEnglish ? COMMON_EN.openTool : originals.get(action).text;
    });
  }

  function translateFooter(lang) {
    const isEnglish = lang === 'en';
    document.querySelectorAll('.footer-links').forEach(nav => {
      restoreOrCapture(nav, 'ariaLabel', 'aria-label');
      nav.setAttribute('aria-label', isEnglish ? COMMON_EN.siteLinksAria : originals.get(nav).ariaLabel);
      nav.querySelectorAll('a').forEach(link => translateLink(link, isEnglish, COMMON_EN.links));
    });

    document.querySelectorAll('.security-notice').forEach(notice => {
      restoreOrCapture(notice, 'html', 'innerHTML');
      notice.innerHTML = isEnglish ? COMMON_EN.footerSecurity : originals.get(notice).html;
    });
  }

  function translatePageContent(lang, page) {
    const header = document.querySelector('.site-header');
    const main = document.querySelector('main.content-page');
    if (!page || !header || !main) return;

    if (lang === 'en') {
      header.innerHTML = page.header.trim();
      main.innerHTML = page.main.trim();
      return;
    }

    const headerOriginal = originals.get(header);
    const mainOriginal = originals.get(main);
    if (headerOriginal && headerOriginal.html) header.innerHTML = headerOriginal.html;
    if (mainOriginal && mainOriginal.html) main.innerHTML = mainOriginal.html;
  }

  function translateMeta(lang, page) {
    if (lang === 'en' && page) {
      document.title = page.title;
      setMeta('name', 'description', page.description);
      setMeta('property', 'og:title', page.title);
      setMeta('property', 'og:description', page.description);
      setMeta('name', 'twitter:title', page.title);
      setMeta('name', 'twitter:description', page.description);
      return;
    }

    document.title = originalMeta.title;
    restoreMeta('name', 'description', originalMeta.description);
    restoreMeta('property', 'og:title', originalMeta.ogTitle);
    restoreMeta('property', 'og:description', originalMeta.ogDescription);
    restoreMeta('name', 'twitter:title', originalMeta.twitterTitle);
    restoreMeta('name', 'twitter:description', originalMeta.twitterDescription);
  }

  function updateLanguageButtons(lang) {
    document.querySelectorAll('#language-switch [data-lang]').forEach(button => {
      const active = button.dataset.lang === lang;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function translateLink(link, isEnglish, labels) {
    restoreOrCapture(link, 'text', 'textContent');
    if (!isEnglish) {
      link.textContent = originals.get(link).text;
      return;
    }
    const href = normalizeHref(link.getAttribute('href') || '');
    if (labels[href]) {
      link.textContent = labels[href];
    }
  }

  function normalizeHref(href) {
    return href.split('#')[0].split('?')[0].replace(/^(\.\/|\.\.\/)+/, '');
  }

  function restoreOrCapture(element, key, property) {
    if (!originals.has(element)) originals.set(element, {});
    const record = originals.get(element);
    if (key in record) return;
    if (property === 'textContent') record[key] = element.textContent;
    else if (property === 'innerHTML') record[key] = element.innerHTML;
    else record[key] = element.getAttribute(property) || '';
  }

  function captureOriginalBlocks() {
    const header = document.querySelector('.site-header');
    const main = document.querySelector('main.content-page');
    if (header) restoreOrCapture(header, 'html', 'innerHTML');
    if (main) restoreOrCapture(main, 'html', 'innerHTML');
  }

  function captureOriginalMeta() {
    return {
      title: document.title,
      description: getMeta('name', 'description'),
      ogTitle: getMeta('property', 'og:title'),
      ogDescription: getMeta('property', 'og:description'),
      twitterTitle: getMeta('name', 'twitter:title'),
      twitterDescription: getMeta('name', 'twitter:description')
    };
  }

  function getMeta(attr, value) {
    const meta = document.querySelector(`meta[${attr}="${value}"]`);
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function setMeta(attr, value, content) {
    const meta = document.querySelector(`meta[${attr}="${value}"]`);
    if (meta && content) meta.setAttribute('content', content);
  }

  function restoreMeta(attr, value, content) {
    const meta = document.querySelector(`meta[${attr}="${value}"]`);
    if (meta && content) meta.setAttribute('content', content);
  }
})();
