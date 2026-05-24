/**
 * H.264/H.265 Annex B Bitstream Parser — Web Worker
 *
 * References:
 *   H.264: ITU-T H.264 (08/2024) §7.3 — Syntax
 *   H.265: ITU-T H.265 (01/2026) §7.3 — Syntax
 *
 * All parsing runs off the main thread. The worker receives an ArrayBuffer,
 * scans NAL units, parses parameter sets / slice headers / SEI, and posts
 * results back in structured batches.
 */

/* ===================================================================
 *  BitReader — bit-level read over a Uint8Array (H.264 §7.2 / H.265 §7.2)
 * =================================================================== */
class BitReader {
  constructor(buffer, byteOffset, byteLength) {
    this.buffer = buffer;
    this.byteStart = byteOffset;
    this.byteEnd = byteOffset + byteLength;
    this.bytePos = byteOffset;
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  /** Fill the internal bit buffer with up to 4 bytes. */
  fillBits() {
    while (this.bitCount <= 24 && this.bytePos < this.byteEnd) {
      this.bitBuf |= this.buffer[this.bytePos] << (24 - this.bitCount);
      this.bitCount += 8;
      this.bytePos++;
    }
  }

  /** Read n bits (H.264 §7.2 f(n) / u(n)). MSB-first. */
  readBits(n) {
    if (n === 0) return 0;
    let value = 0;
    let remaining = n;
    while (remaining > 0) {
      if (this.bitCount === 0) {
        this.fillBits();
      }
      if (this.bitCount === 0) {
        value *= 2 ** remaining;
        break;
      }
      const take = Math.min(remaining, this.bitCount);
      const bits = this.bitBuf >>> (32 - take);
      value = value * (2 ** take) + bits;
      this.bitCount -= take;
      this.bitBuf = this.bitCount === 0 || take === 32 ? 0 : (this.bitBuf << take);
      remaining -= take;
    }
    return n === 32 ? value >>> 0 : value;
  }

  /** Peek n bits without advancing. */
  peekBits(n) {
    if (n === 0) return 0;
    if (this.bitCount < n) this.fillBits();
    return this.bitBuf >>> (32 - n);
  }

  /** Skip n bits. */
  skipBits(n) {
    if (n <= this.bitCount) {
      this.bitCount -= n;
      this.bitBuf = this.bitCount === 0 || n === 32 ? 0 : (this.bitBuf << n);
    } else {
      const remain = n - this.bitCount;
      this.bitBuf = 0;
      this.bitCount = 0;
      this.bytePos += Math.floor(remain / 8);
      const skipBitsRemain = remain % 8;
      if (skipBitsRemain > 0) {
        this.fillBits();
        this.bitBuf <<= skipBitsRemain;
        this.bitCount -= skipBitsRemain;
      }
    }
  }

  /** Read unsigned Exp-Golomb code (H.264 §9.1 / H.265 §9.2 — ue(v)). */
  readUE() {
    let leadingZeros = 0;
    while (this.peekBits(1) === 0 && leadingZeros < 32) {
      this.skipBits(1);
      leadingZeros++;
    }
    if (leadingZeros >= 32) return 0;
    this.skipBits(1); // the 1 bit
    if (leadingZeros === 0) return 0;
    const val = this.readBits(leadingZeros);
    return (1 << leadingZeros) - 1 + val;
  }

  /** Read signed Exp-Golomb code (H.264 §9.1.1 / H.265 §9.2 — se(v)). */
  readSE() {
    const val = this.readUE();
    if (val % 2 === 0) return -(val / 2);
    return (val + 1) / 2;
  }

  /** Byte-align: discard remaining bits in current byte (H.264 §7.2). */
  byteAlign() {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  /**
   * more_rbsp_data() — H.264 §7.2 / H.265 §7.2
   * Returns true if more RBSP data remains.
   */
  moreRbspData() {
    if (this.bytePos < this.byteEnd) return true;
    if (this.bitCount === 0) return false;
    // Check if remaining bits are the rbsp_stop_one_bit + zero padding
    const remain = this.bitBuf >>> (32 - this.bitCount);
    const stopBitMask = 1 << (this.bitCount - 1);
    return (remain & (~stopBitMask)) !== 0;
  }

  /** Current absolute byte position. */
  getBytePos() {
    return this.bytePos - Math.ceil(this.bitCount / 8);
  }

  /** Current bit position relative to this reader's byteStart. */
  getBitPos() {
    return (this.bytePos - this.byteStart) * 8 - this.bitCount;
  }
}

function addFieldRange(fieldMap, path, label, value, startBit, endBit, coding = null, codeword = null) {
  if (!fieldMap || startBit == null || endBit == null || endBit <= startBit) return;
  const field = { path, label, value, startBit, endBit, coding };
  if (codeword) field.codeword = codeword;
  fieldMap.push(field);
}

function readRawBits(br, startBit, endBit, maxBits = 128) {
  const bitCount = endBit - startBit;
  if (bitCount <= 0 || bitCount > maxBits) return null;
  let bits = '';
  for (let bit = startBit; bit < endBit; bit++) {
    const byte = br.buffer[br.byteStart + Math.floor(bit / 8)];
    if (byte == null) return null;
    bits += (byte >> (7 - (bit % 8))) & 1;
  }
  return bits;
}

function readBitsField(br, fieldMap, path, bitCount, bitBase = 0, label = null) {
  const start = br.getBitPos();
  const value = br.readBits(bitCount);
  const end = br.getBitPos();
  const codeword = readRawBits(br, start, end, 64);
  addFieldRange(fieldMap, path, label || fieldLabel(path), value, bitBase + start, bitBase + end, `u(${bitCount})`, codeword);
  return value;
}

function readUEField(br, fieldMap, path, bitBase = 0, label = null) {
  const start = br.getBitPos();
  const value = br.readUE();
  const end = br.getBitPos();
  const codeword = readRawBits(br, start, end, 128);
  addFieldRange(fieldMap, path, label || fieldLabel(path), value, bitBase + start, bitBase + end, 'ue(v)', codeword);
  return value;
}

function readSEField(br, fieldMap, path, bitBase = 0, label = null) {
  const start = br.getBitPos();
  const value = br.readSE();
  const end = br.getBitPos();
  const codeword = readRawBits(br, start, end, 128);
  addFieldRange(fieldMap, path, label || fieldLabel(path), value, bitBase + start, bitBase + end, 'se(v)', codeword);
  return value;
}

function readMappedBits(br, fieldMap, path, bitCount, bitBase = 0, label = null) {
  return fieldMap
    ? readBitsField(br, fieldMap, path, bitCount, bitBase, label)
    : br.readBits(bitCount);
}

function readMappedUE(br, fieldMap, path, bitBase = 0, label = null) {
  return fieldMap
    ? readUEField(br, fieldMap, path, bitBase, label)
    : br.readUE();
}

function readMappedSE(br, fieldMap, path, bitBase = 0, label = null) {
  return fieldMap
    ? readSEField(br, fieldMap, path, bitBase, label)
    : br.readSE();
}

function readMappedBitsWithCoding(br, fieldMap, path, bitCount, bitBase = 0, label = null, coding = null) {
  const start = br.getBitPos();
  const value = br.readBits(bitCount);
  const end = br.getBitPos();
  if (fieldMap) {
    const codeword = readRawBits(br, start, end, Math.max(64, bitCount));
    addFieldRange(fieldMap, path, label || fieldLabel(path), value, bitBase + start, bitBase + end, coding || `u(${bitCount})`, codeword);
  }
  return value;
}

function fieldLabel(path) {
  const lastDot = path.lastIndexOf('.');
  return lastDot === -1 ? path : path.slice(lastDot + 1);
}

function buildRbspToEbspByteMap(bytes, start, length) {
  const map = [];
  for (let i = 0; i < length; i++) {
    if (i + 2 < length && bytes[start + i] === 0 && bytes[start + i + 1] === 0 && bytes[start + i + 2] === 0x03) {
      map.push(i);
      map.push(i + 1);
      i += 2;
    } else {
      map.push(i);
    }
  }
  return map;
}

function mapFieldMapToDisplayBits(fieldMap, nal, data, headerSize) {
  if (!fieldMap) return [];
  const rbspToEbsp = buildRbspToEbspByteMap(data, nal.offset + headerSize, nal.length - headerSize);
  return fieldMap.map(field => {
    const segments = mapNalBitRangeToDisplaySegments(field.startBit, field.endBit, nal, headerSize, rbspToEbsp);
    return {
      ...field,
      startBit: segments.length > 0 ? segments[0].startBit : mapNalBitToDisplayBit(field.startBit, nal, headerSize, rbspToEbsp),
      endBit: segments.length > 0 ? segments[segments.length - 1].endBit : mapNalBitToDisplayBit(field.endBit, nal, headerSize, rbspToEbsp),
      segments
    };
  });
}

function mapNalBitRangeToDisplaySegments(startBit, endBit, nal, headerSize, rbspToEbsp) {
  const segments = [];
  let current = null;
  for (let bit = startBit; bit < endBit; bit++) {
    const displayBit = mapNalBitToDisplayBit(bit, nal, headerSize, rbspToEbsp);
    if (displayBit == null) continue;
    if (!current || current.endBit !== displayBit) {
      current = { startBit: displayBit, endBit: displayBit + 1 };
      segments.push(current);
    } else {
      current.endBit = displayBit + 1;
    }
  }
  return segments;
}

function mapNalBitToDisplayBit(nalBit, nal, headerSize, rbspToEbsp) {
  const nalHeaderBits = headerSize * 8;
  if (nalBit < nalHeaderBits) {
    return nal.startCodeLen * 8 + nalBit;
  }

  const rbspBit = nalBit - nalHeaderBits;
  const rbspByte = Math.floor(rbspBit / 8);
  const bitInByte = rbspBit % 8;

  if (rbspByte >= rbspToEbsp.length) {
    return null;
  }

  return (nal.startCodeLen + headerSize + rbspToEbsp[rbspByte]) * 8 + bitInByte;
}

/* ===================================================================
 *  Emulation Prevention — remove 0x03 after 0x000000/0x000001/0x000002
 *  H.264 §7.3 / H.265 §7.3 — byte stream → RBSP conversion
 * =================================================================== */
function removeEmulationPrevention(bytes, start, length) {
  const out = new Uint8Array(length);
  let j = 0;
  for (let i = 0; i < length; i++) {
    if (i + 2 < length && bytes[start + i] === 0 && bytes[start + i + 1] === 0 && bytes[start + i + 2] === 0x03) {
      out[j++] = 0;
      out[j++] = 0;
      i += 2;
    } else {
      out[j++] = bytes[start + i];
    }
  }
  return out.slice(0, j);
}

/* ===================================================================
 *  Annex B Scanner — find start codes & extract NAL units
 * =================================================================== */
function scanNALUnits(data) {
  const nals = [];
  const len = data.length;
  let i = 0;

  while (i < len - 2) {
    // Look for 0x000001 (3-byte) or 0x00000001 (4-byte) start code
    if (data[i] === 0 && data[i + 1] === 0) {
      let startCodeLen = 0;
      if (data[i + 2] === 0x01) {
        startCodeLen = 3;
      } else if (i + 3 < len && data[i + 2] === 0 && data[i + 3] === 0x01) {
        startCodeLen = 4;
      }

      if (startCodeLen > 0) {
        const nalStart = i + startCodeLen;
        // Find next start code
        let next = nalStart;
        let foundNextStartCode = false;
        while (next <= len - 3) {
          if (data[next] === 0 && data[next + 1] === 0) {
            if (data[next + 2] === 0x01 || (next + 3 < len && data[next + 2] === 0 && data[next + 3] === 0x01)) {
              foundNextStartCode = true;
              break;
            }
          }
          next++;
        }
        const nalEnd = foundNextStartCode ? next : len;

        // Trim trailing zero bytes (common in Annex B)
        let trimEnd = nalEnd;
        while (trimEnd > nalStart && data[trimEnd - 1] === 0) {
          trimEnd--;
        }

        if (trimEnd > nalStart) {
          nals.push({
            offset: nalStart,
            length: trimEnd - nalStart,
            startCodeLen: startCodeLen,
            startCodeOffset: i,
            byteStreamEnd: nalEnd,
            trailingZeroLen: nalEnd - trimEnd
          });
        }

        i = nalEnd;
        continue;
      }
    }
    i++;
  }

  return nals;
}

/* ===================================================================
 *  H.264 NAL Unit Type Table
 * =================================================================== */
const H264_NAL_TYPES = {
  0:  'Unspecified',
  1:  'Coded slice of a non-IDR picture',
  2:  'Coded slice data partition A',
  3:  'Coded slice data partition B',
  4:  'Coded slice data partition C',
  5:  'Coded slice of an IDR picture',
  6:  'SEI',
  7:  'SPS',
  8:  'PPS',
  9:  'AUD',
  10: 'End of sequence',
  11: 'End of stream',
  12: 'Filler data',
  13: 'SPS extension',
  14: 'Prefix NAL unit',
  15: 'Subset SPS',
  16: 'Depth parameter set',
  17: 'Reserved',
  18: 'Coded slice of an auxiliary coded picture without partitioning',
  19: 'Coded slice of an extension slice',
  20: 'Coded slice of a depth view component',
  21: 'Coded slice of a depth view component',
  22: 'Reserved',
  23: 'Reserved',
  24: 'STAP-A',
  25: 'STAP-B',
  26: 'MTAP16',
  27: 'MTAP24',
  28: 'FU-A',
  29: 'FU-B',
  30: 'Reserved',
  31: 'Reserved'
};

const H264_VCL_TYPES = new Set([1, 2, 3, 4, 5, 19, 20, 21]);

/* ===================================================================
 *  H.265 NAL Unit Type Table (Table 7-1)
 * =================================================================== */
const H265_NAL_TYPES = {
  0:  'TRAIL_N',
  1:  'TRAIL_R',
  2:  'TSA_N',
  3:  'TSA_R',
  4:  'STSA_N',
  5:  'STSA_R',
  6:  'RADL_N',
  7:  'RADL_R',
  8:  'RASL_N',
  9:  'RASL_R',
  10: 'RSV_VCL_N10',
  11: 'RSV_VCL_R11',
  12: 'RSV_VCL_N12',
  13: 'RSV_VCL_R13',
  14: 'RSV_VCL_N14',
  15: 'RSV_VCL_R15',
  16: 'BLA_W_LP',
  17: 'BLA_W_RADL',
  18: 'BLA_N_LP',
  19: 'IDR_W_RADL',
  20: 'IDR_N_LP',
  21: 'CRA_NUT',
  22: 'RSV_IRAP_VCL22',
  23: 'RSV_IRAP_VCL23',
  24: 'RSV_VCL24',
  25: 'RSV_VCL25',
  26: 'RSV_VCL26',
  27: 'RSV_VCL27',
  28: 'RSV_VCL28',
  29: 'RSV_VCL29',
  30: 'RSV_VCL30',
  31: 'RSV_VCL31',
  32: 'VPS_NUT',
  33: 'SPS_NUT',
  34: 'PPS_NUT',
  35: 'AUD_NUT',
  36: 'EOS_NUT',
  37: 'EOB_NUT',
  38: 'FD_NUT',
  39: 'PREFIX_SEI_NUT',
  40: 'SUFFIX_SEI_NUT',
};

for (let nalType = 41; nalType <= 47; nalType++) {
  H265_NAL_TYPES[nalType] = `RSV_NVCL${nalType}`;
}
for (let nalType = 48; nalType <= 63; nalType++) {
  H265_NAL_TYPES[nalType] = `UNSPEC${nalType}`;
}

const H265_VCL_TYPES = new Set(Array.from({length: 32}, (_, i) => i));
const H265_IRAP_TYPES = new Set([16, 17, 18, 19, 20, 21, 22, 23]);
const H265_RASL_TYPES = new Set([8, 9]);

/* ===================================================================
 *  Chroma format helper
 * =================================================================== */
function getSubWidthC(chroma_format_idc) {
  return chroma_format_idc === 0 || chroma_format_idc === 3 ? 1 : 2;
}
function getSubHeightC(chroma_format_idc) {
  return chroma_format_idc === 0 ? 1 : (chroma_format_idc === 3 ? 1 : 2);
}

/* ===================================================================
 *  H.264 SPS Parser (H.264 §7.3.2.1.1)
 * =================================================================== */
function parseH264SPS(rbsp, nal, fieldMap = null, bitBase = 8) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const sps = {};

  sps.profile_idc = br.readBits(8);                                // §7.3.2.1.1
  sps.constraint_set0_flag = readBitsField(br, fieldMap, 'parseResult.constraint_set0_flag', 1, bitBase);
  sps.constraint_set1_flag = br.readBits(1);
  sps.constraint_set2_flag = br.readBits(1);
  sps.constraint_set3_flag = br.readBits(1);
  sps.constraint_set4_flag = br.readBits(1);
  sps.constraint_set5_flag = br.readBits(1);
  sps.reserved_zero_2bits = br.readBits(2);
  sps.level_idc = br.readBits(8);
  sps.seq_parameter_set_id = br.readUE();

  // Determine profile
  const profile_idc = sps.profile_idc;
  const constrainedSet = (sps.constraint_set0_flag ? 1 : 0) |
    (sps.constraint_set1_flag ? 2 : 0) |
    (sps.constraint_set2_flag ? 4 : 0) |
    (sps.constraint_set3_flag ? 8 : 0);

  // 7.3.2.1.1: chroma_format_idc present for certain profiles
  if (profile_idc === 100 || profile_idc === 110 || profile_idc === 122 ||
      profile_idc === 244 || profile_idc === 44  || profile_idc === 83  ||
      profile_idc === 86  || profile_idc === 118 || profile_idc === 128 ||
      profile_idc === 138 || profile_idc === 139 || profile_idc === 134 ||
      profile_idc === 135) {
    sps.chroma_format_idc = br.readUE();
    if (sps.chroma_format_idc === 3) {
      sps.separate_colour_plane_flag = br.readBits(1);
    }
    sps.bit_depth_luma_minus8 = br.readUE();
    sps.bit_depth_chroma_minus8 = br.readUE();
    sps.qpprime_y_zero_transform_bypass_flag = br.readBits(1);
    sps.seq_scaling_matrix_present_flag = br.readBits(1);
    if (sps.seq_scaling_matrix_present_flag) {
      sps.seq_scaling_list_present_flag = [];
      sps.seq_scaling_list = [];
      const count = (sps.chroma_format_idc !== 3) ? 8 : 12;
      for (let i = 0; i < count; i++) {
        const seqScalingListPresentFlag = br.readBits(1);
        sps.seq_scaling_list_present_flag.push(seqScalingListPresentFlag);
        if (seqScalingListPresentFlag) {
          sps.seq_scaling_list.push(readScalingListSyntax(br, i < 6 ? 16 : 64));
        }
      }
    }
  } else {
    sps.chroma_format_idc = 1; // default 4:2:0
    sps.bit_depth_luma_minus8 = 0;
    sps.bit_depth_chroma_minus8 = 0;
  }

  sps.log2_max_frame_num_minus4 = br.readUE();
  sps.pic_order_cnt_type = br.readUE();

  if (sps.pic_order_cnt_type === 0) {
    sps.log2_max_pic_order_cnt_lsb_minus4 = br.readUE();
  } else if (sps.pic_order_cnt_type === 1) {
    sps.delta_pic_order_always_zero_flag = br.readBits(1);
    sps.offset_for_non_ref_pic = br.readSE();
    sps.offset_for_top_to_bottom_field = br.readSE();
    sps.num_ref_frames_in_pic_order_cnt_cycle = br.readUE();
    sps.offset_for_ref_frame = [];
    for (let i = 0; i < sps.num_ref_frames_in_pic_order_cnt_cycle; i++) {
      sps.offset_for_ref_frame.push(br.readSE());
    }
  }

  sps.max_num_ref_frames = br.readUE();
  sps.gaps_in_frame_num_value_allowed_flag = br.readBits(1);
  sps.pic_width_in_mbs_minus1 = br.readUE();
  sps.pic_height_in_map_units_minus1 = br.readUE();
  sps.frame_mbs_only_flag = br.readBits(1);

  if (!sps.frame_mbs_only_flag) {
    sps.mb_adaptive_frame_field_flag = br.readBits(1);
  }

  sps.direct_8x8_inference_flag = br.readBits(1);

  sps.frame_cropping_flag = br.readBits(1);
  if (sps.frame_cropping_flag) {
    sps.frame_crop_left_offset = br.readUE();
    sps.frame_crop_right_offset = br.readUE();
    sps.frame_crop_top_offset = br.readUE();
    sps.frame_crop_bottom_offset = br.readUE();
  }

  // Calculate resolution
  const subWC = getSubWidthC(sps.chroma_format_idc);
  const subHC = getSubHeightC(sps.chroma_format_idc);
  sps.width = (sps.pic_width_in_mbs_minus1 + 1) * 16;
  sps.height = (2 - sps.frame_mbs_only_flag) * (sps.pic_height_in_map_units_minus1 + 1) * 16;
  if (sps.frame_cropping_flag) {
    // CropUnitX = SubWidthC, CropUnitY = SubHeightC * (2 - frame_mbs_only_flag) per §7.4.2.1.1
  const cropUnitX = subWC;
  const cropUnitY = subHC * (2 - sps.frame_mbs_only_flag);
  sps.width -= (sps.frame_crop_left_offset + sps.frame_crop_right_offset) * cropUnitX;
  sps.height -= (sps.frame_crop_top_offset + sps.frame_crop_bottom_offset) * cropUnitY;
  }

  // VUI parameters (§E.1.1)
  sps.vui_parameters_present_flag = br.readBits(1);
  if (sps.vui_parameters_present_flag) {
    sps.vui = parseH264VUI(br);
  }

  return sps;
}

function skipScalingList(br, sizeOfScalingList) {
  let lastScale = 8, nextScale = 8;
  for (let j = 0; j < sizeOfScalingList; j++) {
    if (nextScale !== 0) {
      const deltaScale = br.readSE();
      nextScale = (lastScale + deltaScale + 256) % 256;
    }
    lastScale = (nextScale === 0) ? lastScale : nextScale;
  }
}

/* ===================================================================
 *  H.264 VUI Parser (H.264 §E.1.1)
 * =================================================================== */
function readScalingListSyntax(br, sizeOfScalingList, fieldMap = null, pathPrefix = '', bitBase = 0) {
  const scalingList = [];
  const deltaScale = [];
  let lastScale = 8;
  let nextScale = 8;
  let useDefaultScalingMatrixFlag = 0;

  for (let j = 0; j < sizeOfScalingList; j++) {
    if (nextScale !== 0) {
      const delta = readMappedSE(br, fieldMap, `${pathPrefix}.delta_scale[${j}]`, bitBase, `delta_scale[${j}]`);
      deltaScale.push(delta);
      nextScale = (lastScale + delta + 256) % 256;
      if (j === 0 && nextScale === 0) {
        useDefaultScalingMatrixFlag = 1;
      }
    }
    const value = nextScale === 0 ? lastScale : nextScale;
    scalingList.push(value);
    lastScale = value;
  }

  return {
    use_default_scaling_matrix_flag: useDefaultScalingMatrixFlag,
    delta_scale: deltaScale,
    scaling_list: scalingList
  };
}

function parseH264VUI(br, fieldMap = null, bitBase = 8, pathPrefix = 'parseResult.vui') {
  const vui = {};
  vui.aspect_ratio_info_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.aspect_ratio_info_present_flag`, 1, bitBase);
  if (vui.aspect_ratio_info_present_flag) {
    vui.aspect_ratio_idc = readMappedBits(br, fieldMap, `${pathPrefix}.aspect_ratio_idc`, 8, bitBase);
    if (vui.aspect_ratio_idc === 255) {
      vui.sar_width = readMappedBits(br, fieldMap, `${pathPrefix}.sar_width`, 16, bitBase);
      vui.sar_height = readMappedBits(br, fieldMap, `${pathPrefix}.sar_height`, 16, bitBase);
    }
  }
  vui.overscan_info_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.overscan_info_present_flag`, 1, bitBase);
  if (vui.overscan_info_present_flag) {
    vui.overscan_appropriate_flag = readMappedBits(br, fieldMap, `${pathPrefix}.overscan_appropriate_flag`, 1, bitBase);
  }
  vui.video_signal_type_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.video_signal_type_present_flag`, 1, bitBase);
  if (vui.video_signal_type_present_flag) {
    vui.video_format = readMappedBits(br, fieldMap, `${pathPrefix}.video_format`, 3, bitBase);
    vui.video_full_range_flag = readMappedBits(br, fieldMap, `${pathPrefix}.video_full_range_flag`, 1, bitBase);
    vui.colour_description_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.colour_description_present_flag`, 1, bitBase);
    if (vui.colour_description_present_flag) {
      vui.colour_primaries = readMappedBits(br, fieldMap, `${pathPrefix}.colour_primaries`, 8, bitBase);
      vui.transfer_characteristics = readMappedBits(br, fieldMap, `${pathPrefix}.transfer_characteristics`, 8, bitBase);
      vui.matrix_coefficients = readMappedBits(br, fieldMap, `${pathPrefix}.matrix_coefficients`, 8, bitBase);
    }
  }
  vui.chroma_loc_info_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.chroma_loc_info_present_flag`, 1, bitBase);
  if (vui.chroma_loc_info_present_flag) {
    vui.chroma_sample_loc_type_top_field = readMappedUE(br, fieldMap, `${pathPrefix}.chroma_sample_loc_type_top_field`, bitBase);
    vui.chroma_sample_loc_type_bottom_field = readMappedUE(br, fieldMap, `${pathPrefix}.chroma_sample_loc_type_bottom_field`, bitBase);
  }
  vui.timing_info_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.timing_info_present_flag`, 1, bitBase);
  if (vui.timing_info_present_flag) {
    vui.num_units_in_tick = readMappedBits(br, fieldMap, `${pathPrefix}.num_units_in_tick`, 32, bitBase);
    vui.time_scale = readMappedBits(br, fieldMap, `${pathPrefix}.time_scale`, 32, bitBase);
    vui.fixed_frame_rate_flag = readMappedBits(br, fieldMap, `${pathPrefix}.fixed_frame_rate_flag`, 1, bitBase);
  }
  vui.nal_hrd_parameters_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.nal_hrd_parameters_present_flag`, 1, bitBase);
  if (vui.nal_hrd_parameters_present_flag) {
    vui.nal_hrd_parameters = parseH264HRDParameters(br, fieldMap, bitBase, `${pathPrefix}.nal_hrd_parameters`);
  }
  vui.vcl_hrd_parameters_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.vcl_hrd_parameters_present_flag`, 1, bitBase);
  if (vui.vcl_hrd_parameters_present_flag) {
    vui.vcl_hrd_parameters = parseH264HRDParameters(br, fieldMap, bitBase, `${pathPrefix}.vcl_hrd_parameters`);
  }
  if (vui.nal_hrd_parameters_present_flag || vui.vcl_hrd_parameters_present_flag) {
    vui.low_delay_hrd_flag = readMappedBits(br, fieldMap, `${pathPrefix}.low_delay_hrd_flag`, 1, bitBase);
  }
  vui.pic_struct_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.pic_struct_present_flag`, 1, bitBase);
  vui.bitstream_restriction_flag = readMappedBits(br, fieldMap, `${pathPrefix}.bitstream_restriction_flag`, 1, bitBase);
  if (vui.bitstream_restriction_flag) {
    vui.motion_vectors_over_pic_boundaries_flag = readMappedBits(br, fieldMap, `${pathPrefix}.motion_vectors_over_pic_boundaries_flag`, 1, bitBase);
    vui.max_bytes_per_pic_denom = readMappedUE(br, fieldMap, `${pathPrefix}.max_bytes_per_pic_denom`, bitBase);
    vui.max_bits_per_mb_denom = readMappedUE(br, fieldMap, `${pathPrefix}.max_bits_per_mb_denom`, bitBase);
    vui.log2_max_mv_length_horizontal = readMappedUE(br, fieldMap, `${pathPrefix}.log2_max_mv_length_horizontal`, bitBase);
    vui.log2_max_mv_length_vertical = readMappedUE(br, fieldMap, `${pathPrefix}.log2_max_mv_length_vertical`, bitBase);
    vui.max_num_reorder_frames = readMappedUE(br, fieldMap, `${pathPrefix}.max_num_reorder_frames`, bitBase);
    vui.max_dec_frame_buffering = readMappedUE(br, fieldMap, `${pathPrefix}.max_dec_frame_buffering`, bitBase);
  }
  return vui;
}

function parseH264HRDParameters(br, fieldMap = null, bitBase = 8, pathPrefix = 'parseResult.vui.hrd_parameters') {
  const hrd = {};
  hrd.cpb_cnt_minus1 = readMappedUE(br, fieldMap, `${pathPrefix}.cpb_cnt_minus1`, bitBase);
  hrd.bit_rate_scale = readMappedBits(br, fieldMap, `${pathPrefix}.bit_rate_scale`, 4, bitBase);
  hrd.cpb_size_scale = readMappedBits(br, fieldMap, `${pathPrefix}.cpb_size_scale`, 4, bitBase);
  hrd.sched_sel = [];
  for (let i = 0; i <= hrd.cpb_cnt_minus1; i++) {
    const itemPath = `${pathPrefix}.sched_sel[${i}]`;
    hrd.sched_sel.push({
      bit_rate_value_minus1: readMappedUE(br, fieldMap, `${itemPath}.bit_rate_value_minus1`, bitBase),
      cpb_size_value_minus1: readMappedUE(br, fieldMap, `${itemPath}.cpb_size_value_minus1`, bitBase),
      cbr_flag: readMappedBits(br, fieldMap, `${itemPath}.cbr_flag`, 1, bitBase)
    });
  }
  hrd.initial_cpb_removal_delay_length_minus1 = readMappedBits(br, fieldMap, `${pathPrefix}.initial_cpb_removal_delay_length_minus1`, 5, bitBase);
  hrd.cpb_removal_delay_length_minus1 = readMappedBits(br, fieldMap, `${pathPrefix}.cpb_removal_delay_length_minus1`, 5, bitBase);
  hrd.dpb_output_delay_length_minus1 = readMappedBits(br, fieldMap, `${pathPrefix}.dpb_output_delay_length_minus1`, 5, bitBase);
  hrd.time_offset_length = readMappedBits(br, fieldMap, `${pathPrefix}.time_offset_length`, 5, bitBase);
  return hrd;
}

/* ===================================================================
 *  H.264 PPS Parser (H.264 §7.3.2.2)
 * =================================================================== */
function parseH264PPS(rbsp, spsMap = null) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const pps = {};

  pps.pic_parameter_set_id = br.readUE();                         // §7.3.2.2
  pps.seq_parameter_set_id = br.readUE();
  pps.entropy_coding_mode_flag = br.readBits(1);
  pps.bottom_field_pic_order_in_frame_present_flag = br.readBits(1);
  pps.num_slice_groups_minus1 = br.readUE();

  if (pps.num_slice_groups_minus1 > 0) {
    pps.slice_group_map_type = br.readUE();
    if (pps.slice_group_map_type === 0) {
      pps.run_length_minus1 = [];
      for (let i = 0; i <= pps.num_slice_groups_minus1; i++) {
        pps.run_length_minus1.push(br.readUE());
      }
    } else if (pps.slice_group_map_type === 2) {
      pps.top_left = [];
      pps.bottom_right = [];
      for (let i = 0; i < pps.num_slice_groups_minus1; i++) {
        pps.top_left.push(br.readUE());
        pps.bottom_right.push(br.readUE());
      }
    } else if (pps.slice_group_map_type >= 3 && pps.slice_group_map_type <= 5) {
      pps.slice_group_change_direction_flag = br.readBits(1);
      pps.slice_group_change_rate_minus1 = br.readUE();
    } else if (pps.slice_group_map_type === 6) {
      pps.pic_size_in_map_units_minus1 = br.readUE();
      pps.slice_group_id = [];
      const sliceGroupIdBits = Math.ceil(Math.log2(pps.num_slice_groups_minus1 + 1));
      for (let i = 0; i <= pps.pic_size_in_map_units_minus1; i++) {
        pps.slice_group_id.push(br.readBits(sliceGroupIdBits));
      }
    }
  }

  pps.num_ref_idx_l0_default_active_minus1 = br.readUE();
  pps.num_ref_idx_l1_default_active_minus1 = br.readUE();
  pps.weighted_pred_flag = br.readBits(1);
  pps.weighted_bipred_idc = br.readBits(2);
  pps.pic_init_qp_minus26 = br.readSE();
  pps.pic_init_qs_minus26 = br.readSE();
  pps.chroma_qp_index_offset = br.readSE();
  pps.deblocking_filter_control_present_flag = br.readBits(1);
  pps.constrained_intra_pred_flag = br.readBits(1);
  pps.redundant_pic_cnt_present_flag = br.readBits(1);

  if (br.moreRbspData()) {
    const sps = spsMap ? spsMap[pps.seq_parameter_set_id] : null;
    pps.transform_8x8_mode_flag = br.readBits(1);
    pps.pic_scaling_matrix_present_flag = br.readBits(1);
    if (pps.pic_scaling_matrix_present_flag) {
      pps.pic_scaling_list_present_flag = [];
      pps.pic_scaling_list = [];
      const count = getH264PPSScalingListCount(sps, pps.transform_8x8_mode_flag);
      for (let i = 0; i < count; i++) {
        const present = br.readBits(1);
        pps.pic_scaling_list_present_flag.push(present);
        if (present) {
          pps.pic_scaling_list.push(readScalingListSyntax(br, i < 6 ? 16 : 64));
        }
      }
    }
    pps.second_chroma_qp_index_offset = br.readSE();
  }

  return pps;
}

function getH264PPSScalingListCount(sps, transform8x8ModeFlag) {
  const chromaFormatIdc = sps && sps.chroma_format_idc != null ? sps.chroma_format_idc : 1;
  return 6 + (chromaFormatIdc !== 3 ? 2 : 6) * transform8x8ModeFlag;
}

/* ===================================================================
 *  H.264 Slice Header Parser (H.264 §7.3.3)
 *  Returns frame classification info.
 * =================================================================== */
function parseH264SliceHeaderLegacy(rbsp, nalType, spsMap, ppsMap) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const sh = {};

  sh.first_mb_in_slice = br.readUE();                              // §7.3.3
  sh.slice_type = br.readUE();

  // Map slice_type to I/P/B (Table 7-6)
  const sliceTypeMap = {
    0: 'P', 1: 'B', 2: 'I', 3: 'SP', 4: 'SI',
    5: 'P', 6: 'B', 7: 'I', 8: 'SP', 9: 'SI'
  };
  sh.slice_type_name = sliceTypeMap[sh.slice_type] || 'Unknown';
  sh.is_idr = (nalType === 5);

  sh.pic_parameter_set_id = br.readUE();
  const pps = ppsMap[sh.pic_parameter_set_id];
  const sps = pps ? spsMap[pps.seq_parameter_set_id] : null;

  if (sps && sps.separate_colour_plane_flag) {
    sh.colour_plane_id = br.readBits(2);
  }

  const frameNumBits = sps ? sps.log2_max_frame_num_minus4 + 4 : 16;
  sh.frame_num = br.readBits(frameNumBits);

  if (!sps || !sps.frame_mbs_only_flag) {
    sh.field_pic_flag = br.readBits(1);
    if (sh.field_pic_flag) {
      sh.bottom_field_flag = br.readBits(1);
    }
  }

  if (sh.is_idr) {
    sh.idr_pic_id = br.readUE();
  }

  // POC derivation
  if (sps && sps.pic_order_cnt_type === 0) {
    const pocLsbBits = sps.log2_max_pic_order_cnt_lsb_minus4 + 4;
    sh.pic_order_cnt_lsb = br.readBits(pocLsbBits);
    if (pps && pps.bottom_field_pic_order_in_frame_present_flag && !sh.field_pic_flag) {
      sh.delta_pic_order_cnt_bottom = br.readSE();
    }
  }

  sh.temporal_id = 0; // H.264 doesn't have explicit temporal_id in slice header; use nal_ref_idc as hint

  return sh;
}

function mapH264SPSFields(rbsp, fieldMap, bitBase = 8) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const sps = {};

  sps.profile_idc = readBitsField(br, fieldMap, 'parseResult.profile_idc', 8, bitBase);
  readBitsField(br, fieldMap, 'parseResult.constraint_set0_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.constraint_set1_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.constraint_set2_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.constraint_set3_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.constraint_set4_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.constraint_set5_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.reserved_zero_2bits', 2, bitBase);
  readBitsField(br, fieldMap, 'parseResult.level_idc', 8, bitBase);
  readUEField(br, fieldMap, 'parseResult.seq_parameter_set_id', bitBase);

  if (isH264ExtendedProfile(sps.profile_idc)) {
    sps.chroma_format_idc = readUEField(br, fieldMap, 'parseResult.chroma_format_idc', bitBase);
    if (sps.chroma_format_idc === 3) {
      readBitsField(br, fieldMap, 'parseResult.separate_colour_plane_flag', 1, bitBase);
    }
    readUEField(br, fieldMap, 'parseResult.bit_depth_luma_minus8', bitBase);
    readUEField(br, fieldMap, 'parseResult.bit_depth_chroma_minus8', bitBase);
    readBitsField(br, fieldMap, 'parseResult.qpprime_y_zero_transform_bypass_flag', 1, bitBase);
    const scalingPresent = readBitsField(br, fieldMap, 'parseResult.seq_scaling_matrix_present_flag', 1, bitBase);
    if (scalingPresent) {
      const count = (sps.chroma_format_idc !== 3) ? 8 : 12;
      for (let i = 0; i < count; i++) {
        const present = readBitsField(br, fieldMap, `parseResult.seq_scaling_list_present_flag[${i}]`, 1, bitBase, `seq_scaling_list_present_flag[${i}]`);
        if (present) {
          readScalingListSyntax(br, i < 6 ? 16 : 64, fieldMap, `parseResult.seq_scaling_list[${i}]`, bitBase);
        }
      }
    }
  }

  readUEField(br, fieldMap, 'parseResult.log2_max_frame_num_minus4', bitBase);
  const picOrderCntType = readUEField(br, fieldMap, 'parseResult.pic_order_cnt_type', bitBase);
  if (picOrderCntType === 0) {
    readUEField(br, fieldMap, 'parseResult.log2_max_pic_order_cnt_lsb_minus4', bitBase);
  } else if (picOrderCntType === 1) {
    readBitsField(br, fieldMap, 'parseResult.delta_pic_order_always_zero_flag', 1, bitBase);
    readSEField(br, fieldMap, 'parseResult.offset_for_non_ref_pic', bitBase);
    readSEField(br, fieldMap, 'parseResult.offset_for_top_to_bottom_field', bitBase);
    const cycleCount = readUEField(br, fieldMap, 'parseResult.num_ref_frames_in_pic_order_cnt_cycle', bitBase);
    for (let i = 0; i < cycleCount; i++) {
      readSEField(br, fieldMap, `parseResult.offset_for_ref_frame[${i}]`, bitBase, `offset_for_ref_frame[${i}]`);
    }
  }

  readUEField(br, fieldMap, 'parseResult.max_num_ref_frames', bitBase);
  readBitsField(br, fieldMap, 'parseResult.gaps_in_frame_num_value_allowed_flag', 1, bitBase);
  readUEField(br, fieldMap, 'parseResult.pic_width_in_mbs_minus1', bitBase);
  readUEField(br, fieldMap, 'parseResult.pic_height_in_map_units_minus1', bitBase);
  const frameMbsOnly = readBitsField(br, fieldMap, 'parseResult.frame_mbs_only_flag', 1, bitBase);
  if (!frameMbsOnly) {
    readBitsField(br, fieldMap, 'parseResult.mb_adaptive_frame_field_flag', 1, bitBase);
  }
  readBitsField(br, fieldMap, 'parseResult.direct_8x8_inference_flag', 1, bitBase);
  const cropping = readBitsField(br, fieldMap, 'parseResult.frame_cropping_flag', 1, bitBase);
  if (cropping) {
    readUEField(br, fieldMap, 'parseResult.frame_crop_left_offset', bitBase);
    readUEField(br, fieldMap, 'parseResult.frame_crop_right_offset', bitBase);
    readUEField(br, fieldMap, 'parseResult.frame_crop_top_offset', bitBase);
    readUEField(br, fieldMap, 'parseResult.frame_crop_bottom_offset', bitBase);
  }
  const vuiPresent = readBitsField(br, fieldMap, 'parseResult.vui_parameters_present_flag', 1, bitBase);
  if (vuiPresent) {
    mapH264VUIFields(br, fieldMap, bitBase);
  }
}

function isH264ExtendedProfile(profileIdc) {
  return profileIdc === 100 || profileIdc === 110 || profileIdc === 122 ||
    profileIdc === 244 || profileIdc === 44 || profileIdc === 83 ||
    profileIdc === 86 || profileIdc === 118 || profileIdc === 128 ||
    profileIdc === 138 || profileIdc === 139 || profileIdc === 134 ||
    profileIdc === 135;
}

function mapH264VUIFields(br, fieldMap, bitBase = 8) {
  parseH264VUI(br, fieldMap, bitBase);
}

function mapH264PPSFields(rbsp, fieldMap, bitBase = 8, spsMap = null) {
  const br = new BitReader(rbsp, 0, rbsp.length);

  readUEField(br, fieldMap, 'parseResult.pic_parameter_set_id', bitBase);
  const seqParameterSetId = readUEField(br, fieldMap, 'parseResult.seq_parameter_set_id', bitBase);
  readBitsField(br, fieldMap, 'parseResult.entropy_coding_mode_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.bottom_field_pic_order_in_frame_present_flag', 1, bitBase);
  const numSliceGroups = readUEField(br, fieldMap, 'parseResult.num_slice_groups_minus1', bitBase);

  if (numSliceGroups > 0) {
    const mapType = readUEField(br, fieldMap, 'parseResult.slice_group_map_type', bitBase);
    if (mapType === 0) {
      for (let i = 0; i <= numSliceGroups; i++) {
        readUEField(br, fieldMap, `parseResult.run_length_minus1[${i}]`, bitBase, `run_length_minus1[${i}]`);
      }
    } else if (mapType === 2) {
      for (let i = 0; i < numSliceGroups; i++) {
        readUEField(br, fieldMap, `parseResult.top_left[${i}]`, bitBase, `top_left[${i}]`);
        readUEField(br, fieldMap, `parseResult.bottom_right[${i}]`, bitBase, `bottom_right[${i}]`);
      }
    } else if (mapType >= 3 && mapType <= 5) {
      readBitsField(br, fieldMap, 'parseResult.slice_group_change_direction_flag', 1, bitBase);
      readUEField(br, fieldMap, 'parseResult.slice_group_change_rate_minus1', bitBase);
    } else if (mapType === 6) {
      const picSize = readUEField(br, fieldMap, 'parseResult.pic_size_in_map_units_minus1', bitBase);
      const sliceGroupIdBits = Math.ceil(Math.log2(numSliceGroups + 1));
      for (let i = 0; i <= picSize; i++) {
        readBitsField(br, fieldMap, `parseResult.slice_group_id[${i}]`, sliceGroupIdBits, bitBase, `slice_group_id[${i}]`);
      }
    }
  }

  readUEField(br, fieldMap, 'parseResult.num_ref_idx_l0_default_active_minus1', bitBase);
  readUEField(br, fieldMap, 'parseResult.num_ref_idx_l1_default_active_minus1', bitBase);
  readBitsField(br, fieldMap, 'parseResult.weighted_pred_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.weighted_bipred_idc', 2, bitBase);
  readSEField(br, fieldMap, 'parseResult.pic_init_qp_minus26', bitBase);
  readSEField(br, fieldMap, 'parseResult.pic_init_qs_minus26', bitBase);
  readSEField(br, fieldMap, 'parseResult.chroma_qp_index_offset', bitBase);
  readBitsField(br, fieldMap, 'parseResult.deblocking_filter_control_present_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.constrained_intra_pred_flag', 1, bitBase);
  readBitsField(br, fieldMap, 'parseResult.redundant_pic_cnt_present_flag', 1, bitBase);

  if (br.moreRbspData()) {
    const sps = spsMap ? spsMap[seqParameterSetId] : null;
    const transform8x8 = readBitsField(br, fieldMap, 'parseResult.transform_8x8_mode_flag', 1, bitBase);
    const scalingMatrixPresent = readBitsField(br, fieldMap, 'parseResult.pic_scaling_matrix_present_flag', 1, bitBase);
    if (scalingMatrixPresent) {
      const count = getH264PPSScalingListCount(sps, transform8x8);
      for (let i = 0; i < count; i++) {
        const present = readBitsField(br, fieldMap, `parseResult.pic_scaling_list_present_flag[${i}]`, 1, bitBase, `pic_scaling_list_present_flag[${i}]`);
        if (present) {
          readScalingListSyntax(br, i < 6 ? 16 : 64, fieldMap, `parseResult.pic_scaling_list[${i}]`, bitBase);
        }
      }
    }
    readSEField(br, fieldMap, 'parseResult.second_chroma_qp_index_offset', bitBase);
  }
}

function mapH264SliceHeaderFieldsLegacy(rbsp, nalType, spsMap, ppsMap, fieldMap, bitBase = 8) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  readUEField(br, fieldMap, 'parseResult.first_mb_in_slice', bitBase);
  readUEField(br, fieldMap, 'parseResult.slice_type', bitBase);
  const picParameterSetId = readUEField(br, fieldMap, 'parseResult.pic_parameter_set_id', bitBase);
  const pps = ppsMap[picParameterSetId];
  const sps = pps ? spsMap[pps.seq_parameter_set_id] : null;

  if (sps && sps.separate_colour_plane_flag) {
    readBitsField(br, fieldMap, 'parseResult.colour_plane_id', 2, bitBase);
  }

  const frameNumBits = sps ? sps.log2_max_frame_num_minus4 + 4 : 16;
  readBitsField(br, fieldMap, 'parseResult.frame_num', frameNumBits, bitBase);

  let fieldPicFlag = 0;
  if (!sps || !sps.frame_mbs_only_flag) {
    fieldPicFlag = readBitsField(br, fieldMap, 'parseResult.field_pic_flag', 1, bitBase);
    if (fieldPicFlag) {
      readBitsField(br, fieldMap, 'parseResult.bottom_field_flag', 1, bitBase);
    }
  }

  if (nalType === 5) {
    readUEField(br, fieldMap, 'parseResult.idr_pic_id', bitBase);
  }

  if (sps && sps.pic_order_cnt_type === 0) {
    const pocLsbBits = sps.log2_max_pic_order_cnt_lsb_minus4 + 4;
    readBitsField(br, fieldMap, 'parseResult.pic_order_cnt_lsb', pocLsbBits, bitBase);
    if (pps && pps.bottom_field_pic_order_in_frame_present_flag && !fieldPicFlag) {
      readSEField(br, fieldMap, 'parseResult.delta_pic_order_cnt_bottom', bitBase);
    }
  }
}

/* ===================================================================
 *  H.265 Profile-Tier-Level Parser (H.265 §7.3.3)
 * =================================================================== */
function parseH264SliceHeader(rbsp, nalType, spsMap, ppsMap, nalRefIdc = 0) {
  return parseH264SliceHeaderSyntax(rbsp, nalType, spsMap, ppsMap, nalRefIdc, null);
}

function mapH264SliceHeaderFields(rbsp, nalType, spsMap, ppsMap, fieldMap, bitBase = 8, nalRefIdc = 0) {
  parseH264SliceHeaderSyntax(rbsp, nalType, spsMap, ppsMap, nalRefIdc, fieldMap, bitBase);
}

function parseH264SliceHeaderSyntax(rbsp, nalType, spsMap, ppsMap, nalRefIdc = 0, fieldMap = null, bitBase = 8) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const sh = {};

  sh.first_mb_in_slice = readMappedUE(br, fieldMap, 'parseResult.first_mb_in_slice', bitBase);
  sh.slice_type = readMappedUE(br, fieldMap, 'parseResult.slice_type', bitBase);

  const sliceTypeMap = {
    0: 'P', 1: 'B', 2: 'I', 3: 'SP', 4: 'SI',
    5: 'P', 6: 'B', 7: 'I', 8: 'SP', 9: 'SI'
  };
  sh.slice_type_name = sliceTypeMap[sh.slice_type] || 'Unknown';
  sh.is_idr = (nalType === 5);

  const normalizedSliceType = normalizeH264SliceType(sh.slice_type);
  const isP = normalizedSliceType === 0;
  const isB = normalizedSliceType === 1;
  const isI = normalizedSliceType === 2;
  const isSP = normalizedSliceType === 3;
  const isSI = normalizedSliceType === 4;

  sh.pic_parameter_set_id = readMappedUE(br, fieldMap, 'parseResult.pic_parameter_set_id', bitBase);
  const pps = ppsMap[sh.pic_parameter_set_id];
  const sps = pps ? spsMap[pps.seq_parameter_set_id] : null;

  if (sps && sps.separate_colour_plane_flag) {
    sh.colour_plane_id = readMappedBits(br, fieldMap, 'parseResult.colour_plane_id', 2, bitBase);
  }

  const frameNumBits = sps ? sps.log2_max_frame_num_minus4 + 4 : 16;
  sh.frame_num = readMappedBits(br, fieldMap, 'parseResult.frame_num', frameNumBits, bitBase);

  let fieldPicFlag = 0;
  if (!sps || !sps.frame_mbs_only_flag) {
    fieldPicFlag = readMappedBits(br, fieldMap, 'parseResult.field_pic_flag', 1, bitBase);
    sh.field_pic_flag = fieldPicFlag;
    if (fieldPicFlag) {
      sh.bottom_field_flag = readMappedBits(br, fieldMap, 'parseResult.bottom_field_flag', 1, bitBase);
    }
  }

  if (sh.is_idr) {
    sh.idr_pic_id = readMappedUE(br, fieldMap, 'parseResult.idr_pic_id', bitBase);
  }

  if (sps && sps.pic_order_cnt_type === 0) {
    const pocLsbBits = sps.log2_max_pic_order_cnt_lsb_minus4 + 4;
    sh.pic_order_cnt_lsb = readMappedBits(br, fieldMap, 'parseResult.pic_order_cnt_lsb', pocLsbBits, bitBase);
    if (pps && pps.bottom_field_pic_order_in_frame_present_flag && !fieldPicFlag) {
      sh.delta_pic_order_cnt_bottom = readMappedSE(br, fieldMap, 'parseResult.delta_pic_order_cnt_bottom', bitBase);
    }
  } else if (sps && sps.pic_order_cnt_type === 1 && !sps.delta_pic_order_always_zero_flag) {
    sh.delta_pic_order_cnt_0 = readMappedSE(br, fieldMap, 'parseResult.delta_pic_order_cnt_0', bitBase);
    if (pps && pps.bottom_field_pic_order_in_frame_present_flag && !fieldPicFlag) {
      sh.delta_pic_order_cnt_1 = readMappedSE(br, fieldMap, 'parseResult.delta_pic_order_cnt_1', bitBase);
    }
  }

  if (pps && pps.redundant_pic_cnt_present_flag) {
    sh.redundant_pic_cnt = readMappedUE(br, fieldMap, 'parseResult.redundant_pic_cnt', bitBase);
  }

  if (isB) {
    sh.direct_spatial_mv_pred_flag = readMappedBits(br, fieldMap, 'parseResult.direct_spatial_mv_pred_flag', 1, bitBase);
  }

  let numRefIdxL0ActiveMinus1 = pps ? pps.num_ref_idx_l0_default_active_minus1 : 0;
  let numRefIdxL1ActiveMinus1 = pps ? pps.num_ref_idx_l1_default_active_minus1 : 0;
  if (isP || isSP || isB) {
    sh.num_ref_idx_active_override_flag = readMappedBits(br, fieldMap, 'parseResult.num_ref_idx_active_override_flag', 1, bitBase);
    if (sh.num_ref_idx_active_override_flag) {
      numRefIdxL0ActiveMinus1 = readMappedUE(br, fieldMap, 'parseResult.num_ref_idx_l0_active_minus1', bitBase);
      if (isB) {
        numRefIdxL1ActiveMinus1 = readMappedUE(br, fieldMap, 'parseResult.num_ref_idx_l1_active_minus1', bitBase);
      }
    }
    sh.num_ref_idx_l0_active_minus1 = numRefIdxL0ActiveMinus1;
    if (isB) sh.num_ref_idx_l1_active_minus1 = numRefIdxL1ActiveMinus1;
  }

  parseH264RefPicListModification(br, fieldMap, bitBase, sh, isI, isSI, isB);

  if (pps && ((pps.weighted_pred_flag && (isP || isSP)) || (pps.weighted_bipred_idc === 1 && isB))) {
    parseH264PredWeightTable(br, fieldMap, bitBase, sh, sps, numRefIdxL0ActiveMinus1, numRefIdxL1ActiveMinus1, isB);
  }

  if (nalRefIdc !== 0) {
    parseH264DecRefPicMarking(br, fieldMap, bitBase, sh, nalType);
  }

  if (pps && pps.entropy_coding_mode_flag && !isI && !isSI) {
    sh.cabac_init_idc = readMappedUE(br, fieldMap, 'parseResult.cabac_init_idc', bitBase);
  }

  sh.slice_qp_delta = readMappedSE(br, fieldMap, 'parseResult.slice_qp_delta', bitBase);

  if (isSP || isSI) {
    if (isSP) {
      sh.sp_for_switch_flag = readMappedBits(br, fieldMap, 'parseResult.sp_for_switch_flag', 1, bitBase);
    }
    sh.slice_qs_delta = readMappedSE(br, fieldMap, 'parseResult.slice_qs_delta', bitBase);
  }

  if (pps && pps.deblocking_filter_control_present_flag) {
    sh.disable_deblocking_filter_idc = readMappedUE(br, fieldMap, 'parseResult.disable_deblocking_filter_idc', bitBase);
    if (sh.disable_deblocking_filter_idc !== 1) {
      sh.slice_alpha_c0_offset_div2 = readMappedSE(br, fieldMap, 'parseResult.slice_alpha_c0_offset_div2', bitBase);
      sh.slice_beta_offset_div2 = readMappedSE(br, fieldMap, 'parseResult.slice_beta_offset_div2', bitBase);
    }
  }

  if (pps && pps.num_slice_groups_minus1 > 0 && pps.slice_group_map_type >= 3 && pps.slice_group_map_type <= 5) {
    const cycleBits = getH264SliceGroupChangeCycleBits(sps, pps);
    if (cycleBits > 0) {
      sh.slice_group_change_cycle = readMappedBits(br, fieldMap, 'parseResult.slice_group_change_cycle', cycleBits, bitBase);
    }
  }

  sh.slice_header_bit_length = br.getBitPos();
  sh.slice_data_bit_offset = br.getBitPos();
  sh.temporal_id = 0;

  return sh;
}

function normalizeH264SliceType(sliceType) {
  return sliceType % 5;
}

function getH264ChromaArrayType(sps) {
  if (!sps) return 1;
  if (sps.separate_colour_plane_flag) return 0;
  return sps.chroma_format_idc == null ? 1 : sps.chroma_format_idc;
}

function parseH264RefPicListModification(br, fieldMap, bitBase, sh, isI, isSI, isB) {
  if (isI || isSI) return;
  const result = {};
  result.ref_pic_list_modification_flag_l0 = readMappedBits(br, fieldMap, 'parseResult.ref_pic_list_modification.ref_pic_list_modification_flag_l0', 1, bitBase);
  if (result.ref_pic_list_modification_flag_l0) {
    result.modifications_l0 = readH264RefPicListModifications(br, fieldMap, bitBase, 'l0');
  }

  if (isB) {
    result.ref_pic_list_modification_flag_l1 = readMappedBits(br, fieldMap, 'parseResult.ref_pic_list_modification.ref_pic_list_modification_flag_l1', 1, bitBase);
    if (result.ref_pic_list_modification_flag_l1) {
      result.modifications_l1 = readH264RefPicListModifications(br, fieldMap, bitBase, 'l1');
    }
  }
  sh.ref_pic_list_modification = result;
}

function readH264RefPicListModifications(br, fieldMap, bitBase, listName) {
  const modifications = [];
  for (let i = 0; i < 64 && br.moreRbspData(); i++) {
    const base = `parseResult.ref_pic_list_modification.modifications_${listName}[${i}]`;
    const op = {};
    op.modification_of_pic_nums_idc = readMappedUE(br, fieldMap, `${base}.modification_of_pic_nums_idc`, bitBase);
    if (op.modification_of_pic_nums_idc === 0 || op.modification_of_pic_nums_idc === 1) {
      op.abs_diff_pic_num_minus1 = readMappedUE(br, fieldMap, `${base}.abs_diff_pic_num_minus1`, bitBase);
    } else if (op.modification_of_pic_nums_idc === 2) {
      op.long_term_pic_num = readMappedUE(br, fieldMap, `${base}.long_term_pic_num`, bitBase);
    }
    modifications.push(op);
    if (op.modification_of_pic_nums_idc === 3) break;
  }
  return modifications;
}

function parseH264PredWeightTable(br, fieldMap, bitBase, sh, sps, numRefIdxL0ActiveMinus1, numRefIdxL1ActiveMinus1, isB) {
  const table = {};
  const chromaArrayType = getH264ChromaArrayType(sps);
  table.luma_log2_weight_denom = readMappedUE(br, fieldMap, 'parseResult.pred_weight_table.luma_log2_weight_denom', bitBase);
  if (chromaArrayType !== 0) {
    table.chroma_log2_weight_denom = readMappedUE(br, fieldMap, 'parseResult.pred_weight_table.chroma_log2_weight_denom', bitBase);
  }
  table.l0 = readH264WeightList(br, fieldMap, bitBase, 'l0', numRefIdxL0ActiveMinus1, chromaArrayType);
  if (isB) {
    table.l1 = readH264WeightList(br, fieldMap, bitBase, 'l1', numRefIdxL1ActiveMinus1, chromaArrayType);
  }
  sh.pred_weight_table = table;
}

function readH264WeightList(br, fieldMap, bitBase, listName, numRefIdxActiveMinus1, chromaArrayType) {
  const entries = [];
  for (let i = 0; i <= numRefIdxActiveMinus1; i++) {
    const base = `parseResult.pred_weight_table.${listName}[${i}]`;
    const entry = {};
    entry[`luma_weight_${listName}_flag`] = readMappedBits(br, fieldMap, `${base}.luma_weight_${listName}_flag`, 1, bitBase);
    if (entry[`luma_weight_${listName}_flag`]) {
      entry[`luma_weight_${listName}`] = readMappedSE(br, fieldMap, `${base}.luma_weight_${listName}`, bitBase);
      entry[`luma_offset_${listName}`] = readMappedSE(br, fieldMap, `${base}.luma_offset_${listName}`, bitBase);
    }
    if (chromaArrayType !== 0) {
      entry[`chroma_weight_${listName}_flag`] = readMappedBits(br, fieldMap, `${base}.chroma_weight_${listName}_flag`, 1, bitBase);
      if (entry[`chroma_weight_${listName}_flag`]) {
        entry[`chroma_weight_${listName}`] = [];
        entry[`chroma_offset_${listName}`] = [];
        for (let j = 0; j < 2; j++) {
          entry[`chroma_weight_${listName}`].push(readMappedSE(br, fieldMap, `${base}.chroma_weight_${listName}[${j}]`, bitBase));
          entry[`chroma_offset_${listName}`].push(readMappedSE(br, fieldMap, `${base}.chroma_offset_${listName}[${j}]`, bitBase));
        }
      }
    }
    entries.push(entry);
  }
  return entries;
}

function parseH264DecRefPicMarking(br, fieldMap, bitBase, sh, nalType) {
  const marking = {};
  if (nalType === 5) {
    marking.no_output_of_prior_pics_flag = readMappedBits(br, fieldMap, 'parseResult.dec_ref_pic_marking.no_output_of_prior_pics_flag', 1, bitBase);
    marking.long_term_reference_flag = readMappedBits(br, fieldMap, 'parseResult.dec_ref_pic_marking.long_term_reference_flag', 1, bitBase);
  } else {
    marking.adaptive_ref_pic_marking_mode_flag = readMappedBits(br, fieldMap, 'parseResult.dec_ref_pic_marking.adaptive_ref_pic_marking_mode_flag', 1, bitBase);
    if (marking.adaptive_ref_pic_marking_mode_flag) {
      marking.memory_management_control_operations = [];
      for (let i = 0; i < 64 && br.moreRbspData(); i++) {
        const base = `parseResult.dec_ref_pic_marking.memory_management_control_operations[${i}]`;
        const op = {};
        op.memory_management_control_operation = readMappedUE(br, fieldMap, `${base}.memory_management_control_operation`, bitBase);
        if (op.memory_management_control_operation === 1 || op.memory_management_control_operation === 3) {
          op.difference_of_pic_nums_minus1 = readMappedUE(br, fieldMap, `${base}.difference_of_pic_nums_minus1`, bitBase);
        }
        if (op.memory_management_control_operation === 2) {
          op.long_term_pic_num = readMappedUE(br, fieldMap, `${base}.long_term_pic_num`, bitBase);
        }
        if (op.memory_management_control_operation === 3 || op.memory_management_control_operation === 6) {
          op.long_term_frame_idx = readMappedUE(br, fieldMap, `${base}.long_term_frame_idx`, bitBase);
        }
        if (op.memory_management_control_operation === 4) {
          op.max_long_term_frame_idx_plus1 = readMappedUE(br, fieldMap, `${base}.max_long_term_frame_idx_plus1`, bitBase);
        }
        marking.memory_management_control_operations.push(op);
        if (op.memory_management_control_operation === 0) break;
      }
    }
  }
  sh.dec_ref_pic_marking = marking;
}

function getH264SliceGroupChangeCycleBits(sps, pps) {
  if (!sps || !pps || pps.slice_group_change_rate_minus1 == null) return 0;
  const picSizeInMapUnits = (sps.pic_width_in_mbs_minus1 + 1) * (sps.pic_height_in_map_units_minus1 + 1);
  const sliceGroupChangeRate = pps.slice_group_change_rate_minus1 + 1;
  return Math.ceil(Math.log2(Math.ceil(picSizeInMapUnits / sliceGroupChangeRate) + 1));
}

function h265ProfileMatches(profileIdc, compatibilityFlags, profileIds) {
  return profileIds.some(profileId => profileIdc === profileId || compatibilityFlags[profileId]);
}

function parseH265PTL(br, maxSubLayersMinus1, fieldMap = null, bitBase = 16, pathPrefix = 'parseResult.profile_tier_level') {
  const ptl = {};
  ptl.general_profile_space = readMappedBits(br, fieldMap, `${pathPrefix}.general_profile_space`, 2, bitBase);
  ptl.general_tier_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_tier_flag`, 1, bitBase);
  ptl.general_profile_idc = readMappedBits(br, fieldMap, `${pathPrefix}.general_profile_idc`, 5, bitBase);
  ptl.general_profile_compatibility_flag = [];
  for (let i = 0; i < 32; i++) {
    ptl.general_profile_compatibility_flag[i] = readMappedBits(br, fieldMap, `${pathPrefix}.general_profile_compatibility_flag[${i}]`, 1, bitBase, `general_profile_compatibility_flag[${i}]`);
  }
  ptl.general_progressive_source_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_progressive_source_flag`, 1, bitBase);
  ptl.general_interlaced_source_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_interlaced_source_flag`, 1, bitBase);
  ptl.general_non_packed_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_non_packed_constraint_flag`, 1, bitBase);
  ptl.general_frame_only_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_frame_only_constraint_flag`, 1, bitBase);

  if (h265ProfileMatches(ptl.general_profile_idc, ptl.general_profile_compatibility_flag, [4, 5, 6, 7, 8, 9, 10, 11])) {
    ptl.general_max_12bit_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_max_12bit_constraint_flag`, 1, bitBase);
    ptl.general_max_10bit_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_max_10bit_constraint_flag`, 1, bitBase);
    ptl.general_max_8bit_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_max_8bit_constraint_flag`, 1, bitBase);
    ptl.general_max_422chroma_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_max_422chroma_constraint_flag`, 1, bitBase);
    ptl.general_max_420chroma_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_max_420chroma_constraint_flag`, 1, bitBase);
    ptl.general_max_monochrome_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_max_monochrome_constraint_flag`, 1, bitBase);
    ptl.general_intra_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_intra_constraint_flag`, 1, bitBase);
    ptl.general_one_picture_only_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_one_picture_only_constraint_flag`, 1, bitBase);
    ptl.general_lower_bit_rate_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_lower_bit_rate_constraint_flag`, 1, bitBase);
    if (h265ProfileMatches(ptl.general_profile_idc, ptl.general_profile_compatibility_flag, [5, 9, 10, 11])) {
      ptl.general_max_14bit_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_max_14bit_constraint_flag`, 1, bitBase);
      readMappedBits(br, fieldMap, `${pathPrefix}.general_reserved_zero_33bits`, 33, bitBase);
    } else {
      readMappedBits(br, fieldMap, `${pathPrefix}.general_reserved_zero_34bits`, 34, bitBase);
    }
  } else if (h265ProfileMatches(ptl.general_profile_idc, ptl.general_profile_compatibility_flag, [2])) {
    readMappedBits(br, fieldMap, `${pathPrefix}.general_reserved_zero_7bits`, 7, bitBase);
    ptl.general_one_picture_only_constraint_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_one_picture_only_constraint_flag`, 1, bitBase);
    readMappedBits(br, fieldMap, `${pathPrefix}.general_reserved_zero_35bits`, 35, bitBase);
  } else {
    readMappedBits(br, fieldMap, `${pathPrefix}.general_reserved_zero_43bits`, 43, bitBase);
  }

  if (h265ProfileMatches(ptl.general_profile_idc, ptl.general_profile_compatibility_flag, [1, 2, 3, 4, 5, 9, 11])) {
    ptl.general_inbld_flag = readMappedBits(br, fieldMap, `${pathPrefix}.general_inbld_flag`, 1, bitBase);
  } else {
    readMappedBits(br, fieldMap, `${pathPrefix}.general_reserved_zero_bit`, 1, bitBase);
  }

  ptl.general_level_idc = readMappedBits(br, fieldMap, `${pathPrefix}.general_level_idc`, 8, bitBase);

  ptl.sub_layer_profile_present_flag = [];
  ptl.sub_layer_level_present_flag = [];
  for (let i = 0; i < maxSubLayersMinus1; i++) {
    ptl.sub_layer_profile_present_flag.push(readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_profile_present_flag[${i}]`, 1, bitBase, `sub_layer_profile_present_flag[${i}]`));
    ptl.sub_layer_level_present_flag.push(readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_level_present_flag[${i}]`, 1, bitBase, `sub_layer_level_present_flag[${i}]`));
  }

  if (maxSubLayersMinus1 > 0) {
    for (let i = maxSubLayersMinus1; i < 8; i++) {
      readMappedBits(br, fieldMap, `${pathPrefix}.reserved_zero_2bits[${i}]`, 2, bitBase, `reserved_zero_2bits[${i}]`);
    }
  }

  for (let i = 0; i < maxSubLayersMinus1; i++) {
    if (ptl.sub_layer_profile_present_flag[i]) {
      ptl.sub_layer_profile_space = ptl.sub_layer_profile_space || [];
      ptl.sub_layer_tier_flag = ptl.sub_layer_tier_flag || [];
      ptl.sub_layer_profile_idc = ptl.sub_layer_profile_idc || [];
      ptl.sub_layer_profile_compatibility_flag = ptl.sub_layer_profile_compatibility_flag || [];
      ptl.sub_layer_profile_space[i] = readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_profile_space[${i}]`, 2, bitBase, `sub_layer_profile_space[${i}]`);
      ptl.sub_layer_tier_flag[i] = readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_tier_flag[${i}]`, 1, bitBase, `sub_layer_tier_flag[${i}]`);
      const subProfileIdc = readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_profile_idc[${i}]`, 5, bitBase, `sub_layer_profile_idc[${i}]`);
      ptl.sub_layer_profile_idc[i] = subProfileIdc;
      const subCompatFlags = [];
      for (let j = 0; j < 32; j++) {
        subCompatFlags[j] = readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_profile_compatibility_flag[${i}][${j}]`, 1, bitBase, `sub_layer_profile_compatibility_flag[${i}][${j}]`);
      }
      ptl.sub_layer_profile_compatibility_flag[i] = subCompatFlags;
      readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_progressive_source_flag[${i}]`, 1, bitBase, `sub_layer_progressive_source_flag[${i}]`);
      readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_interlaced_source_flag[${i}]`, 1, bitBase, `sub_layer_interlaced_source_flag[${i}]`);
      readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_non_packed_constraint_flag[${i}]`, 1, bitBase, `sub_layer_non_packed_constraint_flag[${i}]`);
      readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_frame_only_constraint_flag[${i}]`, 1, bitBase, `sub_layer_frame_only_constraint_flag[${i}]`);

      if (h265ProfileMatches(subProfileIdc, subCompatFlags, [4, 5, 6, 7, 8, 9, 10, 11])) {
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_max_12bit_constraint_flag[${i}]`, 1, bitBase, `sub_layer_max_12bit_constraint_flag[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_max_10bit_constraint_flag[${i}]`, 1, bitBase, `sub_layer_max_10bit_constraint_flag[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_max_8bit_constraint_flag[${i}]`, 1, bitBase, `sub_layer_max_8bit_constraint_flag[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_max_422chroma_constraint_flag[${i}]`, 1, bitBase, `sub_layer_max_422chroma_constraint_flag[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_max_420chroma_constraint_flag[${i}]`, 1, bitBase, `sub_layer_max_420chroma_constraint_flag[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_max_monochrome_constraint_flag[${i}]`, 1, bitBase, `sub_layer_max_monochrome_constraint_flag[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_intra_constraint_flag[${i}]`, 1, bitBase, `sub_layer_intra_constraint_flag[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_one_picture_only_constraint_flag[${i}]`, 1, bitBase, `sub_layer_one_picture_only_constraint_flag[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_lower_bit_rate_constraint_flag[${i}]`, 1, bitBase, `sub_layer_lower_bit_rate_constraint_flag[${i}]`);
        if (h265ProfileMatches(subProfileIdc, subCompatFlags, [5, 9, 10, 11])) {
          readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_max_14bit_constraint_flag[${i}]`, 1, bitBase, `sub_layer_max_14bit_constraint_flag[${i}]`);
          readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_reserved_zero_33bits[${i}]`, 33, bitBase, `sub_layer_reserved_zero_33bits[${i}]`);
        } else {
          readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_reserved_zero_34bits[${i}]`, 34, bitBase, `sub_layer_reserved_zero_34bits[${i}]`);
        }
      } else if (h265ProfileMatches(subProfileIdc, subCompatFlags, [2])) {
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_reserved_zero_7bits[${i}]`, 7, bitBase, `sub_layer_reserved_zero_7bits[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_one_picture_only_constraint_flag[${i}]`, 1, bitBase, `sub_layer_one_picture_only_constraint_flag[${i}]`);
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_reserved_zero_35bits[${i}]`, 35, bitBase, `sub_layer_reserved_zero_35bits[${i}]`);
      } else {
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_reserved_zero_43bits[${i}]`, 43, bitBase, `sub_layer_reserved_zero_43bits[${i}]`);
      }

      if (h265ProfileMatches(subProfileIdc, subCompatFlags, [1, 2, 3, 4, 5, 9, 11])) {
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_inbld_flag[${i}]`, 1, bitBase, `sub_layer_inbld_flag[${i}]`);
      } else {
        readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_reserved_zero_bit[${i}]`, 1, bitBase, `sub_layer_reserved_zero_bit[${i}]`);
      }
    }
    if (ptl.sub_layer_level_present_flag[i]) {
      readMappedBits(br, fieldMap, `${pathPrefix}.sub_layer_level_idc[${i}]`, 8, bitBase, `sub_layer_level_idc[${i}]`);
    }
  }

  return ptl;
}

