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

  // === Worker ===
  let worker = null;
  let parseResults = null;
  let codec = null;
  let selectedNalIndex = null;
  let activeFieldPath = null;

  function ensureWorker() {
    if (!worker) {
      worker = new Worker('parser-worker.js?v=20260524-8');
      worker.onmessage = handleWorkerMessage;
      worker.onerror = function (event) {
        showProgress(false);
        showError(`Worker error: ${event.message || 'failed to load parser-worker.js'}`);
      };
      worker.onmessageerror = function () {
        showProgress(false);
        showError('Worker returned an unreadable message.');
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
      showError('Unsupported file type. Please upload a .h264 or .h265 raw Annex B bitstream file.');
      return;
    }

    fileInfo.textContent = `File: ${file.name} (${formatFileSize(file.size)})`;
    resetUI();
    showProgress(true);

    const reader = new FileReader();
    reader.onload = function () {
      try {
        const w = ensureWorker();
        w.postMessage({ type: 'parse', buffer: reader.result }, [reader.result]);
      } catch (err) {
        showProgress(false);
        showError(`Failed to start parser worker: ${err.message}`);
      }
    };
    reader.onerror = function () {
      showError('Failed to read file.');
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
        showError(e.data.message);
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
    progressText.textContent = msg ? `${msg} (${pct}%)` : `${pct}%`;
  }

  function showProgress(visible) {
    progressBar.hidden = !visible;
    if (!visible) {
      progressFill.style.width = '0%';
      progressText.textContent = '';
    }
  }

  // === Render All Results ===
  function renderAll(data) {
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
      selectNAL(data.nals[0].index);
    } else {
      clearNALInspector();
    }

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // === Summary Stats ===
  function renderSummary(summary) {
    summaryStats.innerHTML = `
      <div class="stat-card stat-total">
        <div class="stat-value">${summary.totalNALs}</div>
        <div class="stat-label">Total NAL Units</div>
      </div>
      <div class="stat-card stat-total">
        <div class="stat-value">${summary.totalFrames}</div>
        <div class="stat-label">Total Frames</div>
      </div>
      <div class="stat-card stat-i">
        <div class="stat-value">${summary.iFrames}</div>
        <div class="stat-label">I Frames</div>
      </div>
      <div class="stat-card stat-idr">
        <div class="stat-value">${summary.idrFrames || 0}</div>
        <div class="stat-label">IDR Frames</div>
      </div>
      <div class="stat-card stat-p">
        <div class="stat-value">${summary.pFrames}</div>
        <div class="stat-label">P Frames</div>
      </div>
      <div class="stat-card stat-b">
        <div class="stat-value">${summary.bFrames}</div>
        <div class="stat-label">B Frames</div>
      </div>
      <div class="stat-card stat-gop">
        <div class="stat-value">${summary.gopCount}</div>
        <div class="stat-label">GOPs (avg ${summary.avgGopSize})</div>
      </div>
      <div class="stat-card stat-total">
        <div class="stat-value">${summary.maxTemporalId}</div>
        <div class="stat-label">Max Temporal ID</div>
      </div>
      <div class="stat-card stat-total">
        <div class="stat-value">${summary.codec}</div>
        <div class="stat-label">Codec</div>
      </div>
    `;
  }

  // === NAL Table ===
  function renderNALTable(nals, codec) {
    const isH265 = codec === 'H265';

    nalCodecHeader.textContent = isH265 ? 'Layer ID' : 'Ref IDC';

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
  document.getElementById('nal-filter').addEventListener('input', function () {
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
    nalDetailTitle.textContent = 'No NAL selected';
    nalDetailBadge.textContent = '-';
    nalFieldList.innerHTML = '<div class="empty-state">Select a NAL row.</div>';
    nalBinaryTitle.textContent = 'Binary';
    nalBinaryRange.textContent = '';
    nalBinaryView.innerHTML = '<div class="empty-state">No bytes loaded.</div>';
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
    nalDetailTitle.textContent = `NAL #${nal.index + 1}`;
    nalDetailBadge.textContent = `Type ${nal.nal_unit_type}`;

    const fieldTree = buildNALFieldTree(nal);
    if (fieldTree.length === 0) {
      nalFieldList.innerHTML = '<div class="empty-state">No parsed fields.</div>';
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
      length: `${nal.length.toLocaleString()} bytes`,
      start_code_length: `${nal.startCodeLen} bytes`,
      trailing_zero_length: `${nal.trailingZeroLen || 0} bytes`,
      payload_offset: nal.payloadOffset == null ? null : formatHexOffset(nal.payloadOffset),
      payload_length: nal.payloadLength == null ? null : `${nal.payloadLength.toLocaleString()} bytes`,
      frame_type: getNALFrameType(nal),
      temporal_id: nal.temporal_id
    };
    if (codec === 'H265') {
      metadata.layer_id = nal.layer_id;
    } else {
      metadata.ref_idc = nal.nal_ref_idc;
    }
    mergeObjectIntoTree(addRootNode(roots, rootMap, 'nal', 'NAL Unit'), metadata, 'nal', fieldRanges);

    if (nal.header && typeof nal.header === 'object') {
      mergeObjectIntoTree(addRootNode(roots, rootMap, 'header', 'Header'), nal.header, 'header', fieldRanges);
    }

    if (nal.parseResult && typeof nal.parseResult === 'object') {
      mergeObjectIntoTree(addRootNode(roots, rootMap, 'parseResult', 'Parsed Fields'), nal.parseResult, 'parseResult', fieldRanges);
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

    parent.value = value == null ? 'N/A' : value;
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
      return `${range.coding} codeword ${range.codeword} -> ${formatDisplayValue(value)} | `;
    }
    return `${range.coding} | `;
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
      return `bits ${segments[0].startBit}-${segments[0].endBit - 1}`;
    }
    const preview = segments.slice(0, 2).map(segment => `${segment.startBit}-${segment.endBit - 1}`).join(', ');
    const suffix = segments.length > 2 ? ` +${segments.length - 2}` : '';
    return `bits ${preview}${suffix}`;
  }

  function describeCollection(value) {
    if (Array.isArray(value)) {
      return value.length === 1 ? '1 item' : `${value.length} items`;
    }
    const count = Object.keys(value || {}).length;
    return count === 1 ? '1 field' : `${count} fields`;
  }

  function rootLabel(path) {
    if (path === 'header') return 'Header';
    if (path === 'parseResult') return 'Parsed Fields';
    if (path === 'nal') return 'NAL Unit';
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
    nalBinaryTitle.textContent = `Binary · NAL #${nal.index + 1}`;
    if (bytes.length === 0) {
      nalBinaryRange.textContent = '';
      nalBinaryView.innerHTML = '<div class="empty-state">No bytes available.</div>';
      return;
    }

    const win = getBinaryWindow(bytes.length, range);
    nalBinaryRange.textContent = range
      ? formatRangeText(range)
      : `${bytes.length.toLocaleString()} bytes`;

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
      return `Showing all ${total} bytes`;
    }
    return `Showing bytes ${shownStart}-${shownEnd} of ${total} (preview window)`;
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
      return `[${value.length} items]`;
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
      html = '<p style="color: var(--text-muted); padding: 16px;">No parameter sets found in this bitstream.</p>';
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
        items.push({ key: fullKey, value: 'N/A' });
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        items.push(...formatParamObject(value, fullKey));
      } else if (Array.isArray(value) && value.length > 20) {
        items.push({ key: fullKey, value: `[${value.length} items]` });
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
      <div class="frame-stat"><div class="fs-val" style="color:var(--green)">${summary.iFrames}</div><div class="fs-label">I Frames</div></div>
      <div class="frame-stat"><div class="fs-val" style="color:var(--cyan)">${summary.idrFrames || 0}</div><div class="fs-label">IDR Frames</div></div>
      <div class="frame-stat"><div class="fs-val" style="color:var(--orange)">${summary.pFrames}</div><div class="fs-label">P Frames</div></div>
      <div class="frame-stat"><div class="fs-val" style="color:var(--purple)">${summary.bFrames}</div><div class="fs-label">B Frames</div></div>
      <div class="frame-stat"><div class="fs-val">${summary.totalFrames}</div><div class="fs-label">Total</div></div>
      <div class="frame-stat"><div class="fs-val">${gopInfo.totalGOPs}</div><div class="fs-label">GOPs</div></div>
      <div class="frame-stat"><div class="fs-val">${summary.avgGopSize}</div><div class="fs-label">Avg GOP Size</div></div>
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
      chartHtml += `<p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:16px;">Showing first 120 of ${frames.length} frames</p>`;
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
      container.innerHTML = '<p style="color: var(--text-muted); padding: 16px;">No SEI messages found.</p>';
      return;
    }

    let html = '';
    for (const sei of seiMessages) {
      html += `<div class="sei-item">
        <div class="sei-item-header">
          <span class="badge" style="background:var(--cyan);color:#000;font-size:0.78rem;padding:2px 8px;border-radius:10px;">SEI</span>
          <span class="sei-type">${escapeHtml(sei.name || `Type ${sei.payloadType}`)}</span>
          <span style="color:var(--text-muted);font-size:0.82rem;">NAL #${sei.nalIndex + 1} · ${sei.payloadSize} bytes</span>
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
    const lines = errors.map(e => `[NAL #${e.nalIndex + 1}] ${e.type}: ${e.error}`);
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