/* ===================================================================
 *  H.265 VPS Parser (H.265 §7.3.2.1)
 * =================================================================== */
function parseH265VPS(rbsp, fieldMap = null, bitBase = 16) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const vps = {};

  vps.vps_video_parameter_set_id = readMappedBits(br, fieldMap, 'parseResult.vps_video_parameter_set_id', 4, bitBase);
  vps.vps_base_layer_internal_flag = readMappedBits(br, fieldMap, 'parseResult.vps_base_layer_internal_flag', 1, bitBase);
  vps.vps_base_layer_available_flag = readMappedBits(br, fieldMap, 'parseResult.vps_base_layer_available_flag', 1, bitBase);
  vps.vps_max_layers_minus1 = readMappedBits(br, fieldMap, 'parseResult.vps_max_layers_minus1', 6, bitBase);
  vps.vps_max_sub_layers_minus1 = readMappedBits(br, fieldMap, 'parseResult.vps_max_sub_layers_minus1', 3, bitBase);
  vps.vps_temporal_id_nesting_flag = readMappedBits(br, fieldMap, 'parseResult.vps_temporal_id_nesting_flag', 1, bitBase);
  vps.vps_reserved_0xffff_16bits = readMappedBits(br, fieldMap, 'parseResult.vps_reserved_0xffff_16bits', 16, bitBase);

  vps.profile_tier_level = parseH265PTL(br, vps.vps_max_sub_layers_minus1, fieldMap, bitBase, 'parseResult.profile_tier_level');

  vps.vps_sub_layer_ordering_info_present_flag = readMappedBits(br, fieldMap, 'parseResult.vps_sub_layer_ordering_info_present_flag', 1, bitBase);
  const firstOrderingLayer = vps.vps_sub_layer_ordering_info_present_flag ? 0 : vps.vps_max_sub_layers_minus1;
  vps.vps_max_dec_pic_buffering_minus1 = [];
  vps.vps_max_num_reorder_pics = [];
  vps.vps_max_latency_increase_plus1 = [];
  for (let i = firstOrderingLayer; i <= vps.vps_max_sub_layers_minus1; i++) {
    vps.vps_max_dec_pic_buffering_minus1[i] = readMappedUE(br, fieldMap, `parseResult.vps_max_dec_pic_buffering_minus1[${i}]`, bitBase, `vps_max_dec_pic_buffering_minus1[${i}]`);
    vps.vps_max_num_reorder_pics[i] = readMappedUE(br, fieldMap, `parseResult.vps_max_num_reorder_pics[${i}]`, bitBase, `vps_max_num_reorder_pics[${i}]`);
    vps.vps_max_latency_increase_plus1[i] = readMappedUE(br, fieldMap, `parseResult.vps_max_latency_increase_plus1[${i}]`, bitBase, `vps_max_latency_increase_plus1[${i}]`);
  }

  vps.vps_max_layer_id = readMappedBits(br, fieldMap, 'parseResult.vps_max_layer_id', 6, bitBase);
  vps.vps_num_layer_sets_minus1 = readMappedUE(br, fieldMap, 'parseResult.vps_num_layer_sets_minus1', bitBase);
  vps.layer_id_included_flag = [];
  for (let i = 1; i <= vps.vps_num_layer_sets_minus1; i++) {
    vps.layer_id_included_flag[i] = [];
    for (let j = 0; j <= vps.vps_max_layer_id; j++) {
      vps.layer_id_included_flag[i][j] = readMappedBits(br, fieldMap, `parseResult.layer_id_included_flag[${i}][${j}]`, 1, bitBase, `layer_id_included_flag[${i}][${j}]`);
    }
  }

  vps.vps_timing_info_present_flag = readMappedBits(br, fieldMap, 'parseResult.vps_timing_info_present_flag', 1, bitBase);
  if (vps.vps_timing_info_present_flag) {
    vps.vps_num_units_in_tick = readMappedBits(br, fieldMap, 'parseResult.vps_num_units_in_tick', 32, bitBase);
    vps.vps_time_scale = readMappedBits(br, fieldMap, 'parseResult.vps_time_scale', 32, bitBase);
    vps.vps_poc_proportional_to_timing_flag = readMappedBits(br, fieldMap, 'parseResult.vps_poc_proportional_to_timing_flag', 1, bitBase);
    if (vps.vps_poc_proportional_to_timing_flag) {
      vps.vps_num_ticks_poc_diff_one_minus1 = readMappedUE(br, fieldMap, 'parseResult.vps_num_ticks_poc_diff_one_minus1', bitBase);
    }
    vps.vps_num_hrd_parameters = readMappedUE(br, fieldMap, 'parseResult.vps_num_hrd_parameters', bitBase);
    vps.hrd_layer_set_idx = [];
    vps.cprms_present_flag = [];
    vps.hrd_parameters = [];
    for (let i = 0; i < vps.vps_num_hrd_parameters; i++) {
      vps.hrd_layer_set_idx[i] = readMappedUE(br, fieldMap, `parseResult.hrd_layer_set_idx[${i}]`, bitBase, `hrd_layer_set_idx[${i}]`);
      vps.cprms_present_flag[i] = i === 0 ? 1 : readMappedBits(br, fieldMap, `parseResult.cprms_present_flag[${i}]`, 1, bitBase, `cprms_present_flag[${i}]`);
      vps.hrd_parameters[i] = parseH265HRDParameters(
        br,
        vps.cprms_present_flag[i],
        vps.vps_max_sub_layers_minus1,
        fieldMap,
        bitBase,
        `parseResult.hrd_parameters[${i}]`
      );
    }
  }

  vps.vps_extension_flag = readMappedBits(br, fieldMap, 'parseResult.vps_extension_flag', 1, bitBase);
  if (vps.vps_extension_flag) {
    vps.vps_extension_data_flag = [];
    for (let i = 0; br.moreRbspData() && i < 4096; i++) {
      vps.vps_extension_data_flag.push(readMappedBits(br, fieldMap, `parseResult.vps_extension_data_flag[${i}]`, 1, bitBase, `vps_extension_data_flag[${i}]`));
    }
  }

  return vps;
}

function parseH265HRDParameters(br, commonInfPresentFlag, maxNumSubLayersMinus1, fieldMap = null, bitBase = 16, pathPrefix = 'parseResult.hrd_parameters') {
  const hrd = {};
  if (commonInfPresentFlag) {
    hrd.nal_hrd_parameters_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.nal_hrd_parameters_present_flag`, 1, bitBase);
    hrd.vcl_hrd_parameters_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.vcl_hrd_parameters_present_flag`, 1, bitBase);
    if (hrd.nal_hrd_parameters_present_flag || hrd.vcl_hrd_parameters_present_flag) {
      hrd.sub_pic_hrd_params_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.sub_pic_hrd_params_present_flag`, 1, bitBase);
      if (hrd.sub_pic_hrd_params_present_flag) {
        hrd.tick_divisor_minus2 = readMappedBits(br, fieldMap, `${pathPrefix}.tick_divisor_minus2`, 8, bitBase);
        hrd.du_cpb_removal_delay_increment_length_minus1 = readMappedBits(br, fieldMap, `${pathPrefix}.du_cpb_removal_delay_increment_length_minus1`, 5, bitBase);
        hrd.sub_pic_cpb_params_in_pic_timing_sei_flag = readMappedBits(br, fieldMap, `${pathPrefix}.sub_pic_cpb_params_in_pic_timing_sei_flag`, 1, bitBase);
        hrd.dpb_output_delay_du_length_minus1 = readMappedBits(br, fieldMap, `${pathPrefix}.dpb_output_delay_du_length_minus1`, 5, bitBase);
      }
      hrd.bit_rate_scale = readMappedBits(br, fieldMap, `${pathPrefix}.bit_rate_scale`, 4, bitBase);
      hrd.cpb_size_scale = readMappedBits(br, fieldMap, `${pathPrefix}.cpb_size_scale`, 4, bitBase);
      if (hrd.sub_pic_hrd_params_present_flag) {
        hrd.cpb_size_du_scale = readMappedBits(br, fieldMap, `${pathPrefix}.cpb_size_du_scale`, 4, bitBase);
      }
      hrd.initial_cpb_removal_delay_length_minus1 = readMappedBits(br, fieldMap, `${pathPrefix}.initial_cpb_removal_delay_length_minus1`, 5, bitBase);
      hrd.au_cpb_removal_delay_length_minus1 = readMappedBits(br, fieldMap, `${pathPrefix}.au_cpb_removal_delay_length_minus1`, 5, bitBase);
      hrd.dpb_output_delay_length_minus1 = readMappedBits(br, fieldMap, `${pathPrefix}.dpb_output_delay_length_minus1`, 5, bitBase);
    }
  }

  hrd.fixed_pic_rate_general_flag = [];
  hrd.fixed_pic_rate_within_cvs_flag = [];
  hrd.elemental_duration_in_tc_minus1 = [];
  hrd.low_delay_hrd_flag = [];
  hrd.cpb_cnt_minus1 = [];
  hrd.nal_sub_layer_hrd_parameters = [];
  hrd.vcl_sub_layer_hrd_parameters = [];

  for (let i = 0; i <= maxNumSubLayersMinus1; i++) {
    hrd.fixed_pic_rate_general_flag[i] = readMappedBits(br, fieldMap, `${pathPrefix}.fixed_pic_rate_general_flag[${i}]`, 1, bitBase, `fixed_pic_rate_general_flag[${i}]`);
    if (!hrd.fixed_pic_rate_general_flag[i]) {
      hrd.fixed_pic_rate_within_cvs_flag[i] = readMappedBits(br, fieldMap, `${pathPrefix}.fixed_pic_rate_within_cvs_flag[${i}]`, 1, bitBase, `fixed_pic_rate_within_cvs_flag[${i}]`);
    } else {
      hrd.fixed_pic_rate_within_cvs_flag[i] = 1;
    }
    if (hrd.fixed_pic_rate_within_cvs_flag[i]) {
      hrd.elemental_duration_in_tc_minus1[i] = readMappedUE(br, fieldMap, `${pathPrefix}.elemental_duration_in_tc_minus1[${i}]`, bitBase, `elemental_duration_in_tc_minus1[${i}]`);
      hrd.low_delay_hrd_flag[i] = 0;
    } else {
      hrd.low_delay_hrd_flag[i] = readMappedBits(br, fieldMap, `${pathPrefix}.low_delay_hrd_flag[${i}]`, 1, bitBase, `low_delay_hrd_flag[${i}]`);
    }
    if (!hrd.low_delay_hrd_flag[i]) {
      hrd.cpb_cnt_minus1[i] = readMappedUE(br, fieldMap, `${pathPrefix}.cpb_cnt_minus1[${i}]`, bitBase, `cpb_cnt_minus1[${i}]`);
    } else {
      hrd.cpb_cnt_minus1[i] = 0;
    }
    if (hrd.nal_hrd_parameters_present_flag) {
      hrd.nal_sub_layer_hrd_parameters[i] = parseH265SubLayerHRDParameters(br, hrd.cpb_cnt_minus1[i], hrd.sub_pic_hrd_params_present_flag, fieldMap, bitBase, `${pathPrefix}.nal_sub_layer_hrd_parameters[${i}]`);
    }
    if (hrd.vcl_hrd_parameters_present_flag) {
      hrd.vcl_sub_layer_hrd_parameters[i] = parseH265SubLayerHRDParameters(br, hrd.cpb_cnt_minus1[i], hrd.sub_pic_hrd_params_present_flag, fieldMap, bitBase, `${pathPrefix}.vcl_sub_layer_hrd_parameters[${i}]`);
    }
  }

  return hrd;
}

function parseH265SubLayerHRDParameters(br, cpbCntMinus1, subPicHrdParamsPresentFlag, fieldMap, bitBase, pathPrefix) {
  const params = {
    bit_rate_value_minus1: [],
    cpb_size_value_minus1: [],
    cbr_flag: []
  };
  if (subPicHrdParamsPresentFlag) {
    params.cpb_size_du_value_minus1 = [];
    params.bit_rate_du_value_minus1 = [];
  }

  for (let i = 0; i <= cpbCntMinus1; i++) {
    params.bit_rate_value_minus1[i] = readMappedUE(br, fieldMap, `${pathPrefix}.bit_rate_value_minus1[${i}]`, bitBase, `bit_rate_value_minus1[${i}]`);
    params.cpb_size_value_minus1[i] = readMappedUE(br, fieldMap, `${pathPrefix}.cpb_size_value_minus1[${i}]`, bitBase, `cpb_size_value_minus1[${i}]`);
    if (subPicHrdParamsPresentFlag) {
      params.cpb_size_du_value_minus1[i] = readMappedUE(br, fieldMap, `${pathPrefix}.cpb_size_du_value_minus1[${i}]`, bitBase, `cpb_size_du_value_minus1[${i}]`);
      params.bit_rate_du_value_minus1[i] = readMappedUE(br, fieldMap, `${pathPrefix}.bit_rate_du_value_minus1[${i}]`, bitBase, `bit_rate_du_value_minus1[${i}]`);
    }
    params.cbr_flag[i] = readMappedBits(br, fieldMap, `${pathPrefix}.cbr_flag[${i}]`, 1, bitBase, `cbr_flag[${i}]`);
  }

  return params;
}

/* ===================================================================
 *  H.265 SPS Parser (H.265 §7.3.2.2)
 * =================================================================== */
function parseH265SPS(rbsp, fieldMap = null, bitBase = 16) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const sps = {};

  sps.sps_video_parameter_set_id = readMappedBits(br, fieldMap, 'parseResult.sps_video_parameter_set_id', 4, bitBase);
  sps.sps_max_sub_layers_minus1 = readMappedBits(br, fieldMap, 'parseResult.sps_max_sub_layers_minus1', 3, bitBase);
  sps.sps_temporal_id_nesting_flag = readMappedBits(br, fieldMap, 'parseResult.sps_temporal_id_nesting_flag', 1, bitBase);

  sps.profile_tier_level = parseH265PTL(br, sps.sps_max_sub_layers_minus1, fieldMap, bitBase, 'parseResult.profile_tier_level');

  sps.sps_seq_parameter_set_id = readMappedUE(br, fieldMap, 'parseResult.sps_seq_parameter_set_id', bitBase);
  sps.chroma_format_idc = readMappedUE(br, fieldMap, 'parseResult.chroma_format_idc', bitBase);

  if (sps.chroma_format_idc === 3) {
    sps.separate_colour_plane_flag = readMappedBits(br, fieldMap, 'parseResult.separate_colour_plane_flag', 1, bitBase);
  }

  sps.pic_width_in_luma_samples = readMappedUE(br, fieldMap, 'parseResult.pic_width_in_luma_samples', bitBase);
  sps.pic_height_in_luma_samples = readMappedUE(br, fieldMap, 'parseResult.pic_height_in_luma_samples', bitBase);

  sps.conformance_window_flag = readMappedBits(br, fieldMap, 'parseResult.conformance_window_flag', 1, bitBase);
  if (sps.conformance_window_flag) {
    sps.conf_win_left_offset = readMappedUE(br, fieldMap, 'parseResult.conf_win_left_offset', bitBase);
    sps.conf_win_right_offset = readMappedUE(br, fieldMap, 'parseResult.conf_win_right_offset', bitBase);
    sps.conf_win_top_offset = readMappedUE(br, fieldMap, 'parseResult.conf_win_top_offset', bitBase);
    sps.conf_win_bottom_offset = readMappedUE(br, fieldMap, 'parseResult.conf_win_bottom_offset', bitBase);
  }

  sps.bit_depth_luma_minus8 = readMappedUE(br, fieldMap, 'parseResult.bit_depth_luma_minus8', bitBase);
  sps.bit_depth_chroma_minus8 = readMappedUE(br, fieldMap, 'parseResult.bit_depth_chroma_minus8', bitBase);
  sps.log2_max_pic_order_cnt_lsb_minus4 = readMappedUE(br, fieldMap, 'parseResult.log2_max_pic_order_cnt_lsb_minus4', bitBase);

  sps.sps_sub_layer_ordering_info_present_flag = readMappedBits(br, fieldMap, 'parseResult.sps_sub_layer_ordering_info_present_flag', 1, bitBase);
  const numLayers = sps.sps_sub_layer_ordering_info_present_flag ? sps.sps_max_sub_layers_minus1 : 0;
  sps.sps_max_dec_pic_buffering_minus1 = [];
  sps.sps_max_num_reorder_pics = [];
  sps.sps_max_latency_increase_plus1 = [];
  for (let i = numLayers; i <= sps.sps_max_sub_layers_minus1; i++) {
    sps.sps_max_dec_pic_buffering_minus1[i] = readMappedUE(br, fieldMap, `parseResult.sps_max_dec_pic_buffering_minus1[${i}]`, bitBase, `sps_max_dec_pic_buffering_minus1[${i}]`);
    sps.sps_max_num_reorder_pics[i] = readMappedUE(br, fieldMap, `parseResult.sps_max_num_reorder_pics[${i}]`, bitBase, `sps_max_num_reorder_pics[${i}]`);
    sps.sps_max_latency_increase_plus1[i] = readMappedUE(br, fieldMap, `parseResult.sps_max_latency_increase_plus1[${i}]`, bitBase, `sps_max_latency_increase_plus1[${i}]`);
  }

  sps.log2_min_luma_coding_block_size_minus3 = readMappedUE(br, fieldMap, 'parseResult.log2_min_luma_coding_block_size_minus3', bitBase);
  sps.log2_diff_max_min_luma_coding_block_size = readMappedUE(br, fieldMap, 'parseResult.log2_diff_max_min_luma_coding_block_size', bitBase);
  sps.log2_min_luma_transform_block_size_minus2 = readMappedUE(br, fieldMap, 'parseResult.log2_min_luma_transform_block_size_minus2', bitBase);
  sps.log2_diff_max_min_luma_transform_block_size = readMappedUE(br, fieldMap, 'parseResult.log2_diff_max_min_luma_transform_block_size', bitBase);
  sps.max_transform_hierarchy_depth_inter = readMappedUE(br, fieldMap, 'parseResult.max_transform_hierarchy_depth_inter', bitBase);
  sps.max_transform_hierarchy_depth_intra = readMappedUE(br, fieldMap, 'parseResult.max_transform_hierarchy_depth_intra', bitBase);

  sps.scaling_list_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.scaling_list_enabled_flag', 1, bitBase);
  if (sps.scaling_list_enabled_flag) {
    sps.sps_scaling_list_data_present_flag = readMappedBits(br, fieldMap, 'parseResult.sps_scaling_list_data_present_flag', 1, bitBase);
    if (sps.sps_scaling_list_data_present_flag) {
      sps.scaling_list_data = parseH265ScalingListData(br, fieldMap, bitBase, 'parseResult.scaling_list_data');
    }
  }

  sps.amp_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.amp_enabled_flag', 1, bitBase);
  sps.sample_adaptive_offset_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.sample_adaptive_offset_enabled_flag', 1, bitBase);
  sps.pcm_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.pcm_enabled_flag', 1, bitBase);

  if (sps.pcm_enabled_flag) {
    sps.pcm_sample_bit_depth_luma_minus1 = readMappedBits(br, fieldMap, 'parseResult.pcm_sample_bit_depth_luma_minus1', 4, bitBase);
    sps.pcm_sample_bit_depth_chroma_minus1 = readMappedBits(br, fieldMap, 'parseResult.pcm_sample_bit_depth_chroma_minus1', 4, bitBase);
    sps.log2_min_pcm_luma_coding_block_size_minus3 = readMappedUE(br, fieldMap, 'parseResult.log2_min_pcm_luma_coding_block_size_minus3', bitBase);
    sps.log2_diff_max_min_pcm_luma_coding_block_size = readMappedUE(br, fieldMap, 'parseResult.log2_diff_max_min_pcm_luma_coding_block_size', bitBase);
    sps.pcm_loop_filter_disabled_flag = readMappedBits(br, fieldMap, 'parseResult.pcm_loop_filter_disabled_flag', 1, bitBase);
  }

  sps.num_short_term_ref_pic_sets = readMappedUE(br, fieldMap, 'parseResult.num_short_term_ref_pic_sets', bitBase);
  // Skip short-term ref pic sets (complex interleaved structure)
  sps.short_term_ref_pic_sets = [];
  for (let i = 0; i < sps.num_short_term_ref_pic_sets; i++) {
    sps.short_term_ref_pic_sets.push(parseH265StRefPicSet(br, i, sps.num_short_term_ref_pic_sets, sps.short_term_ref_pic_sets, fieldMap, bitBase, `parseResult.short_term_ref_pic_sets[${i}]`));
  }

  sps.long_term_ref_pics_present_flag = readMappedBits(br, fieldMap, 'parseResult.long_term_ref_pics_present_flag', 1, bitBase);
  if (sps.long_term_ref_pics_present_flag) {
    sps.num_long_term_ref_pics_sps = readMappedUE(br, fieldMap, 'parseResult.num_long_term_ref_pics_sps', bitBase);
    sps.lt_ref_pic_poc_lsb_sps = [];
    sps.used_by_curr_pic_lt_sps_flag = [];
    for (let i = 0; i < sps.num_long_term_ref_pics_sps; i++) {
      sps.lt_ref_pic_poc_lsb_sps.push(readMappedBits(br, fieldMap, `parseResult.lt_ref_pic_poc_lsb_sps[${i}]`, sps.log2_max_pic_order_cnt_lsb_minus4 + 4, bitBase, `lt_ref_pic_poc_lsb_sps[${i}]`));
      sps.used_by_curr_pic_lt_sps_flag.push(readMappedBits(br, fieldMap, `parseResult.used_by_curr_pic_lt_sps_flag[${i}]`, 1, bitBase, `used_by_curr_pic_lt_sps_flag[${i}]`));
    }
  }

  sps.sps_temporal_mvp_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.sps_temporal_mvp_enabled_flag', 1, bitBase);
  sps.strong_intra_smoothing_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.strong_intra_smoothing_enabled_flag', 1, bitBase);

  sps.vui_parameters_present_flag = readMappedBits(br, fieldMap, 'parseResult.vui_parameters_present_flag', 1, bitBase);
  if (sps.vui_parameters_present_flag) {
    sps.vui = parseH265VUI(br, sps, fieldMap, bitBase);
  }

  if (br.moreRbspData()) {
    sps.sps_extension_present_flag = readMappedBits(br, fieldMap, 'parseResult.sps_extension_present_flag', 1, bitBase);
    if (sps.sps_extension_present_flag) {
      sps.sps_range_extension_flag = readMappedBits(br, fieldMap, 'parseResult.sps_range_extension_flag', 1, bitBase);
      sps.sps_multilayer_extension_flag = readMappedBits(br, fieldMap, 'parseResult.sps_multilayer_extension_flag', 1, bitBase);
      sps.sps_3d_extension_flag = readMappedBits(br, fieldMap, 'parseResult.sps_3d_extension_flag', 1, bitBase);
      sps.sps_scc_extension_flag = readMappedBits(br, fieldMap, 'parseResult.sps_scc_extension_flag', 1, bitBase);
      sps.sps_extension_4bits = readMappedBits(br, fieldMap, 'parseResult.sps_extension_4bits', 4, bitBase);
      if (sps.sps_range_extension_flag) {
        sps.transform_skip_rotation_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.transform_skip_rotation_enabled_flag', 1, bitBase);
        sps.transform_skip_context_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.transform_skip_context_enabled_flag', 1, bitBase);
        sps.implicit_rdpcm_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.implicit_rdpcm_enabled_flag', 1, bitBase);
        sps.explicit_rdpcm_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.explicit_rdpcm_enabled_flag', 1, bitBase);
        sps.extended_precision_processing_flag = readMappedBits(br, fieldMap, 'parseResult.extended_precision_processing_flag', 1, bitBase);
        sps.intra_smoothing_disabled_flag = readMappedBits(br, fieldMap, 'parseResult.intra_smoothing_disabled_flag', 1, bitBase);
        sps.high_precision_offsets_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.high_precision_offsets_enabled_flag', 1, bitBase);
        sps.persistent_rice_adaptation_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.persistent_rice_adaptation_enabled_flag', 1, bitBase);
        sps.cabac_bypass_alignment_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.cabac_bypass_alignment_enabled_flag', 1, bitBase);
      }
      if (sps.sps_scc_extension_flag) {
        sps.sps_scc_extension = parseH265SPSSccExtension(br, sps, fieldMap, bitBase);
      }
      if (sps.sps_extension_4bits) {
        sps.sps_extension_data_flag = [];
        for (let i = 0; br.moreRbspData() && i < 4096; i++) {
          sps.sps_extension_data_flag[i] = readMappedBits(br, fieldMap, `parseResult.sps_extension_data_flag[${i}]`, 1, bitBase, `sps_extension_data_flag[${i}]`);
        }
      }
    }
  }

  // Calculate display resolution
  const subWC = getSubWidthC(sps.chroma_format_idc);
  const subHC = getSubHeightC(sps.chroma_format_idc);
  sps.width = sps.pic_width_in_luma_samples;
  sps.height = sps.pic_height_in_luma_samples;
  if (sps.conformance_window_flag) {
    sps.width -= (sps.conf_win_left_offset + sps.conf_win_right_offset) * subWC;
    sps.height -= (sps.conf_win_top_offset + sps.conf_win_bottom_offset) * subHC;
  }

  return sps;
}

function skipStRefPicSet(br, stRpsIdx, numStRefPicSets) {
  let interRefPicSetPredictionFlag = 0;
  if (stRpsIdx !== 0) {
    interRefPicSetPredictionFlag = br.readBits(1);
  }
  if (interRefPicSetPredictionFlag) {
    let deltaIdxMinus1 = 0;
    if (stRpsIdx === numStRefPicSets) {
      deltaIdxMinus1 = br.readUE();
    }
    br.readBits(1); // delta_rps_sign
    br.readUE();    // abs_delta_rps_minus1
    const numDeltaPocs = 0; // would be derived from RefRpsIdx
    for (let j = 0; j <= numDeltaPocs; j++) {
      const used = br.readBits(1);
      if (used) {
        br.readBits(1); // use_delta_flag
      }
    }
  } else {
    const numNegativePics = br.readUE();
    const numPositivePics = br.readUE();
    for (let i = 0; i < numNegativePics; i++) {
      br.readUE(); // delta_poc_s0_minus1
      br.readBits(1); // used_by_curr_pic_s0_flag
    }
    for (let i = 0; i < numPositivePics; i++) {
      br.readUE(); // delta_poc_s1_minus1
      br.readBits(1); // used_by_curr_pic_s1_flag
    }
  }
}

function parseH265StRefPicSet(br, stRpsIdx, numStRefPicSets, previousSets = [], fieldMap = null, bitBase = 16, pathPrefix = 'parseResult.short_term_ref_pic_sets[0]') {
  const rps = {};
  let interRefPicSetPredictionFlag = 0;
  if (stRpsIdx !== 0) {
    interRefPicSetPredictionFlag = readMappedBits(br, fieldMap, `${pathPrefix}.inter_ref_pic_set_prediction_flag`, 1, bitBase);
  }
  rps.inter_ref_pic_set_prediction_flag = interRefPicSetPredictionFlag;

  if (interRefPicSetPredictionFlag) {
    if (stRpsIdx === numStRefPicSets) {
      rps.delta_idx_minus1 = readMappedUE(br, fieldMap, `${pathPrefix}.delta_idx_minus1`, bitBase);
    } else {
      rps.delta_idx_minus1 = 0;
    }
    rps.delta_rps_sign = readMappedBits(br, fieldMap, `${pathPrefix}.delta_rps_sign`, 1, bitBase);
    rps.abs_delta_rps_minus1 = readMappedUE(br, fieldMap, `${pathPrefix}.abs_delta_rps_minus1`, bitBase);
    const refRpsIdx = stRpsIdx - (rps.delta_idx_minus1 + 1);
    const refRps = previousSets[refRpsIdx];
    const numDeltaPocs = refRps ? refRps.num_delta_pocs : 0;
    rps.used_by_curr_pic_flag = [];
    rps.use_delta_flag = [];
    for (let j = 0; j <= numDeltaPocs; j++) {
      const used = readMappedBits(br, fieldMap, `${pathPrefix}.used_by_curr_pic_flag[${j}]`, 1, bitBase, `used_by_curr_pic_flag[${j}]`);
      rps.used_by_curr_pic_flag.push(used);
      if (!used) {
        rps.use_delta_flag.push(readMappedBits(br, fieldMap, `${pathPrefix}.use_delta_flag[${j}]`, 1, bitBase, `use_delta_flag[${j}]`));
      } else {
        rps.use_delta_flag.push(1);
      }
    }
    rps.num_delta_pocs = numDeltaPocs;
  } else {
    rps.num_negative_pics = readMappedUE(br, fieldMap, `${pathPrefix}.num_negative_pics`, bitBase);
    rps.num_positive_pics = readMappedUE(br, fieldMap, `${pathPrefix}.num_positive_pics`, bitBase);
    rps.delta_poc_s0_minus1 = [];
    rps.used_by_curr_pic_s0_flag = [];
    for (let i = 0; i < rps.num_negative_pics; i++) {
      rps.delta_poc_s0_minus1.push(readMappedUE(br, fieldMap, `${pathPrefix}.delta_poc_s0_minus1[${i}]`, bitBase, `delta_poc_s0_minus1[${i}]`));
      rps.used_by_curr_pic_s0_flag.push(readMappedBits(br, fieldMap, `${pathPrefix}.used_by_curr_pic_s0_flag[${i}]`, 1, bitBase, `used_by_curr_pic_s0_flag[${i}]`));
    }
    rps.delta_poc_s1_minus1 = [];
    rps.used_by_curr_pic_s1_flag = [];
    for (let i = 0; i < rps.num_positive_pics; i++) {
      rps.delta_poc_s1_minus1.push(readMappedUE(br, fieldMap, `${pathPrefix}.delta_poc_s1_minus1[${i}]`, bitBase, `delta_poc_s1_minus1[${i}]`));
      rps.used_by_curr_pic_s1_flag.push(readMappedBits(br, fieldMap, `${pathPrefix}.used_by_curr_pic_s1_flag[${i}]`, 1, bitBase, `used_by_curr_pic_s1_flag[${i}]`));
    }
    rps.num_delta_pocs = rps.num_negative_pics + rps.num_positive_pics;
  }
  return rps;
}

/* ===================================================================
 *  H.265 VUI Parser (H.265 §E.2.1)
 * =================================================================== */
function parseH265VUI(br, sps, fieldMap = null, bitBase = 16, pathPrefix = 'parseResult.vui') {
  const vui = {};
  vui.aspect_ratio_info_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.aspect_ratio_info_present_flag`, 1, bitBase);
  if (vui.aspect_ratio_info_present_flag) {
    vui.aspect_ratio_idc = readMappedBits(br, fieldMap, `${pathPrefix}.aspect_ratio_idc`, 8, bitBase);
    if (vui.aspect_ratio_idc === 255) {
      vui.sar_width = readMappedBits(br, fieldMap, `${pathPrefix}.sar_width`, 16, bitBase);
      vui.sar_height = readMappedBits(br, fieldMap, `${pathPrefix}.sar_height`, 16, bitBase);
    }
  }
  vui.overscan_info_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.overscan_info_present_flag`, 1, bitBase);
  if (vui.overscan_info_present_flag) {
    vui.overscan_appropriate_flag = readMappedBits(br, fieldMap, `${pathPrefix}.overscan_appropriate_flag`, 1, bitBase);
  }
  vui.video_signal_type_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.video_signal_type_present_flag`, 1, bitBase);
  if (vui.video_signal_type_present_flag) {
    vui.video_format = readMappedBits(br, fieldMap, `${pathPrefix}.video_format`, 3, bitBase);
    vui.video_full_range_flag = readMappedBits(br, fieldMap, `${pathPrefix}.video_full_range_flag`, 1, bitBase);
    vui.colour_description_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.colour_description_present_flag`, 1, bitBase);
    if (vui.colour_description_present_flag) {
      vui.colour_primaries = readMappedBits(br, fieldMap, `${pathPrefix}.colour_primaries`, 8, bitBase);
      vui.transfer_characteristics = readMappedBits(br, fieldMap, `${pathPrefix}.transfer_characteristics`, 8, bitBase);
      vui.matrix_coeffs = readMappedBits(br, fieldMap, `${pathPrefix}.matrix_coeffs`, 8, bitBase);
    }
  }
  vui.chroma_loc_info_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.chroma_loc_info_present_flag`, 1, bitBase);
  if (vui.chroma_loc_info_present_flag) {
    vui.chroma_sample_loc_type_top_field = readMappedUE(br, fieldMap, `${pathPrefix}.chroma_sample_loc_type_top_field`, bitBase);
    vui.chroma_sample_loc_type_bottom_field = readMappedUE(br, fieldMap, `${pathPrefix}.chroma_sample_loc_type_bottom_field`, bitBase);
  }
  vui.neutral_chroma_indication_flag = readMappedBits(br, fieldMap, `${pathPrefix}.neutral_chroma_indication_flag`, 1, bitBase);
  vui.field_seq_flag = readMappedBits(br, fieldMap, `${pathPrefix}.field_seq_flag`, 1, bitBase);
  vui.frame_field_info_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.frame_field_info_present_flag`, 1, bitBase);

  vui.default_display_window_flag = readMappedBits(br, fieldMap, `${pathPrefix}.default_display_window_flag`, 1, bitBase);
  if (vui.default_display_window_flag) {
    vui.def_disp_win_left_offset = readMappedUE(br, fieldMap, `${pathPrefix}.def_disp_win_left_offset`, bitBase);
    vui.def_disp_win_right_offset = readMappedUE(br, fieldMap, `${pathPrefix}.def_disp_win_right_offset`, bitBase);
    vui.def_disp_win_top_offset = readMappedUE(br, fieldMap, `${pathPrefix}.def_disp_win_top_offset`, bitBase);
    vui.def_disp_win_bottom_offset = readMappedUE(br, fieldMap, `${pathPrefix}.def_disp_win_bottom_offset`, bitBase);
  }

  vui.vui_timing_info_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.vui_timing_info_present_flag`, 1, bitBase);
  if (vui.vui_timing_info_present_flag) {
    vui.vui_num_units_in_tick = readMappedBits(br, fieldMap, `${pathPrefix}.vui_num_units_in_tick`, 32, bitBase);
    vui.vui_time_scale = readMappedBits(br, fieldMap, `${pathPrefix}.vui_time_scale`, 32, bitBase);
    vui.vui_poc_proportional_to_timing_flag = readMappedBits(br, fieldMap, `${pathPrefix}.vui_poc_proportional_to_timing_flag`, 1, bitBase);
    if (vui.vui_poc_proportional_to_timing_flag) {
      vui.vui_num_ticks_poc_diff_one_minus1 = readMappedUE(br, fieldMap, `${pathPrefix}.vui_num_ticks_poc_diff_one_minus1`, bitBase);
    }
    vui.vui_hrd_parameters_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.vui_hrd_parameters_present_flag`, 1, bitBase);
    if (vui.vui_hrd_parameters_present_flag) {
      vui.hrd_parameters = parseH265HRDParameters(br, 1, sps.sps_max_sub_layers_minus1, fieldMap, bitBase, `${pathPrefix}.hrd_parameters`);
    }
  }

  vui.bitstream_restriction_flag = readMappedBits(br, fieldMap, `${pathPrefix}.bitstream_restriction_flag`, 1, bitBase);
  if (vui.bitstream_restriction_flag) {
    vui.tiles_fixed_structure_flag = readMappedBits(br, fieldMap, `${pathPrefix}.tiles_fixed_structure_flag`, 1, bitBase);
    vui.motion_vectors_over_pic_boundaries_flag = readMappedBits(br, fieldMap, `${pathPrefix}.motion_vectors_over_pic_boundaries_flag`, 1, bitBase);
    vui.restricted_ref_pic_lists_flag = readMappedBits(br, fieldMap, `${pathPrefix}.restricted_ref_pic_lists_flag`, 1, bitBase);
    vui.min_spatial_segmentation_idc = readMappedUE(br, fieldMap, `${pathPrefix}.min_spatial_segmentation_idc`, bitBase);
    vui.max_bytes_per_pic_denom = readMappedUE(br, fieldMap, `${pathPrefix}.max_bytes_per_pic_denom`, bitBase);
    vui.max_bits_per_min_cu_denom = readMappedUE(br, fieldMap, `${pathPrefix}.max_bits_per_min_cu_denom`, bitBase);
    vui.log2_max_mv_length_horizontal = readMappedUE(br, fieldMap, `${pathPrefix}.log2_max_mv_length_horizontal`, bitBase);
    vui.log2_max_mv_length_vertical = readMappedUE(br, fieldMap, `${pathPrefix}.log2_max_mv_length_vertical`, bitBase);
  }

  return vui;
}

/* ===================================================================
 *  H.265 PPS Parser (H.265 §7.3.2.3)
 * =================================================================== */
function parseH265PPS(rbsp, fieldMap = null, bitBase = 16) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const pps = {};

  pps.pps_pic_parameter_set_id = readMappedUE(br, fieldMap, 'parseResult.pps_pic_parameter_set_id', bitBase);
  pps.pps_seq_parameter_set_id = readMappedUE(br, fieldMap, 'parseResult.pps_seq_parameter_set_id', bitBase);
  pps.dependent_slice_segments_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.dependent_slice_segments_enabled_flag', 1, bitBase);
  pps.output_flag_present_flag = readMappedBits(br, fieldMap, 'parseResult.output_flag_present_flag', 1, bitBase);
  pps.num_extra_slice_header_bits = readMappedBits(br, fieldMap, 'parseResult.num_extra_slice_header_bits', 3, bitBase);
  pps.sign_data_hiding_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.sign_data_hiding_enabled_flag', 1, bitBase);
  pps.cabac_init_present_flag = readMappedBits(br, fieldMap, 'parseResult.cabac_init_present_flag', 1, bitBase);
  pps.num_ref_idx_l0_default_active_minus1 = readMappedUE(br, fieldMap, 'parseResult.num_ref_idx_l0_default_active_minus1', bitBase);
  pps.num_ref_idx_l1_default_active_minus1 = readMappedUE(br, fieldMap, 'parseResult.num_ref_idx_l1_default_active_minus1', bitBase);
  pps.init_qp_minus26 = readMappedSE(br, fieldMap, 'parseResult.init_qp_minus26', bitBase);
  pps.constrained_intra_pred_flag = readMappedBits(br, fieldMap, 'parseResult.constrained_intra_pred_flag', 1, bitBase);
  pps.transform_skip_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.transform_skip_enabled_flag', 1, bitBase);
  pps.cu_qp_delta_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.cu_qp_delta_enabled_flag', 1, bitBase);
  if (pps.cu_qp_delta_enabled_flag) {
    pps.diff_cu_qp_delta_depth = readMappedUE(br, fieldMap, 'parseResult.diff_cu_qp_delta_depth', bitBase);
  }
  pps.pps_cb_qp_offset = readMappedSE(br, fieldMap, 'parseResult.pps_cb_qp_offset', bitBase);
  pps.pps_cr_qp_offset = readMappedSE(br, fieldMap, 'parseResult.pps_cr_qp_offset', bitBase);
  pps.pps_slice_chroma_qp_offsets_present_flag = readMappedBits(br, fieldMap, 'parseResult.pps_slice_chroma_qp_offsets_present_flag', 1, bitBase);
  pps.weighted_pred_flag = readMappedBits(br, fieldMap, 'parseResult.weighted_pred_flag', 1, bitBase);
  pps.weighted_bipred_flag = readMappedBits(br, fieldMap, 'parseResult.weighted_bipred_flag', 1, bitBase);
  pps.transquant_bypass_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.transquant_bypass_enabled_flag', 1, bitBase);
  pps.tiles_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.tiles_enabled_flag', 1, bitBase);
  pps.entropy_coding_sync_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.entropy_coding_sync_enabled_flag', 1, bitBase);

  if (pps.tiles_enabled_flag) {
    pps.num_tile_columns_minus1 = readMappedUE(br, fieldMap, 'parseResult.num_tile_columns_minus1', bitBase);
    pps.num_tile_rows_minus1 = readMappedUE(br, fieldMap, 'parseResult.num_tile_rows_minus1', bitBase);
    pps.uniform_spacing_flag = readMappedBits(br, fieldMap, 'parseResult.uniform_spacing_flag', 1, bitBase);
    if (!pps.uniform_spacing_flag) {
      pps.column_width_minus1 = [];
      for (let i = 0; i < pps.num_tile_columns_minus1; i++) {
        pps.column_width_minus1.push(readMappedUE(br, fieldMap, `parseResult.column_width_minus1[${i}]`, bitBase, `column_width_minus1[${i}]`));
      }
      pps.row_height_minus1 = [];
      for (let i = 0; i < pps.num_tile_rows_minus1; i++) {
        pps.row_height_minus1.push(readMappedUE(br, fieldMap, `parseResult.row_height_minus1[${i}]`, bitBase, `row_height_minus1[${i}]`));
      }
    }
    pps.loop_filter_across_tiles_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.loop_filter_across_tiles_enabled_flag', 1, bitBase);
  }

  pps.pps_loop_filter_across_slices_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.pps_loop_filter_across_slices_enabled_flag', 1, bitBase);
  pps.deblocking_filter_control_present_flag = readMappedBits(br, fieldMap, 'parseResult.deblocking_filter_control_present_flag', 1, bitBase);
  if (pps.deblocking_filter_control_present_flag) {
    pps.deblocking_filter_override_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.deblocking_filter_override_enabled_flag', 1, bitBase);
    pps.pps_deblocking_filter_disabled_flag = readMappedBits(br, fieldMap, 'parseResult.pps_deblocking_filter_disabled_flag', 1, bitBase);
    if (!pps.pps_deblocking_filter_disabled_flag) {
      pps.pps_beta_offset_div2 = readMappedSE(br, fieldMap, 'parseResult.pps_beta_offset_div2', bitBase);
      pps.pps_tc_offset_div2 = readMappedSE(br, fieldMap, 'parseResult.pps_tc_offset_div2', bitBase);
    }
  }
  pps.pps_scaling_list_data_present_flag = readMappedBits(br, fieldMap, 'parseResult.pps_scaling_list_data_present_flag', 1, bitBase);
  if (pps.pps_scaling_list_data_present_flag) {
    parseH265ScalingListData(br, fieldMap, bitBase, 'parseResult.pps_scaling_list_data');
  }
  pps.lists_modification_present_flag = readMappedBits(br, fieldMap, 'parseResult.lists_modification_present_flag', 1, bitBase);
  pps.log2_parallel_merge_level_minus2 = readMappedUE(br, fieldMap, 'parseResult.log2_parallel_merge_level_minus2', bitBase);
  pps.slice_segment_header_extension_present_flag = readMappedBits(br, fieldMap, 'parseResult.slice_segment_header_extension_present_flag', 1, bitBase);
  pps.pps_extension_present_flag = readMappedBits(br, fieldMap, 'parseResult.pps_extension_present_flag', 1, bitBase);
  if (pps.pps_extension_present_flag) {
    pps.pps_range_extension_flag = readMappedBits(br, fieldMap, 'parseResult.pps_range_extension_flag', 1, bitBase);
    pps.pps_multilayer_extension_flag = readMappedBits(br, fieldMap, 'parseResult.pps_multilayer_extension_flag', 1, bitBase);
    pps.pps_3d_extension_flag = readMappedBits(br, fieldMap, 'parseResult.pps_3d_extension_flag', 1, bitBase);
    pps.pps_scc_extension_flag = readMappedBits(br, fieldMap, 'parseResult.pps_scc_extension_flag', 1, bitBase);
    pps.pps_extension_4bits = readMappedBits(br, fieldMap, 'parseResult.pps_extension_4bits', 4, bitBase);
    if (pps.pps_range_extension_flag) {
      if (pps.transform_skip_enabled_flag) {
        pps.log2_max_transform_skip_block_size_minus2 = readMappedUE(br, fieldMap, 'parseResult.log2_max_transform_skip_block_size_minus2', bitBase);
      }
      pps.cross_component_prediction_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.cross_component_prediction_enabled_flag', 1, bitBase);
      pps.chroma_qp_offset_list_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.chroma_qp_offset_list_enabled_flag', 1, bitBase);
      if (pps.chroma_qp_offset_list_enabled_flag) {
        pps.diff_cu_chroma_qp_offset_depth = readMappedUE(br, fieldMap, 'parseResult.diff_cu_chroma_qp_offset_depth', bitBase);
        pps.chroma_qp_offset_list_len_minus1 = readMappedUE(br, fieldMap, 'parseResult.chroma_qp_offset_list_len_minus1', bitBase);
        pps.cb_qp_offset_list = [];
        pps.cr_qp_offset_list = [];
        for (let i = 0; i <= pps.chroma_qp_offset_list_len_minus1; i++) {
          pps.cb_qp_offset_list.push(readMappedSE(br, fieldMap, `parseResult.cb_qp_offset_list[${i}]`, bitBase, `cb_qp_offset_list[${i}]`));
          pps.cr_qp_offset_list.push(readMappedSE(br, fieldMap, `parseResult.cr_qp_offset_list[${i}]`, bitBase, `cr_qp_offset_list[${i}]`));
        }
      }
      pps.log2_sao_offset_scale_luma = readMappedUE(br, fieldMap, 'parseResult.log2_sao_offset_scale_luma', bitBase);
      pps.log2_sao_offset_scale_chroma = readMappedUE(br, fieldMap, 'parseResult.log2_sao_offset_scale_chroma', bitBase);
    }
    if (pps.pps_scc_extension_flag) {
      pps.pps_scc_extension = parseH265PPSSccExtension(br, pps, fieldMap, bitBase);
    }
    if (pps.pps_extension_4bits) {
      pps.pps_extension_data_flag = [];
      for (let i = 0; br.moreRbspData() && i < 4096; i++) {
        pps.pps_extension_data_flag[i] = readMappedBits(br, fieldMap, `parseResult.pps_extension_data_flag[${i}]`, 1, bitBase, `pps_extension_data_flag[${i}]`);
      }
    }
  }

  return pps;
}

function parseH265ScalingListData(br, fieldMap = null, bitBase = 16, pathPrefix = 'parseResult.scaling_list_data') {
  const data = {
    scaling_list_pred_mode_flag: [],
    scaling_list_pred_matrix_id_delta: [],
    scaling_list_dc_coef_minus8: [],
    scaling_list_delta_coef: []
  };
  for (let sizeId = 0; sizeId < 4; sizeId++) {
    data.scaling_list_pred_mode_flag[sizeId] = [];
    data.scaling_list_pred_matrix_id_delta[sizeId] = [];
    data.scaling_list_delta_coef[sizeId] = [];
    for (let matrixId = 0; matrixId < 6; matrixId += (sizeId === 3) ? 3 : 1) {
      const flag = readMappedBits(br, fieldMap, `${pathPrefix}.scaling_list_pred_mode_flag[${sizeId}][${matrixId}]`, 1, bitBase, `scaling_list_pred_mode_flag[${sizeId}][${matrixId}]`);
      data.scaling_list_pred_mode_flag[sizeId][matrixId] = flag;
      if (!flag) {
        data.scaling_list_pred_matrix_id_delta[sizeId][matrixId] = readMappedUE(br, fieldMap, `${pathPrefix}.scaling_list_pred_matrix_id_delta[${sizeId}][${matrixId}]`, bitBase, `scaling_list_pred_matrix_id_delta[${sizeId}][${matrixId}]`);
      } else {
        let nextCoef = 8;
        const coefNum = Math.min(64, 1 << (4 + (sizeId << 1)));
        if (sizeId > 1) {
          const dcSizeId = sizeId - 2;
          data.scaling_list_dc_coef_minus8[dcSizeId] = data.scaling_list_dc_coef_minus8[dcSizeId] || [];
          data.scaling_list_dc_coef_minus8[dcSizeId][matrixId] = readMappedSE(br, fieldMap, `${pathPrefix}.scaling_list_dc_coef_minus8[${dcSizeId}][${matrixId}]`, bitBase, `scaling_list_dc_coef_minus8[${dcSizeId}][${matrixId}]`);
          nextCoef = data.scaling_list_dc_coef_minus8[dcSizeId][matrixId] + 8;
        }
        data.scaling_list_delta_coef[sizeId][matrixId] = [];
        for (let i = 0; i < coefNum; i++) {
          const delta = readMappedSE(br, fieldMap, `${pathPrefix}.scaling_list_delta_coef[${sizeId}][${matrixId}][${i}]`, bitBase, `scaling_list_delta_coef[${sizeId}][${matrixId}][${i}]`);
          data.scaling_list_delta_coef[sizeId][matrixId][i] = delta;
          nextCoef = (nextCoef + delta + 256) % 256;
        }
      }
    }
  }
  return data;
}

function parseH265SPSSccExtension(br, sps, fieldMap = null, bitBase = 16, pathPrefix = 'parseResult.sps_scc_extension') {
  const ext = {};
  ext.sps_curr_pic_ref_enabled_flag = readMappedBits(br, fieldMap, `${pathPrefix}.sps_curr_pic_ref_enabled_flag`, 1, bitBase);
  ext.palette_mode_enabled_flag = readMappedBits(br, fieldMap, `${pathPrefix}.palette_mode_enabled_flag`, 1, bitBase);
  if (ext.palette_mode_enabled_flag) {
    ext.palette_max_size = readMappedUE(br, fieldMap, `${pathPrefix}.palette_max_size`, bitBase);
    ext.delta_palette_max_predictor_size = readMappedUE(br, fieldMap, `${pathPrefix}.delta_palette_max_predictor_size`, bitBase);
    ext.sps_palette_predictor_initializers_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.sps_palette_predictor_initializers_present_flag`, 1, bitBase);
    if (ext.sps_palette_predictor_initializers_present_flag) {
      ext.sps_num_palette_predictor_initializers_minus1 = readMappedUE(br, fieldMap, `${pathPrefix}.sps_num_palette_predictor_initializers_minus1`, bitBase);
      ext.sps_palette_predictor_initializer = [];
      const numComps = sps.chroma_format_idc === 0 ? 1 : 3;
      for (let comp = 0; comp < numComps; comp++) {
        ext.sps_palette_predictor_initializer[comp] = [];
        const bitDepth = comp === 0 ? sps.bit_depth_luma_minus8 + 8 : sps.bit_depth_chroma_minus8 + 8;
        for (let i = 0; i <= ext.sps_num_palette_predictor_initializers_minus1; i++) {
          ext.sps_palette_predictor_initializer[comp][i] = readMappedBits(
            br,
            fieldMap,
            `${pathPrefix}.sps_palette_predictor_initializer[${comp}][${i}]`,
            bitDepth,
            bitBase,
            `sps_palette_predictor_initializer[${comp}][${i}]`
          );
        }
      }
    }
  }
  ext.motion_vector_resolution_control_idc = readMappedBits(br, fieldMap, `${pathPrefix}.motion_vector_resolution_control_idc`, 2, bitBase);
  ext.intra_boundary_filtering_disabled_flag = readMappedBits(br, fieldMap, `${pathPrefix}.intra_boundary_filtering_disabled_flag`, 1, bitBase);
  return ext;
}

function parseH265PPSSccExtension(br, pps, fieldMap = null, bitBase = 16, pathPrefix = 'parseResult.pps_scc_extension') {
  const ext = {};
  ext.pps_curr_pic_ref_enabled_flag = readMappedBits(br, fieldMap, `${pathPrefix}.pps_curr_pic_ref_enabled_flag`, 1, bitBase);
  ext.residual_adaptive_colour_transform_enabled_flag = readMappedBits(br, fieldMap, `${pathPrefix}.residual_adaptive_colour_transform_enabled_flag`, 1, bitBase);
  if (ext.residual_adaptive_colour_transform_enabled_flag) {
    ext.pps_slice_act_qp_offsets_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.pps_slice_act_qp_offsets_present_flag`, 1, bitBase);
    ext.pps_act_y_qp_offset_plus5 = readMappedSE(br, fieldMap, `${pathPrefix}.pps_act_y_qp_offset_plus5`, bitBase);
    ext.pps_act_cb_qp_offset_plus5 = readMappedSE(br, fieldMap, `${pathPrefix}.pps_act_cb_qp_offset_plus5`, bitBase);
    ext.pps_act_cr_qp_offset_plus3 = readMappedSE(br, fieldMap, `${pathPrefix}.pps_act_cr_qp_offset_plus3`, bitBase);
  }
  ext.pps_palette_predictor_initializers_present_flag = readMappedBits(br, fieldMap, `${pathPrefix}.pps_palette_predictor_initializers_present_flag`, 1, bitBase);
  if (ext.pps_palette_predictor_initializers_present_flag) {
    ext.pps_num_palette_predictor_initializers = readMappedUE(br, fieldMap, `${pathPrefix}.pps_num_palette_predictor_initializers`, bitBase);
    if (ext.pps_num_palette_predictor_initializers > 0) {
      ext.monochrome_palette_flag = readMappedBits(br, fieldMap, `${pathPrefix}.monochrome_palette_flag`, 1, bitBase);
      ext.luma_bit_depth_entry_minus8 = readMappedUE(br, fieldMap, `${pathPrefix}.luma_bit_depth_entry_minus8`, bitBase);
      if (!ext.monochrome_palette_flag) {
        ext.chroma_bit_depth_entry_minus8 = readMappedUE(br, fieldMap, `${pathPrefix}.chroma_bit_depth_entry_minus8`, bitBase);
      }
      ext.pps_palette_predictor_initializer = [];
      const numComps = ext.monochrome_palette_flag ? 1 : 3;
      for (let comp = 0; comp < numComps; comp++) {
        ext.pps_palette_predictor_initializer[comp] = [];
        const bitDepth = comp === 0 ? ext.luma_bit_depth_entry_minus8 + 8 : ext.chroma_bit_depth_entry_minus8 + 8;
        for (let i = 0; i < ext.pps_num_palette_predictor_initializers; i++) {
          ext.pps_palette_predictor_initializer[comp][i] = readMappedBits(
            br,
            fieldMap,
            `${pathPrefix}.pps_palette_predictor_initializer[${comp}][${i}]`,
            bitDepth,
            bitBase,
            `pps_palette_predictor_initializer[${comp}][${i}]`
          );
        }
      }
    }
  }
  return ext;
}

function parseH265ByteAlignment(br, fieldMap = null, bitBase = 16, pathPrefix = 'parseResult.byte_alignment') {
  const totalBits = (br.byteEnd - br.byteStart) * 8;
  if (br.getBitPos() >= totalBits) return null;
  const alignment = {};
  alignment.alignment_bit_equal_to_one = readMappedBits(br, fieldMap, `${pathPrefix}.alignment_bit_equal_to_one`, 1, bitBase);
  alignment.alignment_bit_equal_to_zero = [];
  for (let i = 0; br.getBitPos() % 8 !== 0 && br.getBitPos() < totalBits; i++) {
    alignment.alignment_bit_equal_to_zero[i] = readMappedBits(br, fieldMap, `${pathPrefix}.alignment_bit_equal_to_zero[${i}]`, 1, bitBase, `alignment_bit_equal_to_zero[${i}]`);
  }
  return alignment;
}

function getH265ChromaArrayType(sps) {
  if (!sps) return 1;
  return sps.separate_colour_plane_flag ? 0 : (sps.chroma_format_idc ?? 1);
}

function getH265NumPocTotalCurr(sps, sh) {
  let total = 0;
  const rps = sh.short_term_ref_pic_set || (
    sps &&
    sh.short_term_ref_pic_set_idx != null &&
    sps.short_term_ref_pic_sets &&
    sps.short_term_ref_pic_sets[sh.short_term_ref_pic_set_idx]
  );
  if (rps) {
    if (Array.isArray(rps.used_by_curr_pic_flag)) {
      total += rps.used_by_curr_pic_flag.filter(Boolean).length;
    }
    if (Array.isArray(rps.used_by_curr_pic_s0_flag)) {
      total += rps.used_by_curr_pic_s0_flag.filter(Boolean).length;
    }
    if (Array.isArray(rps.used_by_curr_pic_s1_flag)) {
      total += rps.used_by_curr_pic_s1_flag.filter(Boolean).length;
    }
  }
  total += sh.num_long_term_sps || 0;
  total += sh.num_long_term_pics || 0;
  return total;
}

function parseH265RefPicListsModification(br, fieldMap, bitBase, sh, numPocTotalCurr, numRefIdxL0ActiveMinus1, numRefIdxL1ActiveMinus1, isB) {
  const listBits = Math.ceil(Math.log2(Math.max(numPocTotalCurr, 1)));
  const result = {};
  result.ref_pic_list_modification_flag_l0 = readMappedBits(br, fieldMap, 'parseResult.ref_pic_lists_modification.ref_pic_list_modification_flag_l0', 1, bitBase);
  if (result.ref_pic_list_modification_flag_l0) {
    result.list_entry_l0 = [];
    for (let i = 0; i <= numRefIdxL0ActiveMinus1; i++) {
      result.list_entry_l0.push(readMappedBits(br, fieldMap, `parseResult.ref_pic_lists_modification.list_entry_l0[${i}]`, listBits, bitBase, `list_entry_l0[${i}]`));
    }
  }
  if (isB) {
    result.ref_pic_list_modification_flag_l1 = readMappedBits(br, fieldMap, 'parseResult.ref_pic_lists_modification.ref_pic_list_modification_flag_l1', 1, bitBase);
    if (result.ref_pic_list_modification_flag_l1) {
      result.list_entry_l1 = [];
      for (let i = 0; i <= numRefIdxL1ActiveMinus1; i++) {
        result.list_entry_l1.push(readMappedBits(br, fieldMap, `parseResult.ref_pic_lists_modification.list_entry_l1[${i}]`, listBits, bitBase, `list_entry_l1[${i}]`));
      }
    }
  }
  sh.ref_pic_lists_modification = result;
}

function parseH265PredWeightTable(br, fieldMap, bitBase, sps, numRefIdxL0ActiveMinus1, numRefIdxL1ActiveMinus1, isB) {
  const chromaArrayType = getH265ChromaArrayType(sps);
  const table = {};
  table.luma_log2_weight_denom = readMappedUE(br, fieldMap, 'parseResult.pred_weight_table.luma_log2_weight_denom', bitBase);
  if (chromaArrayType !== 0) {
    table.delta_chroma_log2_weight_denom = readMappedSE(br, fieldMap, 'parseResult.pred_weight_table.delta_chroma_log2_weight_denom', bitBase);
  }
  table.luma_weight_l0_flag = [];
  for (let i = 0; i <= numRefIdxL0ActiveMinus1; i++) {
    table.luma_weight_l0_flag.push(readMappedBits(br, fieldMap, `parseResult.pred_weight_table.luma_weight_l0_flag[${i}]`, 1, bitBase, `luma_weight_l0_flag[${i}]`));
  }
  table.chroma_weight_l0_flag = [];
  if (chromaArrayType !== 0) {
    for (let i = 0; i <= numRefIdxL0ActiveMinus1; i++) {
      table.chroma_weight_l0_flag.push(readMappedBits(br, fieldMap, `parseResult.pred_weight_table.chroma_weight_l0_flag[${i}]`, 1, bitBase, `chroma_weight_l0_flag[${i}]`));
    }
  }
  readH265WeightList(br, fieldMap, bitBase, table, 'l0', numRefIdxL0ActiveMinus1, chromaArrayType);

  if (isB) {
    table.luma_weight_l1_flag = [];
    for (let i = 0; i <= numRefIdxL1ActiveMinus1; i++) {
      table.luma_weight_l1_flag.push(readMappedBits(br, fieldMap, `parseResult.pred_weight_table.luma_weight_l1_flag[${i}]`, 1, bitBase, `luma_weight_l1_flag[${i}]`));
    }
    table.chroma_weight_l1_flag = [];
    if (chromaArrayType !== 0) {
      for (let i = 0; i <= numRefIdxL1ActiveMinus1; i++) {
        table.chroma_weight_l1_flag.push(readMappedBits(br, fieldMap, `parseResult.pred_weight_table.chroma_weight_l1_flag[${i}]`, 1, bitBase, `chroma_weight_l1_flag[${i}]`));
      }
    }
    readH265WeightList(br, fieldMap, bitBase, table, 'l1', numRefIdxL1ActiveMinus1, chromaArrayType);
  }

  return table;
}

function readH265WeightList(br, fieldMap, bitBase, table, listName, numRefIdxActiveMinus1, chromaArrayType) {
  table[`delta_luma_weight_${listName}`] = [];
  table[`luma_offset_${listName}`] = [];
  table[`delta_chroma_weight_${listName}`] = [];
  table[`delta_chroma_offset_${listName}`] = [];

  for (let i = 0; i <= numRefIdxActiveMinus1; i++) {
    if (table[`luma_weight_${listName}_flag`][i]) {
      table[`delta_luma_weight_${listName}`].push(readMappedSE(br, fieldMap, `parseResult.pred_weight_table.delta_luma_weight_${listName}[${i}]`, bitBase, `delta_luma_weight_${listName}[${i}]`));
      table[`luma_offset_${listName}`].push(readMappedSE(br, fieldMap, `parseResult.pred_weight_table.luma_offset_${listName}[${i}]`, bitBase, `luma_offset_${listName}[${i}]`));
    }
    if (chromaArrayType !== 0 && table[`chroma_weight_${listName}_flag`][i]) {
      table[`delta_chroma_weight_${listName}`][i] = [];
      table[`delta_chroma_offset_${listName}`][i] = [];
      for (let j = 0; j < 2; j++) {
        table[`delta_chroma_weight_${listName}`][i].push(readMappedSE(br, fieldMap, `parseResult.pred_weight_table.delta_chroma_weight_${listName}[${i}][${j}]`, bitBase, `delta_chroma_weight_${listName}[${i}][${j}]`));
        table[`delta_chroma_offset_${listName}`][i].push(readMappedSE(br, fieldMap, `parseResult.pred_weight_table.delta_chroma_offset_${listName}[${i}][${j}]`, bitBase, `delta_chroma_offset_${listName}[${i}][${j}]`));
      }
    }
  }
}

/* ===================================================================
 *  H.265 Slice Segment Header Parser (H.265 §7.3.6)
 * =================================================================== */
function parseH265SliceHeader(rbsp, nalType, spsMap, ppsMap, fieldMap = null, bitBase = 16) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const sh = {};

  sh.first_slice_segment_in_pic_flag = readMappedBits(br, fieldMap, 'parseResult.first_slice_segment_in_pic_flag', 1, bitBase);

  if (H265_IRAP_TYPES.has(nalType)) {
    sh.no_output_of_prior_pics_flag = readMappedBits(br, fieldMap, 'parseResult.no_output_of_prior_pics_flag', 1, bitBase);
  }

  sh.slice_pic_parameter_set_id = readMappedUE(br, fieldMap, 'parseResult.slice_pic_parameter_set_id', bitBase);
  const pps = ppsMap[sh.slice_pic_parameter_set_id];
  const sps = pps ? spsMap[pps.pps_seq_parameter_set_id] : null;

  if (!sh.first_slice_segment_in_pic_flag) {
    if (pps && pps.dependent_slice_segments_enabled_flag) {
      sh.dependent_slice_segment_flag = readMappedBits(br, fieldMap, 'parseResult.dependent_slice_segment_flag', 1, bitBase);
    }
    const minCbLog2SizeY = sps ? sps.log2_min_luma_coding_block_size_minus3 + 3 : 3;
    const ctbLog2SizeY = minCbLog2SizeY + (sps ? sps.log2_diff_max_min_luma_coding_block_size : 0);
    const ctbSizeY = 1 << ctbLog2SizeY;
    const picWidthInCtbsY = Math.ceil((sps ? sps.pic_width_in_luma_samples : 1920) / ctbSizeY);
    const picHeightInCtbsY = Math.ceil((sps ? sps.pic_height_in_luma_samples : 1080) / ctbSizeY);
    const picSizeInCtbsY = picWidthInCtbsY * picHeightInCtbsY;
    const bitsSliceSegmentAddress = Math.ceil(Math.log2(picSizeInCtbsY));
    sh.slice_segment_address = readMappedBits(br, fieldMap, 'parseResult.slice_segment_address', bitsSliceSegmentAddress, bitBase);
  }

  if (!sh.dependent_slice_segment_flag) {
    // Skip ref pic list modification params
    for (let i = 0; i < (pps ? pps.num_extra_slice_header_bits : 0); i++) {
      readMappedBits(br, fieldMap, `parseResult.slice_reserved_flag[${i}]`, 1, bitBase, `slice_reserved_flag[${i}]`);
    }
    sh.slice_type = readMappedUE(br, fieldMap, 'parseResult.slice_type', bitBase);

    const sliceTypeMap = {0: 'B', 1: 'P', 2: 'I'};
    sh.slice_type_name = sliceTypeMap[sh.slice_type] || 'Unknown';

    if (pps && pps.output_flag_present_flag) {
      sh.pic_output_flag = readMappedBits(br, fieldMap, 'parseResult.pic_output_flag', 1, bitBase);
    }

    if (sps && sps.separate_colour_plane_flag) {
      sh.colour_plane_id = readMappedBits(br, fieldMap, 'parseResult.colour_plane_id', 2, bitBase);
    }

    const isIdrType = nalType === 19 || nalType === 20;
    if (!isIdrType) {
      const pocLsbBits = sps ? sps.log2_max_pic_order_cnt_lsb_minus4 + 4 : 16;
      sh.slice_pic_order_cnt_lsb = readMappedBits(br, fieldMap, 'parseResult.slice_pic_order_cnt_lsb', pocLsbBits, bitBase);

      if (sps) {
        sh.short_term_ref_pic_set_sps_flag = readMappedBits(br, fieldMap, 'parseResult.short_term_ref_pic_set_sps_flag', 1, bitBase);
        if (!sh.short_term_ref_pic_set_sps_flag) {
          sh.short_term_ref_pic_set = parseH265StRefPicSet(
            br,
            sps.num_short_term_ref_pic_sets,
            sps.num_short_term_ref_pic_sets,
            sps.short_term_ref_pic_sets,
            fieldMap,
            bitBase,
            'parseResult.short_term_ref_pic_set'
          );
        } else {
          sh.short_term_ref_pic_set_idx = 0;
          if (sps.num_short_term_ref_pic_sets > 1) {
            const bitsStRpsIdx = Math.ceil(Math.log2(sps.num_short_term_ref_pic_sets));
            sh.short_term_ref_pic_set_idx = readMappedBits(br, fieldMap, 'parseResult.short_term_ref_pic_set_idx', bitsStRpsIdx, bitBase);
          }
        }
      }

      if (sps && sps.long_term_ref_pics_present_flag) {
        sh.num_long_term_sps = 0;
        if (sps.num_long_term_ref_pics_sps > 0) {
          sh.num_long_term_sps = readMappedUE(br, fieldMap, 'parseResult.num_long_term_sps', bitBase);
        }
        sh.num_long_term_pics = readMappedUE(br, fieldMap, 'parseResult.num_long_term_pics', bitBase);
        sh.lt_idx_sps = [];
        sh.poc_lsb_lt = [];
        sh.used_by_curr_pic_lt_flag = [];
        sh.delta_poc_msb_present_flag = [];
        sh.delta_poc_msb_cycle_lt = [];
        const totalLongTerm = sh.num_long_term_sps + sh.num_long_term_pics;
        const ltIdxBits = Math.ceil(Math.log2(Math.max(sps.num_long_term_ref_pics_sps || 1, 1)));
        const pocLsbBits = sps.log2_max_pic_order_cnt_lsb_minus4 + 4;
        for (let i = 0; i < totalLongTerm; i++) {
          if (i < sh.num_long_term_sps) {
            if ((sps.num_long_term_ref_pics_sps || 0) > 1) {
              sh.lt_idx_sps[i] = readMappedBits(br, fieldMap, `parseResult.lt_idx_sps[${i}]`, ltIdxBits, bitBase, `lt_idx_sps[${i}]`);
            }
          } else {
            sh.poc_lsb_lt[i] = readMappedBits(br, fieldMap, `parseResult.poc_lsb_lt[${i}]`, pocLsbBits, bitBase, `poc_lsb_lt[${i}]`);
            sh.used_by_curr_pic_lt_flag[i] = readMappedBits(br, fieldMap, `parseResult.used_by_curr_pic_lt_flag[${i}]`, 1, bitBase, `used_by_curr_pic_lt_flag[${i}]`);
          }
          sh.delta_poc_msb_present_flag[i] = readMappedBits(br, fieldMap, `parseResult.delta_poc_msb_present_flag[${i}]`, 1, bitBase, `delta_poc_msb_present_flag[${i}]`);
          if (sh.delta_poc_msb_present_flag[i]) {
            sh.delta_poc_msb_cycle_lt[i] = readMappedUE(br, fieldMap, `parseResult.delta_poc_msb_cycle_lt[${i}]`, bitBase, `delta_poc_msb_cycle_lt[${i}]`);
          }
        }
      }

      if (sps && sps.sps_temporal_mvp_enabled_flag) {
        sh.slice_temporal_mvp_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.slice_temporal_mvp_enabled_flag', 1, bitBase);
      }
    }

    if (sps && sps.sample_adaptive_offset_enabled_flag) {
      sh.slice_sao_luma_flag = readMappedBits(br, fieldMap, 'parseResult.slice_sao_luma_flag', 1, bitBase);
      const chromaArrayType = getH265ChromaArrayType(sps);
      if (chromaArrayType !== 0) {
        sh.slice_sao_chroma_flag = readMappedBits(br, fieldMap, 'parseResult.slice_sao_chroma_flag', 1, bitBase);
      }
    }

    const isB = sh.slice_type === 0;
    const isP = sh.slice_type === 1;
    let numRefIdxL0ActiveMinus1 = pps ? pps.num_ref_idx_l0_default_active_minus1 : 0;
    let numRefIdxL1ActiveMinus1 = pps ? pps.num_ref_idx_l1_default_active_minus1 : 0;
    if (isP || isB) {
      sh.num_ref_idx_active_override_flag = readMappedBits(br, fieldMap, 'parseResult.num_ref_idx_active_override_flag', 1, bitBase);
      if (sh.num_ref_idx_active_override_flag) {
        numRefIdxL0ActiveMinus1 = readMappedUE(br, fieldMap, 'parseResult.num_ref_idx_l0_active_minus1', bitBase);
        if (isB) {
          numRefIdxL1ActiveMinus1 = readMappedUE(br, fieldMap, 'parseResult.num_ref_idx_l1_active_minus1', bitBase);
        }
      }

      const numPocTotalCurr = getH265NumPocTotalCurr(sps, sh);
      if (pps && pps.lists_modification_present_flag && numPocTotalCurr > 1) {
        parseH265RefPicListsModification(br, fieldMap, bitBase, sh, numPocTotalCurr, numRefIdxL0ActiveMinus1, numRefIdxL1ActiveMinus1, isB);
      }
      if (isB) {
        sh.mvd_l1_zero_flag = readMappedBits(br, fieldMap, 'parseResult.mvd_l1_zero_flag', 1, bitBase);
      }
      if (pps && pps.cabac_init_present_flag) {
        sh.cabac_init_flag = readMappedBits(br, fieldMap, 'parseResult.cabac_init_flag', 1, bitBase);
      }
      if (sh.slice_temporal_mvp_enabled_flag) {
        if (isB) {
          sh.collocated_from_l0_flag = readMappedBits(br, fieldMap, 'parseResult.collocated_from_l0_flag', 1, bitBase);
        }
        const usesL0 = !isB || sh.collocated_from_l0_flag;
        const activeRefs = usesL0 ? numRefIdxL0ActiveMinus1 : numRefIdxL1ActiveMinus1;
        if (activeRefs > 0) {
          sh.collocated_ref_idx = readMappedUE(br, fieldMap, 'parseResult.collocated_ref_idx', bitBase);
        }
      }
      if (pps && ((pps.weighted_pred_flag && isP) || (pps.weighted_bipred_flag && isB))) {
        sh.pred_weight_table = parseH265PredWeightTable(br, fieldMap, bitBase, sps, numRefIdxL0ActiveMinus1, numRefIdxL1ActiveMinus1, isB);
      }
      sh.five_minus_max_num_merge_cand = readMappedUE(br, fieldMap, 'parseResult.five_minus_max_num_merge_cand', bitBase);
      if (sps && sps.sps_scc_extension && sps.sps_scc_extension.motion_vector_resolution_control_idc === 2) {
        sh.use_integer_mv_flag = readMappedBits(br, fieldMap, 'parseResult.use_integer_mv_flag', 1, bitBase);
      }
    }

    sh.slice_qp_delta = readMappedSE(br, fieldMap, 'parseResult.slice_qp_delta', bitBase);
    if (pps && pps.pps_slice_chroma_qp_offsets_present_flag) {
      sh.slice_cb_qp_offset = readMappedSE(br, fieldMap, 'parseResult.slice_cb_qp_offset', bitBase);
      sh.slice_cr_qp_offset = readMappedSE(br, fieldMap, 'parseResult.slice_cr_qp_offset', bitBase);
    }
    if (pps && pps.pps_scc_extension && pps.pps_scc_extension.pps_slice_act_qp_offsets_present_flag) {
      sh.slice_act_y_qp_offset = readMappedSE(br, fieldMap, 'parseResult.slice_act_y_qp_offset', bitBase);
      sh.slice_act_cb_qp_offset = readMappedSE(br, fieldMap, 'parseResult.slice_act_cb_qp_offset', bitBase);
      sh.slice_act_cr_qp_offset = readMappedSE(br, fieldMap, 'parseResult.slice_act_cr_qp_offset', bitBase);
    }
    if (pps && pps.chroma_qp_offset_list_enabled_flag) {
      sh.cu_chroma_qp_offset_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.cu_chroma_qp_offset_enabled_flag', 1, bitBase);
    }
    let sliceDeblockingFilterDisabledFlag = pps ? (pps.pps_deblocking_filter_disabled_flag || 0) : 0;
    if (pps && pps.deblocking_filter_override_enabled_flag) {
      sh.deblocking_filter_override_flag = readMappedBits(br, fieldMap, 'parseResult.deblocking_filter_override_flag', 1, bitBase);
    }
    if (pps && sh.deblocking_filter_override_flag) {
      sh.slice_deblocking_filter_disabled_flag = readMappedBits(br, fieldMap, 'parseResult.slice_deblocking_filter_disabled_flag', 1, bitBase);
      sliceDeblockingFilterDisabledFlag = sh.slice_deblocking_filter_disabled_flag;
      if (!sh.slice_deblocking_filter_disabled_flag) {
        sh.slice_beta_offset_div2 = readMappedSE(br, fieldMap, 'parseResult.slice_beta_offset_div2', bitBase);
        sh.slice_tc_offset_div2 = readMappedSE(br, fieldMap, 'parseResult.slice_tc_offset_div2', bitBase);
      }
    }
    const loopFilterCanCrossSlices =
      pps &&
      pps.pps_loop_filter_across_slices_enabled_flag &&
      (sh.slice_sao_luma_flag || sh.slice_sao_chroma_flag || !sliceDeblockingFilterDisabledFlag);
    if (loopFilterCanCrossSlices) {
      sh.slice_loop_filter_across_slices_enabled_flag = readMappedBits(br, fieldMap, 'parseResult.slice_loop_filter_across_slices_enabled_flag', 1, bitBase);
    }
  }
  if (pps && (pps.tiles_enabled_flag || pps.entropy_coding_sync_enabled_flag)) {
    sh.num_entry_point_offsets = readMappedUE(br, fieldMap, 'parseResult.num_entry_point_offsets', bitBase);
    if (sh.num_entry_point_offsets > 0) {
      sh.offset_len_minus1 = readMappedUE(br, fieldMap, 'parseResult.offset_len_minus1', bitBase);
      sh.entry_point_offset_minus1 = [];
      for (let i = 0; i < sh.num_entry_point_offsets; i++) {
        sh.entry_point_offset_minus1.push(readMappedBits(br, fieldMap, `parseResult.entry_point_offset_minus1[${i}]`, sh.offset_len_minus1 + 1, bitBase, `entry_point_offset_minus1[${i}]`));
      }
    }
  }
  if (pps && pps.slice_segment_header_extension_present_flag) {
    sh.slice_segment_header_extension_length = readMappedUE(br, fieldMap, 'parseResult.slice_segment_header_extension_length', bitBase);
    sh.slice_segment_header_extension_data_byte = [];
    for (let i = 0; i < sh.slice_segment_header_extension_length; i++) {
      sh.slice_segment_header_extension_data_byte.push(readMappedBits(br, fieldMap, `parseResult.slice_segment_header_extension_data_byte[${i}]`, 8, bitBase, `slice_segment_header_extension_data_byte[${i}]`));
    }
  }

  sh.byte_alignment = parseH265ByteAlignment(br, fieldMap, bitBase);
  sh.temporal_id = 0; // will be set from NAL header by caller

  return sh;
}

/* ===================================================================
 *  H.264 SEI / non-VCL RBSP Parsers (H.264 §7.3.2)
 * =================================================================== */
const H264_SEI_PAYLOAD_NAMES = {
  0: 'buffering_period',
  1: 'pic_timing',
  2: 'pan_scan_rect',
  3: 'filler_payload',
  4: 'user_data_registered_itu_t_t35',
  5: 'user_data_unregistered',
  6: 'recovery_point',
  7: 'dec_ref_pic_marking_repetition',
  8: 'spare_pic',
  9: 'scene_info',
  10: 'sub_seq_info',
  11: 'sub_seq_layer_characteristics',
  12: 'sub_seq_characteristics',
  13: 'full_frame_freeze',
  14: 'full_frame_freeze_release',
  15: 'full_frame_snapshot',
  16: 'progressive_refinement_segment_start',
  17: 'progressive_refinement_segment_end',
  18: 'motion_constrained_slice_group_set',
  19: 'film_grain_characteristics',
  20: 'deblocking_filter_display_preference',
  21: 'stereo_video_info',
  22: 'post_filter_hint',
  23: 'tone_mapping_info',
  24: 'scalability_info',
  25: 'sub_pic_scalable_layer',
  45: 'frame_packing_arrangement',
  47: 'display_orientation',
  56: 'green_metadata',
  137: 'mastering_display_colour_volume',
  144: 'content_light_level_info',
  147: 'alternative_transfer_characteristics'
};

function parseH264SEI(rbsp, fieldMap = null, bitBase = 8) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const result = { messages: [] };

  for (let messageIndex = 0; hasMoreSeiMessageData(br) && messageIndex < 1024; messageIndex++) {
    const pathPrefix = `parseResult.messages[${messageIndex}]`;
    const message = {};
    parseSeiMessageHeader(br, fieldMap, bitBase, pathPrefix, message);

    const payloadStartBit = br.getBitPos();
    const payloadEndBit = payloadStartBit + message.payloadSize * 8;
    message.name = H264_SEI_PAYLOAD_NAMES[message.payloadType] || 'reserved_sei_message';
    parseH264SeiPayload(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);

    if (br.getBitPos() < payloadEndBit) {
      br.skipBits(payloadEndBit - br.getBitPos());
    }
    result.messages.push(message);
  }

  if (br.getBitPos() < (br.byteEnd - br.byteStart) * 8) {
    result.rbsp_trailing_bits = parseRbspTrailingBits(br, fieldMap, bitBase, 'parseResult.rbsp_trailing_bits');
  }

  return result;
}

function parseH264AUD(rbsp, fieldMap = null, bitBase = 8) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const aud = {};
  aud.primary_pic_type = readMappedBits(br, fieldMap, 'parseResult.primary_pic_type', 3, bitBase);
  if (br.getBitPos() < (br.byteEnd - br.byteStart) * 8) {
    aud.rbsp_trailing_bits = parseRbspTrailingBits(br, fieldMap, bitBase, 'parseResult.rbsp_trailing_bits');
  }
  return aud;
}

function parseH264FillerData(rbsp, fieldMap = null, bitBase = 8) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const filler = { ff_byte: [] };
  const totalBits = (br.byteEnd - br.byteStart) * 8;
  for (let i = 0; br.getBitPos() + 8 <= totalBits && br.peekBits(8) === 0xFF; i++) {
    filler.ff_byte[i] = readMappedBitsWithCoding(br, fieldMap, `parseResult.ff_byte[${i}]`, 8, bitBase, `ff_byte[${i}]`, 'f(8)');
  }
  if (br.getBitPos() < totalBits) {
    filler.rbsp_trailing_bits = parseRbspTrailingBits(br, fieldMap, bitBase, 'parseResult.rbsp_trailing_bits');
  }
  return filler;
}

function parseH264EmptyRbsp(syntax) {
  return { syntax };
}

function parseH264RawRbsp(rbsp, syntax, fieldMap = null, bitBase = 8) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const result = { syntax, rbsp_byte: [] };
  const totalBits = (br.byteEnd - br.byteStart) * 8;
  for (let i = 0; br.getBitPos() + 8 <= totalBits; i++) {
    result.rbsp_byte[i] = readMappedBitsWithCoding(br, fieldMap, `parseResult.rbsp_byte[${i}]`, 8, bitBase, `rbsp_byte[${i}]`, 'b(8)');
  }
  return result;
}

function h264RawRbspSyntaxName(nalType) {
  if (nalType === 13) return 'seq_parameter_set_extension_rbsp';
  if (nalType === 14) return 'prefix_nal_unit_rbsp';
  if (nalType === 15) return 'subset_seq_parameter_set_rbsp';
  if (nalType === 16) return 'depth_parameter_set_rbsp';
  if (nalType === 17 || nalType === 22 || nalType === 23 || nalType === 30 || nalType === 31) return 'reserved_non_vcl_nal_unit';
  return 'unspecified_non_vcl_nal_unit';
}

function parseH264SeiPayload(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  if (message.name === 'user_data_unregistered') {
    parseSeiUserDataUnregistered(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
  } else if (message.name === 'mastering_display_colour_volume') {
    parseH265MasteringDisplayColourVolume(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
  } else if (message.name === 'content_light_level_info') {
    parseH265ContentLightLevelInfo(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
  } else {
    parseSeiReservedPayload(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
  }
  parseSeiPayloadTrailingBits(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
}

function parseSeiMessageHeader(br, fieldMap, bitBase, pathPrefix, message) {
  message.payloadType = 0;
  message.ff_byte = [];
  for (let i = 0; br.peekBits(8) === 0xFF; i++) {
    message.ff_byte[i] = readMappedBits(br, fieldMap, `${pathPrefix}.ff_byte[${i}]`, 8, bitBase, `ff_byte[${i}]`);
    message.payloadType += 255;
  }
  message.last_payload_type_byte = readMappedBits(br, fieldMap, `${pathPrefix}.last_payload_type_byte`, 8, bitBase);
  message.payloadType += message.last_payload_type_byte;

  message.payloadSize = 0;
  message.ff_payload_size_byte = [];
  for (let i = 0; br.peekBits(8) === 0xFF; i++) {
    message.ff_payload_size_byte[i] = readMappedBits(br, fieldMap, `${pathPrefix}.ff_payload_size_byte[${i}]`, 8, bitBase, `ff_payload_size_byte[${i}]`);
    message.payloadSize += 255;
  }
  message.last_payload_size_byte = readMappedBits(br, fieldMap, `${pathPrefix}.last_payload_size_byte`, 8, bitBase);
  message.payloadSize += message.last_payload_size_byte;
}

function parseSeiUserDataUnregistered(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  const uuidStart = br.getBitPos();
  message.uuid_iso_iec_11578 = [];
  for (let i = 0; i < 16 && br.getBitPos() + 8 <= payloadEndBit; i++) {
    message.uuid_iso_iec_11578[i] = br.readBits(8);
  }
  const uuidEnd = br.getBitPos();
  if (fieldMap && uuidEnd > uuidStart) {
    addFieldRange(
      fieldMap,
      `${pathPrefix}.uuid_iso_iec_11578`,
      'uuid_iso_iec_11578',
      message.uuid_iso_iec_11578,
      bitBase + uuidStart,
      bitBase + uuidEnd,
      'u(128)',
      readRawBits(br, uuidStart, uuidEnd, 128)
    );
  }

  message.user_data_payload_byte = [];
  for (let i = 16; br.getBitPos() + 8 <= payloadEndBit; i++) {
    message.user_data_payload_byte[i] = readMappedBitsWithCoding(
      br,
      fieldMap,
      `${pathPrefix}.user_data_payload_byte[${i}]`,
      8,
      bitBase,
      `user_data_payload_byte[${i}]`,
      'b(8)'
    );
  }
  message.user_data = bytesToPrintableAscii(message.user_data_payload_byte.filter(value => value != null));
}

function parseSeiReservedPayload(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  message.reserved_sei_message_payload_byte = [];
  for (let i = 0; br.getBitPos() + 8 <= payloadEndBit; i++) {
    message.reserved_sei_message_payload_byte[i] = readMappedBitsWithCoding(
      br,
      fieldMap,
      `${pathPrefix}.reserved_sei_message_payload_byte[${i}]`,
      8,
      bitBase,
      `reserved_sei_message_payload_byte[${i}]`,
      'b(8)'
    );
  }
}

function parseSeiPayloadTrailingBits(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  if (br.getBitPos() >= payloadEndBit) return;
  message.payload_bit_equal_to_one = readMappedBitsWithCoding(br, fieldMap, `${pathPrefix}.payload_bit_equal_to_one`, 1, bitBase, null, 'f(1)');
  message.payload_bit_equal_to_zero = [];
  for (let i = 0; br.getBitPos() < payloadEndBit && br.getBitPos() % 8 !== 0; i++) {
    message.payload_bit_equal_to_zero[i] = readMappedBitsWithCoding(
      br,
      fieldMap,
      `${pathPrefix}.payload_bit_equal_to_zero[${i}]`,
      1,
      bitBase,
      `payload_bit_equal_to_zero[${i}]`,
      'f(1)'
    );
  }
}

function hasMoreSeiMessageData(br) {
  const bitPos = br.getBitPos();
  const totalBits = (br.byteEnd - br.byteStart) * 8;
  if (bitPos >= totalBits) return false;
  return !h265RemainingBitsAreRbspTrailingBits(br, bitPos, totalBits);
}

/* ===================================================================
 *  H.265 SEI Parser (H.265 §7.3.2.4)
 * =================================================================== */
const H265_PREFIX_SEI_PAYLOAD_NAMES = {
  0: 'buffering_period',
  1: 'pic_timing',
  2: 'pan_scan_rect',
  3: 'filler_payload',
  4: 'user_data_registered_itu_t_t35',
  5: 'user_data_unregistered',
  6: 'recovery_point',
  9: 'scene_info',
  15: 'picture_snapshot',
  16: 'progressive_refinement_segment_start',
  17: 'progressive_refinement_segment_end',
  19: 'film_grain_characteristics',
  22: 'post_filter_hint',
  23: 'tone_mapping_info',
  45: 'frame_packing_arrangement',
  47: 'display_orientation',
  56: 'green_metadata',
  128: 'structure_of_pictures_info',
  129: 'active_parameter_sets',
  130: 'decoding_unit_info',
  131: 'temporal_sub_layer_zero_idx',
  133: 'scalable_nesting',
  134: 'region_refresh_info',
  135: 'no_display',
  136: 'time_code',
  137: 'mastering_display_colour_volume',
  138: 'segmented_rect_frame_packing_arrangement',
  139: 'temporal_motion_constrained_tile_sets',
  140: 'chroma_resampling_filter_hint',
  141: 'knee_function_info',
  142: 'colour_remapping_info',
  143: 'deinterlaced_field_identification',
  144: 'content_light_level_info',
  145: 'dependent_rap_indication',
  146: 'coded_region_completion',
  147: 'alternative_transfer_characteristics',
  148: 'ambient_viewing_environment',
  149: 'content_colour_volume',
  150: 'equirectangular_projection',
  151: 'cubemap_projection',
  152: 'fisheye_video_info',
  154: 'sphere_rotation',
  155: 'regionwise_packing',
  156: 'omni_viewport',
  157: 'regional_nesting',
  158: 'mcts_extraction_info_sets',
  159: 'mcts_extraction_info_nesting',
  160: 'layers_not_present',
  161: 'inter_layer_constrained_tile_sets',
  162: 'bsp_nesting',
  163: 'bsp_initial_arrival_time',
  164: 'sub_bitstream_property',
  165: 'alpha_channel_info',
  166: 'overlay_info',
  167: 'temporal_mv_prediction_constraints',
  168: 'frame_field_info',
  176: 'three_dimensional_reference_displays_info',
  177: 'depth_representation_info',
  178: 'multiview_scene_info',
  179: 'multiview_acquisition_info',
  180: 'multiview_view_position',
  181: 'alternative_depth_info',
  200: 'sei_manifest',
  201: 'sei_prefix_indication',
  202: 'annotated_regions',
  205: 'shutter_interval_info',
  210: 'nn_post_filter_characteristics',
  211: 'nn_post_filter_activation',
  212: 'phase_indication',
  213: 'sei_processing_order',
  214: 'processing_order_nesting',
  215: 'encoder_optimization_info',
  216: 'source_picture_timing_info',
  218: 'modality_info',
  220: 'digitally_signed_content_initialization',
  221: 'digitally_signed_content_selection',
  225: 'ai_usage_restrictions_request',
  226: 'packed_regions_info'
};

const H265_SUFFIX_SEI_PAYLOAD_NAMES = {
  3: 'filler_payload',
  4: 'user_data_registered_itu_t_t35',
  5: 'user_data_unregistered',
  17: 'progressive_refinement_segment_end',
  22: 'post_filter_hint',
  132: 'decoded_picture_hash'
};

function parseH265SEI(rbsp, fieldMap = null, bitBase = 16, nalType = 39) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const result = { messages: [] };

  for (let messageIndex = 0; h265HasMoreSeiMessageData(br) && messageIndex < 1024; messageIndex++) {
    const pathPrefix = `parseResult.messages[${messageIndex}]`;
    const message = {};
    parseH265SeiMessageHeader(br, fieldMap, bitBase, pathPrefix, message);

    const payloadStartBit = br.getBitPos();
    const payloadEndBit = payloadStartBit + message.payloadSize * 8;
    message.name = h265SeiPayloadName(nalType, message.payloadType);
    parseH265SeiPayload(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);

    if (br.getBitPos() < payloadEndBit) {
      br.skipBits(payloadEndBit - br.getBitPos());
    }
    result.messages.push(message);
  }

  if (br.getBitPos() < (br.byteEnd - br.byteStart) * 8) {
    result.rbsp_trailing_bits = parseRbspTrailingBits(br, fieldMap, bitBase, 'parseResult.rbsp_trailing_bits');
  }

  return result;
}

function parseH265AUD(rbsp, fieldMap = null, bitBase = 16) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const aud = {};
  aud.pic_type = readMappedBits(br, fieldMap, 'parseResult.pic_type', 3, bitBase);
  if (br.getBitPos() < (br.byteEnd - br.byteStart) * 8) {
    aud.rbsp_trailing_bits = parseRbspTrailingBits(br, fieldMap, bitBase, 'parseResult.rbsp_trailing_bits');
  }
  return aud;
}

function parseH265FillerData(rbsp, fieldMap = null, bitBase = 16) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const filler = { ff_byte: [] };
  for (let i = 0; br.getBitPos() + 8 <= (br.byteEnd - br.byteStart) * 8 && br.peekBits(8) === 0xFF; i++) {
    filler.ff_byte[i] = readMappedBitsWithCoding(br, fieldMap, `parseResult.ff_byte[${i}]`, 8, bitBase, `ff_byte[${i}]`, 'f(8)');
  }
  if (br.getBitPos() < (br.byteEnd - br.byteStart) * 8) {
    filler.rbsp_trailing_bits = parseRbspTrailingBits(br, fieldMap, bitBase, 'parseResult.rbsp_trailing_bits');
  }
  return filler;
}

function parseH265EmptyRbsp(syntax) {
  return { syntax };
}

function parseH265RawRbsp(rbsp, syntax, fieldMap = null, bitBase = 16) {
  const br = new BitReader(rbsp, 0, rbsp.length);
  const result = { syntax, rbsp_byte: [] };
  const totalBits = (br.byteEnd - br.byteStart) * 8;
  for (let i = 0; br.getBitPos() + 8 <= totalBits; i++) {
    result.rbsp_byte[i] = readMappedBitsWithCoding(br, fieldMap, `parseResult.rbsp_byte[${i}]`, 8, bitBase, `rbsp_byte[${i}]`, 'b(8)');
  }
  return result;
}

function parseH265SeiMessageHeader(br, fieldMap, bitBase, pathPrefix, message) {
  message.payloadType = 0;
  message.ff_byte = [];
  for (let i = 0; br.peekBits(8) === 0xFF; i++) {
    message.ff_byte[i] = readMappedBits(br, fieldMap, `${pathPrefix}.ff_byte[${i}]`, 8, bitBase, `ff_byte[${i}]`);
    message.payloadType += 255;
  }
  message.last_payload_type_byte = readMappedBits(br, fieldMap, `${pathPrefix}.last_payload_type_byte`, 8, bitBase);
  message.payloadType += message.last_payload_type_byte;

  message.payloadSize = 0;
  message.ff_payload_size_byte = [];
  for (let i = 0; br.peekBits(8) === 0xFF; i++) {
    message.ff_payload_size_byte[i] = readMappedBits(br, fieldMap, `${pathPrefix}.ff_payload_size_byte[${i}]`, 8, bitBase, `ff_byte[${i}]`);
    message.payloadSize += 255;
  }
  message.last_payload_size_byte = readMappedBits(br, fieldMap, `${pathPrefix}.last_payload_size_byte`, 8, bitBase);
  message.payloadSize += message.last_payload_size_byte;
}

function h265SeiPayloadName(nalType, payloadType) {
  const table = nalType === 40 ? H265_SUFFIX_SEI_PAYLOAD_NAMES : H265_PREFIX_SEI_PAYLOAD_NAMES;
  return table[payloadType] || 'reserved_sei_message';
}

function parseH265SeiPayload(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  if (message.name === 'user_data_unregistered') {
    parseH265UserDataUnregistered(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
  } else if (message.name === 'structure_of_pictures_info') {
    parseH265StructureOfPicturesInfo(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
  } else if (message.name === 'mastering_display_colour_volume') {
    parseH265MasteringDisplayColourVolume(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
  } else if (message.name === 'content_light_level_info') {
    parseH265ContentLightLevelInfo(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
  } else {
    parseH265ReservedSeiMessage(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
  }
  parseH265SeiPayloadTrailingBits(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit);
}

function parseH265UserDataUnregistered(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  const uuidStart = br.getBitPos();
  message.uuid_iso_iec_11578 = [];
  for (let i = 0; i < 16 && br.getBitPos() + 8 <= payloadEndBit; i++) {
    message.uuid_iso_iec_11578[i] = br.readBits(8);
  }
  const uuidEnd = br.getBitPos();
  if (fieldMap && uuidEnd > uuidStart) {
    addFieldRange(
      fieldMap,
      `${pathPrefix}.uuid_iso_iec_11578`,
      'uuid_iso_iec_11578',
      message.uuid_iso_iec_11578,
      bitBase + uuidStart,
      bitBase + uuidEnd,
      'u(128)',
      readRawBits(br, uuidStart, uuidEnd, 128)
    );
  }

  message.user_data_payload_byte = [];
  for (let i = 16; br.getBitPos() + 8 <= payloadEndBit; i++) {
    message.user_data_payload_byte[i] = readMappedBitsWithCoding(
      br,
      fieldMap,
      `${pathPrefix}.user_data_payload_byte[${i}]`,
      8,
      bitBase,
      `user_data_payload_byte[${i}]`,
      'b(8)'
    );
  }
  message.user_data = bytesToPrintableAscii(message.user_data_payload_byte.filter(value => value != null));
}

function parseH265StructureOfPicturesInfo(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  if (br.getBitPos() >= payloadEndBit) return;
  message.sop_seq_parameter_set_id = readMappedUE(br, fieldMap, `${pathPrefix}.sop_seq_parameter_set_id`, bitBase);
  if (br.getBitPos() >= payloadEndBit) return;
  message.num_entries_in_sop_minus1 = readMappedUE(br, fieldMap, `${pathPrefix}.num_entries_in_sop_minus1`, bitBase);
  message.sop_vcl_nut = [];
  message.sop_temporal_id = [];
  message.sop_short_term_rps_idx = [];
  message.sop_poc_delta = [];
  for (let i = 0; i <= message.num_entries_in_sop_minus1 && br.getBitPos() < payloadEndBit; i++) {
    message.sop_vcl_nut[i] = readMappedBits(br, fieldMap, `${pathPrefix}.sop_vcl_nut[${i}]`, 6, bitBase, `sop_vcl_nut[${i}]`);
    message.sop_temporal_id[i] = readMappedBits(br, fieldMap, `${pathPrefix}.sop_temporal_id[${i}]`, 3, bitBase, `sop_temporal_id[${i}]`);
    if (message.sop_vcl_nut[i] !== 19 && message.sop_vcl_nut[i] !== 20 && br.getBitPos() < payloadEndBit) {
      message.sop_short_term_rps_idx[i] = readMappedUE(br, fieldMap, `${pathPrefix}.sop_short_term_rps_idx[${i}]`, bitBase, `sop_short_term_rps_idx[${i}]`);
    }
    if (i > 0 && br.getBitPos() < payloadEndBit) {
      message.sop_poc_delta[i] = readMappedSE(br, fieldMap, `${pathPrefix}.sop_poc_delta[${i}]`, bitBase, `sop_poc_delta[${i}]`);
    }
  }
}

function parseH265MasteringDisplayColourVolume(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  message.display_primaries_x = [];
  message.display_primaries_y = [];
  for (let c = 0; c < 3 && br.getBitPos() + 32 <= payloadEndBit; c++) {
    message.display_primaries_x[c] = readMappedBits(br, fieldMap, `${pathPrefix}.display_primaries_x[${c}]`, 16, bitBase, `display_primaries_x[${c}]`);
    message.display_primaries_y[c] = readMappedBits(br, fieldMap, `${pathPrefix}.display_primaries_y[${c}]`, 16, bitBase, `display_primaries_y[${c}]`);
  }
  if (br.getBitPos() + 16 <= payloadEndBit) message.white_point_x = readMappedBits(br, fieldMap, `${pathPrefix}.white_point_x`, 16, bitBase);
  if (br.getBitPos() + 16 <= payloadEndBit) message.white_point_y = readMappedBits(br, fieldMap, `${pathPrefix}.white_point_y`, 16, bitBase);
  if (br.getBitPos() + 32 <= payloadEndBit) message.max_display_mastering_luminance = readMappedBits(br, fieldMap, `${pathPrefix}.max_display_mastering_luminance`, 32, bitBase);
  if (br.getBitPos() + 32 <= payloadEndBit) message.min_display_mastering_luminance = readMappedBits(br, fieldMap, `${pathPrefix}.min_display_mastering_luminance`, 32, bitBase);
}

function parseH265ContentLightLevelInfo(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  if (br.getBitPos() + 16 <= payloadEndBit) message.max_content_light_level = readMappedBits(br, fieldMap, `${pathPrefix}.max_content_light_level`, 16, bitBase);
  if (br.getBitPos() + 16 <= payloadEndBit) message.max_pic_average_light_level = readMappedBits(br, fieldMap, `${pathPrefix}.max_pic_average_light_level`, 16, bitBase);
}

function parseH265ReservedSeiMessage(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  message.reserved_sei_message_payload_byte = [];
  for (let i = 0; br.getBitPos() + 8 <= payloadEndBit; i++) {
    message.reserved_sei_message_payload_byte[i] = readMappedBitsWithCoding(
      br,
      fieldMap,
      `${pathPrefix}.reserved_sei_message_payload_byte[${i}]`,
      8,
      bitBase,
      `reserved_sei_message_payload_byte[${i}]`,
      'b(8)'
    );
  }
}

function parseH265SeiPayloadTrailingBits(br, fieldMap, bitBase, pathPrefix, message, payloadEndBit) {
  if (br.getBitPos() >= payloadEndBit) return;
  message.payload_bit_equal_to_one = readMappedBitsWithCoding(br, fieldMap, `${pathPrefix}.payload_bit_equal_to_one`, 1, bitBase, null, 'f(1)');
  message.payload_bit_equal_to_zero = [];
  for (let i = 0; br.getBitPos() < payloadEndBit && br.getBitPos() % 8 !== 0; i++) {
    message.payload_bit_equal_to_zero[i] = readMappedBitsWithCoding(
      br,
      fieldMap,
      `${pathPrefix}.payload_bit_equal_to_zero[${i}]`,
      1,
      bitBase,
      `payload_bit_equal_to_zero[${i}]`,
      'f(1)'
    );
  }
}

function parseRbspTrailingBits(br, fieldMap, bitBase = 0, pathPrefix = 'parseResult.rbsp_trailing_bits') {
  const trailing = {};
  trailing.rbsp_stop_one_bit = readMappedBitsWithCoding(br, fieldMap, `${pathPrefix}.rbsp_stop_one_bit`, 1, bitBase, null, 'f(1)');
  trailing.rbsp_alignment_zero_bit = [];
  for (let i = 0; br.getBitPos() % 8 !== 0 && br.getBitPos() < (br.byteEnd - br.byteStart) * 8; i++) {
    trailing.rbsp_alignment_zero_bit[i] = readMappedBitsWithCoding(
      br,
      fieldMap,
      `${pathPrefix}.rbsp_alignment_zero_bit[${i}]`,
      1,
      bitBase,
      `rbsp_alignment_zero_bit[${i}]`,
      'f(1)'
    );
  }
  return trailing;
}

function h265HasMoreSeiMessageData(br) {
  const bitPos = br.getBitPos();
  const totalBits = (br.byteEnd - br.byteStart) * 8;
  if (bitPos >= totalBits) return false;
  return !h265RemainingBitsAreRbspTrailingBits(br, bitPos, totalBits);
}

function h265RemainingBitsAreRbspTrailingBits(br, bitPos, totalBits) {
  if (bitPos >= totalBits) return true;
  if (readBitFromReaderBuffer(br, bitPos) !== 1) return false;
  for (let bit = bitPos + 1; bit < totalBits; bit++) {
    if (readBitFromReaderBuffer(br, bit) !== 0) return false;
  }
  return true;
}

function readBitFromReaderBuffer(br, relativeBit) {
  const byte = br.buffer[br.byteStart + Math.floor(relativeBit / 8)];
  return (byte >> (7 - (relativeBit % 8))) & 1;
}

function bytesToPrintableAscii(bytes) {
  return String.fromCharCode(...bytes.map(value => (value >= 32 && value < 127) ? value : 46));
}

/* ===================================================================
 *  H.264 NAL Header (H.264 §7.3.1)
 * =================================================================== */
function parseH264NALHeader(data, nal, fieldMap = null) {
  const byte = data[nal.offset];
  const header = {
    forbidden_zero_bit: (byte >> 7) & 1,
    nal_ref_idc: (byte >> 5) & 3,
    nal_unit_type: byte & 0x1F
  };
  addFieldRange(fieldMap, 'header.forbidden_zero_bit', 'forbidden_zero_bit', header.forbidden_zero_bit, 0, 1, 'u(1)', String(header.forbidden_zero_bit));
  addFieldRange(fieldMap, 'header.nal_ref_idc', 'nal_ref_idc', header.nal_ref_idc, 1, 3, 'u(2)', header.nal_ref_idc.toString(2).padStart(2, '0'));
  addFieldRange(fieldMap, 'header.nal_unit_type', 'nal_unit_type', header.nal_unit_type, 3, 8, 'u(5)', header.nal_unit_type.toString(2).padStart(5, '0'));
  return header;
}

/* ===================================================================
 *  H.265 NAL Header (H.265 §7.3.1.2)
 * =================================================================== */
function parseH265NALHeader(data, nal, fieldMap = null) {
  if (nal.length < 2) {
    return { error: 'NAL too short for H.265 header' };
  }
  const b0 = data[nal.offset];
  const b1 = data[nal.offset + 1];
  const header = {
    forbidden_zero_bit: (b0 >> 7) & 1,
    nal_unit_type: ((b0 & 0x7E) >> 1),
    nuh_layer_id: ((b0 & 0x01) << 6) | ((b1 >> 3) & 0x3F),
    nuh_temporal_id_plus1: b1 & 0x07
  };
  addFieldRange(fieldMap, 'header.forbidden_zero_bit', 'forbidden_zero_bit', header.forbidden_zero_bit, 0, 1, 'u(1)', String(header.forbidden_zero_bit));
  addFieldRange(fieldMap, 'header.nal_unit_type', 'nal_unit_type', header.nal_unit_type, 1, 7, 'u(6)', header.nal_unit_type.toString(2).padStart(6, '0'));
  addFieldRange(fieldMap, 'header.nuh_layer_id', 'nuh_layer_id', header.nuh_layer_id, 7, 13, 'u(6)', header.nuh_layer_id.toString(2).padStart(6, '0'));
  addFieldRange(fieldMap, 'header.nuh_temporal_id_plus1', 'nuh_temporal_id_plus1', header.nuh_temporal_id_plus1, 13, 16, 'u(3)', header.nuh_temporal_id_plus1.toString(2).padStart(3, '0'));
  return header;
}

/* ===================================================================
 *  Detect codec from NAL headers
 * =================================================================== */
function detectCodec(data, nals) {
  if (nals.length === 0) return null;

  // Try first few NALs
  for (let i = 0; i < Math.min(nals.length, 10); i++) {
    const nal = nals[i];
    if (nal.length < 2) continue;
    const firstByte = data[nal.offset];
    const nalType264 = firstByte & 0x1F;
    const nalType265 = (firstByte & 0x7E) >> 1;
    const layerId265 = ((firstByte & 0x01) << 6) | ((data[nal.offset + 1] >> 3) & 0x3F);

    // H.264: top bit is forbidden, next 2 bits are ref_idc, bottom 5 are type
    // H.265: top bit is forbidden, next 6 bits are type, then 1 bit for layer
    if (nalType264 === 7 && nal.offset + 1 < data.length && data[nal.offset + 1] < 0x80) {
      // Likely H.264 SPS
      return 'h264';
    }
    if (nalType265 === 33 || nalType265 === 32) {
      // H.265 SPS or VPS
      return 'h265';
    }
    if (layerId265 === 0 && nalType265 <= 63 && nalType265 > 0) {
      return 'h265';
    }
  }
  // Fallback: check if any byte looks like a 4-byte start code prefix that follows MP4 structure
  return null;
}

/* ===================================================================
 *  Detect MP4/container format
 * =================================================================== */
function detectContainerFormat(data) {
  if (data.length < 12) return null;
  // Check for ftyp box (MP4)
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    return 'MP4/MOV container detected — please extract the raw Annex B bitstream first';
  }
  // Check for MKV/WebM (EBML)
  if (data[0] === 0x1A && data[1] === 0x45 && data[2] === 0xDF && data[3] === 0xA3) {
    return 'MKV/WebM container detected — please extract the raw Annex B bitstream first';
  }
  return null;
}

/* ===================================================================
 *  Main Parse Entry Point
 * =================================================================== */
function parseBitstream(data) {
  // Progress reporting helper
  const totalSize = data.length;

  self.postMessage({ type: 'progress', progress: 0, message: 'Scanning NAL units...' });

  // === Step 0: Detect container ===
  const containerError = detectContainerFormat(data);
  if (containerError) {
    self.postMessage({ type: 'error', message: containerError });
    return;
  }

  // === Step 1: Scan NAL units ===
  const nals = scanNALUnits(data);

  if (nals.length === 0) {
    self.postMessage({ type: 'error', message: 'No NAL units found. This may not be a valid Annex B bitstream. Check that the file is a raw .h264 or .h265 file, not a container format (MP4/MKV).' });
    return;
  }

  self.postMessage({ type: 'progress', progress: 10, message: `Found ${nals.length} NAL units, detecting codec...` });

  // === Step 2: Detect codec ===
  const codec = detectCodec(data, nals);
  if (!codec) {
    self.postMessage({ type: 'error', message: 'Could not determine codec (H.264 or H.265). The bitstream may be corrupted or is not a recognized format.' });
    return;
  }

  self.postMessage({ type: 'progress', progress: 15, message: `Detected ${codec.toUpperCase()} codec. Parsing headers...` });

  // === Step 3: Parse NAL headers ===
  const nalResults = [];
  const spsMap264 = {};
  const ppsMap264 = {};
  const vpsMap265 = {};
  const spsMap265 = {};
  const ppsMap265 = {};
  const frames = [];
  const seiMessages = [];
  const errors = [];

  let vclCount = 0;

  for (let i = 0; i < nals.length; i++) {
    const nal = nals[i];
    const progress = 15 + Math.floor((i / nals.length) * 70);
    if (i % 50 === 0) {
      self.postMessage({ type: 'progress', progress, message: `Parsing NAL ${i + 1}/${nals.length}...` });
    }

    let header, typeName, typeNum, refIdc, layerId, temporalId;
    let parseResult = null;
    const fieldMap = [];

    if (codec === 'h264') {
      header = parseH264NALHeader(data, nal, fieldMap);
      typeNum = header.nal_unit_type;
      typeName = H264_NAL_TYPES[typeNum] || `Reserved (${typeNum})`;
      refIdc = header.nal_ref_idc;
      layerId = 0;
      temporalId = (refIdc > 0) ? Math.min(refIdc, 1) : 0;

      try {
        const headerSize264 = 1;
        const rbsp = removeEmulationPrevention(data, nal.offset + headerSize264, nal.length - headerSize264);
        if (H264_VCL_TYPES.has(typeNum)) {
          // VCL NAL — parse slice header
          const sh = parseH264SliceHeader(rbsp, typeNum, spsMap264, ppsMap264, refIdc);
          mapH264SliceHeaderFields(rbsp, typeNum, spsMap264, ppsMap264, fieldMap, 8, refIdc);
          sh.temporal_id = temporalId;
          vclCount++;
          frames.push({
            nalIndex: i,
            nal_unit_type: typeNum,
            type_name: typeName,
            slice_type: sh.is_idr ? 'IDR' : sh.slice_type_name,
            is_idr: sh.is_idr,
            is_output: true,
            poc: sh.pic_order_cnt_lsb,
            frame_num: sh.frame_num,
            temporal_id: temporalId,
            pic_parameter_set_id: sh.pic_parameter_set_id,
            first_mb_in_slice: sh.first_mb_in_slice
          });
          parseResult = sh;
        } else if (typeNum === 7) {
          // SPS
          const sps = parseH264SPS(rbsp, nal);
          mapH264SPSFields(rbsp, fieldMap);
          spsMap264[sps.seq_parameter_set_id] = sps;
          parseResult = sps;
        } else if (typeNum === 8) {
          // PPS
          const pps = parseH264PPS(rbsp, spsMap264);
          mapH264PPSFields(rbsp, fieldMap, 8, spsMap264);
          ppsMap264[pps.pic_parameter_set_id] = pps;
          parseResult = pps;
        } else if (typeNum === 6) {
          // SEI
          const seiResult = parseH264SEI(rbsp, fieldMap, 8);
          for (const sei of seiResult.messages) {
            sei.nalIndex = i;
            seiMessages.push(sei);
          }
          parseResult = seiResult;
        } else if (typeNum === 9) {
          parseResult = parseH264AUD(rbsp, fieldMap, 8);
        } else if (typeNum === 10) {
          parseResult = parseH264EmptyRbsp('end_of_seq_rbsp');
        } else if (typeNum === 11) {
          parseResult = parseH264EmptyRbsp('end_of_stream_rbsp');
        } else if (typeNum === 12) {
          parseResult = parseH264FillerData(rbsp, fieldMap, 8);
        } else if (typeNum === 13 || typeNum === 14 || typeNum === 15 || typeNum === 16 || typeNum === 17 || typeNum === 22 || typeNum === 23 || typeNum >= 24) {
          parseResult = parseH264RawRbsp(rbsp, h264RawRbspSyntaxName(typeNum), fieldMap, 8);
        }
      } catch (e) {
        errors.push({ nalIndex: i, type: typeName, error: e.message });
      }
    } else {
      // H.265
      header = parseH265NALHeader(data, nal, fieldMap);
      if (header.error) {
        errors.push({ nalIndex: i, type: '?', error: header.error });
        continue;
      }
      typeNum = header.nal_unit_type;
      typeName = H265_NAL_TYPES[typeNum] || `Reserved (${typeNum})`;
      refIdc = 0;
      layerId = header.nuh_layer_id;
      temporalId = header.nuh_temporal_id_plus1 - 1;

      try {
        const headerSize265 = 2;
        const rbsp = removeEmulationPrevention(data, nal.offset + headerSize265, nal.length - headerSize265);
        if (H265_VCL_TYPES.has(typeNum) && rbsp.length > 2) {
          const sh = parseH265SliceHeader(rbsp, typeNum, spsMap265, ppsMap265, fieldMap, 16);
          sh.temporal_id = temporalId;
          vclCount++;
          const isIRAP = H265_IRAP_TYPES.has(typeNum);
          const isIDR = typeNum === 19 || typeNum === 20;
          const isRASL = H265_RASL_TYPES.has(typeNum);
          frames.push({
            nalIndex: i,
            nal_unit_type: typeNum,
            type_name: typeName,
            slice_type: isIDR ? 'IDR' : (sh.slice_type_name || (isIRAP ? 'I' : '?')),
            is_irap: isIRAP,
            is_idr: isIDR,
            is_rasl: isRASL,
            is_output: !isRASL,
            poc: sh.slice_pic_order_cnt_lsb,
            frame_num: 0,
            temporal_id: temporalId,
            pic_parameter_set_id: sh.slice_pic_parameter_set_id,
            first_slice_segment_in_pic_flag: sh.first_slice_segment_in_pic_flag,
            slice_segment_address: sh.slice_segment_address
          });
          parseResult = sh;
        } else if (typeNum === 32) {
          const vps = parseH265VPS(rbsp, fieldMap, 16);
          vpsMap265[vps.vps_video_parameter_set_id] = vps;
          parseResult = vps;
        } else if (typeNum === 33) {
          const sps = parseH265SPS(rbsp, fieldMap, 16);
          spsMap265[sps.sps_seq_parameter_set_id] = sps;
          parseResult = sps;
        } else if (typeNum === 34) {
          const pps = parseH265PPS(rbsp, fieldMap, 16);
          ppsMap265[pps.pps_pic_parameter_set_id] = pps;
          parseResult = pps;
        } else if (typeNum === 35) {
          parseResult = parseH265AUD(rbsp, fieldMap, 16);
        } else if (typeNum === 36) {
          parseResult = parseH265EmptyRbsp('end_of_seq_rbsp');
        } else if (typeNum === 37) {
          parseResult = parseH265EmptyRbsp('end_of_bitstream_rbsp');
        } else if (typeNum === 38) {
          parseResult = parseH265FillerData(rbsp, fieldMap, 16);
        } else if (typeNum === 39 || typeNum === 40) {
          const seiResult = parseH265SEI(rbsp, fieldMap, 16, typeNum);
          for (const sei of seiResult.messages) {
            sei.nalIndex = i;
            seiMessages.push(sei);
          }
          parseResult = seiResult;
        } else if (typeNum >= 41 && typeNum <= 47) {
          parseResult = parseH265RawRbsp(rbsp, 'reserved_non_vcl_nal_unit', fieldMap, 16);
        } else if (typeNum >= 48 && typeNum <= 63) {
          parseResult = parseH265RawRbsp(rbsp, 'unspecified_non_vcl_nal_unit', fieldMap, 16);
        }
      } catch (e) {
        errors.push({ nalIndex: i, type: typeName, error: e.message });
      }
    }

    const headerSize = codec === 'h264' ? 1 : 2;
    const displayBytes = data.subarray(nal.startCodeOffset, nal.byteStreamEnd);
    const displayLength = displayBytes.length;
    const displayFieldMap = mapFieldMapToDisplayBits(fieldMap, nal, data, headerSize);

    nalResults.push({
      index: i,
      nal_unit_type: typeNum,
      type_name: typeName,
      header,
      offset: nal.startCodeOffset,
      startCodeOffset: nal.startCodeOffset,
      payloadOffset: nal.offset,
      length: displayLength,
      payloadLength: nal.length,
      startCodeLen: nal.startCodeLen,
      trailingZeroLen: nal.trailingZeroLen,
      bytes: Array.from(displayBytes),
      nal_ref_idc: refIdc,
      layer_id: layerId,
      temporal_id: temporalId,
      is_vcl: codec === 'h264' ? H264_VCL_TYPES.has(typeNum) : H265_VCL_TYPES.has(typeNum),
      fieldMap: displayFieldMap,
      parseResult
    });
  }

  self.postMessage({ type: 'progress', progress: 85, message: 'Computing GOP statistics...' });

  const pictureFrames = buildPictureFrames(frames, codec);
  const outputFrames = buildOutputFrames(pictureFrames, codec);

  // === Step 4: GOP Analysis ===
  const gopInfo = computeGOP(outputFrames);

  self.postMessage({ type: 'progress', progress: 90, message: 'Preparing results...' });

  // === Step 5: Summary Stats ===
  const summary = {
    codec: codec.toUpperCase(),
    totalNALs: nals.length,
    totalFrames: outputFrames.length,
    totalPictures: pictureFrames.length,
    skippedPictures: pictureFrames.length - outputFrames.length,
    idrFrames: outputFrames.filter(f => f.slice_type === 'IDR' || f.is_idr).length,
    iFrames: outputFrames.filter(f => f.slice_type === 'I').length,
    pFrames: outputFrames.filter(f => f.slice_type === 'P').length,
    bFrames: outputFrames.filter(f => f.slice_type === 'B').length,
    gopCount: gopInfo.gops.length,
    avgGopSize: gopInfo.gops.length > 0 ? Math.round(gopInfo.gops.reduce((a, b) => a + b, 0) / gopInfo.gops.length) : 0,
    maxTemporalId: outputFrames.length > 0 ? Math.max(...outputFrames.map(f => f.temporal_id || 0)) : 0,
    seiCount: seiMessages.length,
    errors: errors.length
  };

  self.postMessage({
    type: 'result',
    codec: codec.toUpperCase(),
    summary,
    nals: nalResults,
    frames: outputFrames,
    gop: gopInfo,
    sei: seiMessages,
    errors,
    paramSets: codec === 'h264'
      ? { SPS: Object.values(spsMap264), PPS: Object.values(ppsMap264) }
      : { VPS: Object.values(vpsMap265), SPS: Object.values(spsMap265), PPS: Object.values(ppsMap265) }
  });

  self.postMessage({ type: 'progress', progress: 100, message: 'Parse complete.' });
}

/* ===================================================================
 *  GOP Analysis
 * =================================================================== */
function buildPictureFrames(sliceFrames, codec) {
  const pictures = [];
  let current = null;

  for (const slice of sliceFrames) {
    if (!current || startsNewPicture(slice, current, codec)) {
      current = {
        ...slice,
        firstNalIndex: slice.nalIndex,
        lastNalIndex: slice.nalIndex,
        nalIndexes: [slice.nalIndex],
        sliceCount: 1
      };
      pictures.push(current);
      continue;
    }

    mergePictureSlice(current, slice);
  }

  return pictures;
}

function buildOutputFrames(pictureFrames, codec) {
  if (codec !== 'h265') return pictureFrames;
  return pictureFrames.filter(frame => frame.is_output !== false && !frame.is_rasl);
}

function startsNewPicture(slice, current, codec) {
  if (codec === 'h265') {
    if (slice.first_slice_segment_in_pic_flag === 1) return true;
    if (slice.first_slice_segment_in_pic_flag === 0) return false;
    return pictureIdentityChanged(slice, current);
  }

  if (slice.first_mb_in_slice === 0) return true;
  if (Number.isFinite(slice.first_mb_in_slice) && slice.first_mb_in_slice > 0) return false;
  return pictureIdentityChanged(slice, current);
}

function pictureIdentityChanged(slice, current) {
  if (slice.poc != null && current.poc != null && slice.poc !== current.poc) return true;
  if (slice.frame_num != null && current.frame_num != null && slice.frame_num !== current.frame_num) return true;
  if (
    slice.pic_parameter_set_id != null &&
    current.pic_parameter_set_id != null &&
    slice.pic_parameter_set_id !== current.pic_parameter_set_id
  ) {
    return true;
  }
  return false;
}

function mergePictureSlice(current, slice) {
  current.lastNalIndex = slice.nalIndex;
  current.nalIndexes.push(slice.nalIndex);
  current.sliceCount += 1;

  current.is_idr = Boolean(current.is_idr || slice.is_idr);
  current.is_irap = Boolean(current.is_irap || slice.is_irap);

  if ((current.slice_type == null || current.slice_type === '?') && slice.slice_type) {
    current.slice_type = slice.slice_type;
  }
  if (current.poc == null && slice.poc != null) {
    current.poc = slice.poc;
  }
  if (current.frame_num == null && slice.frame_num != null) {
    current.frame_num = slice.frame_num;
  }
  if (slice.temporal_id != null && (current.temporal_id == null || slice.temporal_id > current.temporal_id)) {
    current.temporal_id = slice.temporal_id;
  }
}

function computeGOP(frames) {
  const gops = [];
  let currentGOP = 0;
  let gopIndex = -1;

  for (const frame of frames) {
    if (frame.slice_type === 'I' || frame.slice_type === 'IDR') {
      if (currentGOP > 0) {
        gops.push(currentGOP);
      }
      currentGOP = 1;
      gopIndex++;
    } else {
      currentGOP++;
    }
    frame.gop_index = gopIndex >= 0 ? gopIndex : 0;
  }
  if (currentGOP > 0) {
    gops.push(currentGOP);
  }

  return {
    gops,
    sizes: gops,
    totalGOPs: gops.length
  };
}

/* ===================================================================
 *  Worker Message Handler
 * =================================================================== */
self.onmessage = function (e) {
  const { type, buffer } = e.data;

  if (type === 'parse') {
    try {
      const data = new Uint8Array(buffer);
      parseBitstream(data);
    } catch (err) {
      self.postMessage({ type: 'error', message: `Fatal parse error: ${err.message}` });
    }
  }
};
