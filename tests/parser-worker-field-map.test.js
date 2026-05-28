const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let parseResult = null;
const messages = [];

global.self = {
  postMessage(message) {
    messages.push(message);
    if (message.type === 'result') {
      parseResult = message;
    }
  }
};

const workerSource = fs.readFileSync('assets/parser-worker.js', 'utf8');
assert(workerSource.includes('buildPictureFrames'), 'worker should aggregate VCL slices into picture-level frame records');
assert(workerSource.includes('parseH265SPS(rbsp, fieldMap'), 'H.265 SPS parsing should produce field ranges for clickable nodes');
assert(workerSource.includes('parseH265PPS(rbsp, fieldMap'), 'H.265 PPS parsing should produce field ranges for clickable nodes');
assert(workerSource.includes('parseH265SliceHeader(rbsp, typeNum, spsMap265, ppsMap265, fieldMap'), 'H.265 slice headers should produce field ranges for clickable nodes');
assert(workerSource.includes('parseH265AUD'), 'H.265 AUD NAL units should parse access_unit_delimiter_rbsp fields');
assert(workerSource.includes('parseH265FillerData'), 'H.265 FD_NUT NAL units should parse filler_data_rbsp fields');
assert(workerSource.includes('parseH265EmptyRbsp'), 'H.265 EOS/EOB NAL units should expose their empty RBSP syntax node');
assert(workerSource.includes('parseH264AUD'), 'H.264 AUD NAL units should parse access_unit_delimiter_rbsp fields');
assert(workerSource.includes('parseH264FillerData'), 'H.264 filler data NAL units should parse filler_data_rbsp fields');
assert(workerSource.includes('parseH264EmptyRbsp'), 'H.264 end-of-sequence/end-of-stream NAL units should expose their empty RBSP syntax node');
assert(workerSource.includes('scaling_list_delta_coef'), 'H.265 scaling_list_data should expose protocol syntax element scaling_list_delta_coef');
assert(workerSource.includes('sps_extension_data_flag'), 'H.265 SPS extension data flags should be mapped when present');
assert(workerSource.includes('pps_extension_data_flag'), 'H.265 PPS extension data flags should be mapped when present');
vm.runInThisContext(workerSource, { filename: 'assets/parser-worker.js' });

const file = fs.readFileSync('samples/ouput.h264');
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
self.onmessage({ data: { type: 'parse', buffer } });

assert(parseResult, 'worker should post a result message');

const firstNal = parseResult.nals[0];
assert.strictEqual(firstNal.nal_unit_type, 7, 'fixture should start with an H.264 SPS');
assert(Array.isArray(firstNal.bytes), 'NAL result should include raw bytes for detail view');
assert.strictEqual(firstNal.startCodeLen, 4, 'fixture first NAL should use a 4-byte start code');
assert.strictEqual(firstNal.offset, 0, 'NAL offset should point at the Annex B start code');
assert.strictEqual(firstNal.payloadOffset, firstNal.startCodeLen, 'payloadOffset should point at the NAL header after the start code');
assert.strictEqual(firstNal.length, firstNal.bytes.length, 'display length should include the start code');
assert.strictEqual(firstNal.length, firstNal.payloadLength + firstNal.startCodeLen, 'display length should equal payload length plus start code');
assert.deepStrictEqual(firstNal.bytes.slice(0, 4), [0x00, 0x00, 0x00, 0x01], 'display bytes should start with the Annex B start code');
assert.strictEqual(firstNal.bytes[firstNal.startCodeLen], 0x67, 'NAL header should follow the start code');
assert(Array.isArray(firstNal.fieldMap), 'NAL result should include fieldMap for bit highlighting');

function findField(nal, path) {
  return nal.fieldMap.find(field => field.path === path);
}

function withoutSegments(field) {
  const { segments, coding, codeword, ...rest } = field;
  return rest;
}

function decodeHighlightedBits(nal, field) {
  let value = 0;
  let bitLength = 0;
  for (const segment of field.segments || []) {
    for (let bit = segment.startBit; bit < segment.endBit; bit++) {
      const byte = nal.bytes[Math.floor(bit / 8)];
      value = value * 2 + ((byte >> (7 - (bit % 8))) & 1);
      bitLength++;
    }
  }
  return { value, bitLength };
}

function ueBits(value) {
  const codeNum = value + 1;
  const bits = codeNum.toString(2);
  return '0'.repeat(bits.length - 1) + bits;
}

function seBits(value) {
  const codeNum = value <= 0 ? -value * 2 : value * 2 - 1;
  return ueBits(codeNum);
}

function bitsToBytes(bits) {
  const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
  return Uint8Array.from(padded.match(/.{8}/g).map(byte => parseInt(byte, 2)));
}

assert.deepStrictEqual(
  withoutSegments(findField(firstNal, 'header.forbidden_zero_bit')),
  {
    path: 'header.forbidden_zero_bit',
    label: 'forbidden_zero_bit',
    value: 0,
    startBit: 32,
    endBit: 33
  }
);

assert.deepStrictEqual(
  withoutSegments(findField(firstNal, 'header.nal_ref_idc')),
  {
    path: 'header.nal_ref_idc',
    label: 'nal_ref_idc',
    value: 3,
    startBit: 33,
    endBit: 35
  }
);

assert.deepStrictEqual(
  withoutSegments(findField(firstNal, 'header.nal_unit_type')),
  {
    path: 'header.nal_unit_type',
    label: 'nal_unit_type',
    value: 7,
    startBit: 35,
    endBit: 40
  }
);

assert.deepStrictEqual(
  withoutSegments(findField(firstNal, 'parseResult.profile_idc')),
  {
    path: 'parseResult.profile_idc',
    label: 'profile_idc',
    value: 100,
    startBit: 40,
    endBit: 48
  }
);

assert(findField(firstNal, 'parseResult.vui.nal_hrd_parameters_present_flag'), 'SPS VUI should map nal_hrd_parameters_present_flag');
assert(findField(firstNal, 'parseResult.vui.vcl_hrd_parameters_present_flag'), 'SPS VUI should map vcl_hrd_parameters_present_flag');
assert(findField(firstNal, 'parseResult.vui.pic_struct_present_flag'), 'SPS VUI should map pic_struct_present_flag');
assert(findField(firstNal, 'parseResult.vui.bitstream_restriction_flag'), 'SPS VUI should map bitstream_restriction_flag');
assert.strictEqual(firstNal.parseResult.vui.num_units_in_tick, 1, 'SPS VUI should parse unaligned 32-bit num_units_in_tick correctly');
assert.strictEqual(firstNal.parseResult.vui.time_scale, 120, 'SPS VUI should parse unaligned 32-bit time_scale correctly');
assert.strictEqual(firstNal.parseResult.vui.max_dec_frame_buffering, 4, 'SPS VUI should continue correctly after unaligned 32-bit timing fields');
assert.strictEqual(findField(firstNal, 'parseResult.profile_idc').coding, 'u(8)', 'fixed H.264 fields should expose their bit coding');

const h264TimingField = findField(firstNal, 'parseResult.vui.num_units_in_tick');
assert.strictEqual(h264TimingField.coding, 'u(32)', 'H.264 timing field should be marked as fixed-width bits');
assert.deepStrictEqual(
  decodeHighlightedBits(firstNal, h264TimingField),
  { value: 1, bitLength: 32 },
  'H.264 fields crossing emulation-prevention bytes should highlight bits that decode to the parsed value'
);

const h264MaxDecFrameBuffering = findField(firstNal, 'parseResult.vui.max_dec_frame_buffering');
assert.strictEqual(h264MaxDecFrameBuffering.value, 4, 'max_dec_frame_buffering should decode to value 4');
assert.strictEqual(h264MaxDecFrameBuffering.coding, 'ue(v)', 'max_dec_frame_buffering should be marked as Exp-Golomb coded');
assert.strictEqual(h264MaxDecFrameBuffering.codeword, '00101', 'value 4 should preserve its ue(v) codeword 00101');

const ppsNal = parseResult.nals.find(nal => nal.nal_unit_type === 8);
assert(ppsNal, 'fixture should include a PPS');
assert.strictEqual(ppsNal.parseResult.transform_8x8_mode_flag, 1, 'PPS extension should parse transform_8x8_mode_flag');
assert.strictEqual(ppsNal.parseResult.pic_scaling_matrix_present_flag, 0, 'PPS extension should parse pic_scaling_matrix_present_flag');
assert.strictEqual(ppsNal.parseResult.second_chroma_qp_index_offset, -2, 'PPS extension should parse second_chroma_qp_index_offset');
assert(findField(ppsNal, 'parseResult.transform_8x8_mode_flag'), 'PPS extension field should be bit-mapped');
assert(findField(ppsNal, 'parseResult.second_chroma_qp_index_offset'), 'PPS second chroma QP offset should be bit-mapped');

const sliceNal = parseResult.nals.find(nal => nal.nal_unit_type === 5);
assert(sliceNal, 'fixture should include an IDR slice');
assert.strictEqual(sliceNal.parseResult.is_idr, true, 'IDR slice should be identified in parseResult');
const idrFrame = parseResult.frames.find(frame => frame.is_idr);
assert(idrFrame, 'frames should retain IDR identity separately from I slices');
assert.strictEqual(idrFrame.slice_type, 'IDR', 'IDR frames should display as IDR instead of plain I');
assert(parseResult.summary.idrFrames > 0, 'summary should expose an IDR frame count');
assert(parseResult.frames.every(frame => frame.sliceCount >= 1), 'frame records should expose how many VCL slices were merged into each picture');
assert(findField(sliceNal, 'parseResult.first_mb_in_slice'), 'slice header should map first_mb_in_slice');
assert(findField(sliceNal, 'parseResult.slice_type'), 'slice header should map slice_type');
assert(
  findField(sliceNal, 'parseResult.slice_type').endBit > findField(sliceNal, 'parseResult.slice_type').startBit,
  'Exp-Golomb fields should report a non-empty bit range'
);

const lastNal = parseResult.nals[parseResult.nals.length - 1];
assert.strictEqual(lastNal.index + 1, 922, 'fixture should keep the expected last NAL index');
assert.strictEqual(lastNal.offset + lastNal.length, file.length, 'last NAL display range should include bytes through EOF');
assert.strictEqual(lastNal.length, 584, 'last NAL display length should include start code and the final two payload bytes');
assert.deepStrictEqual(
  lastNal.bytes.slice(-2),
  Array.from(file.slice(-2)),
  'last NAL bytes should include the final file bytes'
);
assert(findField(lastNal, 'parseResult.direct_spatial_mv_pred_flag'), 'B slices should parse direct_spatial_mv_pred_flag');
assert(findField(lastNal, 'parseResult.num_ref_idx_active_override_flag'), 'slice headers should parse ref index override flags');
assert(findField(lastNal, 'parseResult.cabac_init_idc'), 'CABAC slices should parse cabac_init_idc');
assert(findField(lastNal, 'parseResult.slice_qp_delta'), 'slice headers should parse slice_qp_delta');
assert(findField(lastNal, 'parseResult.disable_deblocking_filter_idc'), 'slice headers should parse deblocking filter controls');

function h264Nal(type, rbsp = [], nalRefIdc = 0) {
  return [0x00, 0x00, 0x00, 0x01, ((nalRefIdc & 3) << 5) | (type & 0x1F), ...rbsp];
}

const h264SeiPayload = [
  5, 18,
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
  0x41, 0x42,
  0x80
];
const h264ParamSetPrefix = parseResult.nals
  .filter(nal => nal.nal_unit_type === 7 || nal.nal_unit_type === 8)
  .slice(0, 2)
  .flatMap(nal => nal.bytes);
const h264NonVclBuffer = Uint8Array.from([
  ...h264ParamSetPrefix,
  ...h264Nal(6, h264SeiPayload),
  ...h264Nal(9, [0x50]),             // primary_pic_type = 2, rbsp_trailing_bits()
  ...h264Nal(12, [0xFF, 0x80]),      // one ff_byte, rbsp_trailing_bits()
  ...h264Nal(10),                    // end_of_seq_rbsp()
  ...h264Nal(11)                     // end_of_stream_rbsp()
]).buffer;
parseResult = null;
messages.length = 0;
self.onmessage({ data: { type: 'parse', buffer: h264NonVclBuffer } });

assert.strictEqual(parseResult.summary.codec, 'H264', 'synthetic H.264 non-VCL stream should be detected as H.264');
assert.strictEqual(parseResult.errors.length, 0, 'synthetic H.264 non-VCL NALs should parse without errors');
assert.strictEqual(parseResult.summary.seiCount, 1, 'H.264 SEI count should not treat rbsp_trailing_bits as an empty SEI message');
const h264Sei = parseResult.nals.find(nal => nal.nal_unit_type === 6);
assert.strictEqual(h264Sei.parseResult.messages.length, 1, 'H.264 SEI parser should stop before rbsp_trailing_bits');
assert.strictEqual(h264Sei.parseResult.messages[0].name, 'user_data_unregistered', 'H.264 SEI payloadType 5 should use the protocol syntax name');
assert.strictEqual(h264Sei.parseResult.messages[0].uuid_iso_iec_11578.length, 16, 'H.264 user_data_unregistered should parse the 16-byte UUID');
assert.strictEqual(h264Sei.parseResult.messages[0].user_data_payload_byte.filter(value => value != null).length, 2, 'H.264 user_data_unregistered should expose every user_data_payload_byte');
assert(findField(h264Sei, 'parseResult.messages[0].uuid_iso_iec_11578'), 'H.264 SEI UUID should be mapped for binary highlighting');
assert(findField(h264Sei, 'parseResult.messages[0].user_data_payload_byte[16]'), 'H.264 SEI user_data_payload_byte should be mapped for binary highlighting');
assert(findField(h264Sei, 'parseResult.rbsp_trailing_bits.rbsp_stop_one_bit'), 'H.264 SEI rbsp_trailing_bits should be mapped separately from SEI messages');

const h264Aud = parseResult.nals.find(nal => nal.nal_unit_type === 9);
assert.strictEqual(h264Aud.parseResult.primary_pic_type, 2, 'H.264 AUD should parse primary_pic_type u(3)');
assert(findField(h264Aud, 'parseResult.primary_pic_type'), 'H.264 AUD primary_pic_type should be bit-mapped');
assert(findField(h264Aud, 'parseResult.rbsp_trailing_bits.rbsp_stop_one_bit'), 'H.264 AUD should map rbsp_trailing_bits separately');
const h264Filler = parseResult.nals.find(nal => nal.nal_unit_type === 12);
assert.strictEqual(h264Filler.parseResult.ff_byte.length, 1, 'H.264 filler data should parse every ff_byte');
assert(findField(h264Filler, 'parseResult.ff_byte[0]'), 'H.264 filler ff_byte should be bit-mapped');
assert(findField(h264Filler, 'parseResult.rbsp_trailing_bits.rbsp_stop_one_bit'), 'H.264 filler should map rbsp_trailing_bits separately');
assert.strictEqual(parseResult.nals.find(nal => nal.nal_unit_type === 10).parseResult.syntax, 'end_of_seq_rbsp', 'H.264 end of sequence should expose syntax node');
assert.strictEqual(parseResult.nals.find(nal => nal.nal_unit_type === 11).parseResult.syntax, 'end_of_stream_rbsp', 'H.264 end of stream should expose syntax node');

const h265File = fs.readFileSync('samples/outp.h265');
const h265Buffer = h265File.buffer.slice(h265File.byteOffset, h265File.byteOffset + h265File.byteLength);
parseResult = null;
messages.length = 0;
self.onmessage({ data: { type: 'parse', buffer: h265Buffer } });

assert(parseResult, 'worker should parse the H.265 fixture');
assert.strictEqual(parseResult.summary.codec, 'H265', 'fixture should be detected as H.265');
assert.strictEqual(parseResult.summary.totalNALs, 929, 'H.265 fixture should keep the expected NAL count');
assert.strictEqual(parseResult.summary.totalPictures, 913, 'H.265 fixture should expose all parsed VCL pictures');
assert.strictEqual(parseResult.summary.skippedPictures, 5, 'H.265 RASL pictures should be tracked as skipped output pictures');
assert.strictEqual(parseResult.summary.totalFrames, 908, 'H.265 Total Frames should count output pictures and exclude RASL leading pictures');
assert.strictEqual(parseResult.summary.seiCount, 4, 'H.265 SEI count should not treat rbsp_trailing_bits as an empty SEI message');
assert.strictEqual(parseResult.errors.length, 0, 'H.265 fixture should parse without errors');
const h265IdrFrame = parseResult.frames.find(frame => frame.is_idr);
assert(h265IdrFrame, 'H.265 fixture should expose an IDR output frame');
assert.strictEqual(h265IdrFrame.slice_type, 'IDR', 'H.265 IDR frames should display as IDR instead of plain I');
const h265PNal = parseResult.nals.find(nal => nal.parseResult && nal.parseResult.slice_type_name === 'P');
assert(h265PNal, 'H.265 fixture should include a P slice');
assert(findField(h265PNal, 'parseResult.short_term_ref_pic_set_sps_flag'), 'H.265 P slices must map short_term_ref_pic_set_sps_flag even when SPS has zero short-term RPS entries');
assert(
  findField(h265PNal, 'parseResult.short_term_ref_pic_set_sps_flag').startBit <
    findField(h265PNal, 'parseResult.slice_temporal_mvp_enabled_flag').startBit,
  'H.265 P slice fields should follow the protocol order around short_term_ref_pic_set_sps_flag'
);

const syntheticPFieldMap = [];
const syntheticPSliceBits =
  '1' +       // first_slice_segment_in_pic_flag
  ueBits(0) + // slice_pic_parameter_set_id
  ueBits(1) + // slice_type = P
  '0000' +    // slice_pic_order_cnt_lsb
  '0' +       // short_term_ref_pic_set_sps_flag
  ueBits(0) + // short_term_ref_pic_set.num_negative_pics
  ueBits(0) + // short_term_ref_pic_set.num_positive_pics
  '0' +       // num_ref_idx_active_override_flag
  ueBits(4) + // five_minus_max_num_merge_cand
  seBits(0) + // slice_qp_delta
  '1';        // byte_alignment().alignment_bit_equal_to_one
const syntheticPSlice = parseH265SliceHeader(
  bitsToBytes(syntheticPSliceBits),
  1,
  {
    0: {
      log2_max_pic_order_cnt_lsb_minus4: 0,
      separate_colour_plane_flag: 0,
      num_short_term_ref_pic_sets: 0,
      short_term_ref_pic_sets: [],
      long_term_ref_pics_present_flag: 0,
      sps_temporal_mvp_enabled_flag: 0,
      sample_adaptive_offset_enabled_flag: 0,
      chroma_format_idc: 1,
      log2_min_luma_coding_block_size_minus3: 0,
      log2_diff_max_min_luma_coding_block_size: 0,
      pic_width_in_luma_samples: 64,
      pic_height_in_luma_samples: 64
    }
  },
  {
    0: {
      pps_seq_parameter_set_id: 0,
      dependent_slice_segments_enabled_flag: 0,
      num_extra_slice_header_bits: 0,
      output_flag_present_flag: 0,
      num_ref_idx_l0_default_active_minus1: 0,
      num_ref_idx_l1_default_active_minus1: 0,
      lists_modification_present_flag: 0,
      cabac_init_present_flag: 0,
      weighted_pred_flag: 0,
      weighted_bipred_flag: 0,
      pps_slice_chroma_qp_offsets_present_flag: 0,
      chroma_qp_offset_list_enabled_flag: 0,
      deblocking_filter_override_enabled_flag: 0,
      pps_deblocking_filter_disabled_flag: 1,
      pps_loop_filter_across_slices_enabled_flag: 1,
      tiles_enabled_flag: 0,
      entropy_coding_sync_enabled_flag: 0,
      slice_segment_header_extension_present_flag: 0
    }
  },
  syntheticPFieldMap
);
assert.strictEqual(
  syntheticPSlice.slice_loop_filter_across_slices_enabled_flag,
  undefined,
  'H.265 P slice should not read slice_loop_filter_across_slices_enabled_flag when deblocking is inferred disabled and SAO is absent'
);
assert(!syntheticPFieldMap.find(field => field.path === 'parseResult.slice_loop_filter_across_slices_enabled_flag'), 'inferred-disabled deblocking should not create a clickable slice_loop_filter_across_slices_enabled_flag field');
assert.strictEqual(
  syntheticPSlice.byte_alignment.alignment_bit_equal_to_one,
  1,
  'H.265 P slice should leave byte_alignment at the protocol stop bit instead of consuming it as a loop-filter flag'
);
const h265BNal = parseResult.nals.find(nal => nal.parseResult && nal.parseResult.slice_type_name === 'B');
assert(h265BNal, 'H.265 fixture should include a B slice');
assert(findField(h265BNal, 'parseResult.short_term_ref_pic_set_sps_flag'), 'H.265 B slices must map short_term_ref_pic_set_sps_flag through the shared P/B branch');
assert(findField(h265BNal, 'parseResult.mvd_l1_zero_flag'), 'H.265 B slices should map mvd_l1_zero_flag');
assert(findField(h265BNal, 'parseResult.collocated_from_l0_flag'), 'H.265 B slices should map collocated_from_l0_flag when temporal MVP is enabled');
assert(
  findField(h265BNal, 'parseResult.short_term_ref_pic_set_sps_flag').startBit <
    findField(h265BNal, 'parseResult.mvd_l1_zero_flag').startBit,
  'H.265 B slice fields should follow the protocol order before B-only prediction fields'
);

const h265Sei = parseResult.nals.find(nal => nal.nal_unit_type === 39);
assert(h265Sei, 'H.265 fixture should include a prefix SEI NAL');
assert.strictEqual(h265Sei.parseResult.messages.length, 1, 'H.265 SEI parser should stop before rbsp_trailing_bits');
assert.strictEqual(h265Sei.parseResult.messages[0].name, 'user_data_unregistered', 'H.265 SEI payloadType 5 should use the protocol syntax name');
assert.strictEqual(h265Sei.parseResult.messages[0].uuid_iso_iec_11578.length, 16, 'H.265 user_data_unregistered should parse the 16-byte UUID');
assert.strictEqual(
  h265Sei.parseResult.messages[0].user_data_payload_byte.filter(value => value != null).length,
  h265Sei.parseResult.messages[0].payloadSize - 16,
  'H.265 user_data_unregistered should parse every user_data_payload_byte without a preview cap'
);
assert(findField(h265Sei, 'parseResult.messages[0].uuid_iso_iec_11578'), 'H.265 SEI UUID should be mapped for binary highlighting');
assert(findField(h265Sei, 'parseResult.messages[0].user_data_payload_byte[16]'), 'H.265 SEI user_data_payload_byte should be mapped for binary highlighting');
assert(findField(h265Sei, 'parseResult.rbsp_trailing_bits.rbsp_stop_one_bit'), 'H.265 SEI rbsp_trailing_bits should be mapped separately from SEI messages');

const h265Vps = parseResult.nals.find(nal => nal.nal_unit_type === 32);
assert(h265Vps, 'H.265 fixture should include a VPS');
assert(findField(h265Vps, 'parseResult.vps_sub_layer_ordering_info_present_flag'), 'H.265 VPS should map sub-layer ordering info');
assert(findField(h265Vps, 'parseResult.vps_max_layer_id'), 'H.265 VPS should map max layer id');
assert(findField(h265Vps, 'parseResult.vps_timing_info_present_flag'), 'H.265 VPS should map timing info presence');
assert.strictEqual(
  findField(h265Vps, 'parseResult.profile_tier_level.general_profile_compatibility_flag[23]').endBit -
    findField(h265Vps, 'parseResult.profile_tier_level.general_profile_compatibility_flag[23]').startBit,
  1,
  'single-bit H.265 fields should not highlight emulation-prevention bytes'
);
assert(!findField(h265Vps, 'parseResult.profile_tier_level.general_profile_compatibility_flags[23]'), 'H.265 PTL field names should match the singular protocol syntax element');
assert(findField(h265Vps, 'parseResult.profile_tier_level.general_reserved_zero_7bits'), 'H.265 PTL should split profile-2 constraint reserved_zero_7bits');
assert(
  findField(h265Vps, 'parseResult.profile_tier_level.general_reserved_zero_35bits').segments.length > 1,
  'H.265 field ranges crossing emulation-prevention bytes should be represented as multiple display segments'
);
assert(findField(h265Vps, 'parseResult.profile_tier_level.general_one_picture_only_constraint_flag'), 'H.265 PTL should map profile-2 one-picture constraint separately');
assert(findField(h265Vps, 'parseResult.profile_tier_level.general_inbld_flag'), 'H.265 PTL should map general_inbld_flag separately from reserved bits');

const h265Sps = parseResult.nals.find(nal => nal.nal_unit_type === 33);
assert(h265Sps, 'H.265 fixture should include an SPS');
assert(findField(h265Sps, 'parseResult.vui.video_signal_type_present_flag'), 'H.265 SPS VUI should map video_signal_type_present_flag');
assert(findField(h265Sps, 'parseResult.vui.chroma_loc_info_present_flag'), 'H.265 SPS VUI should map chroma_loc_info_present_flag');
assert(findField(h265Sps, 'parseResult.vui.vui_timing_info_present_flag'), 'H.265 SPS VUI should map timing info with H.265 field names');
assert(findField(h265Sps, 'parseResult.vui.vui_hrd_parameters_present_flag'), 'H.265 VUI timing info should map vui_hrd_parameters_present_flag before bitstream_restriction_flag');

const raslNals = parseResult.nals.filter(nal => nal.nal_unit_type === 8 || nal.nal_unit_type === 9);
assert.strictEqual(raslNals.length, 5, 'fixture should contain five RASL leading pictures');
assert(raslNals.every(nal => findField(nal, 'parseResult.slice_pic_order_cnt_lsb')), 'RASL slice headers should still be parsed and bit-mapped in the NAL list');
assert(!parseResult.frames.some(frame => frame.nal_unit_type === 8 || frame.nal_unit_type === 9), 'output frame list should exclude RASL pictures');

function h265Nal(type, rbsp = []) {
  return [0x00, 0x00, 0x00, 0x01, (type << 1) & 0x7E, 0x01, ...rbsp];
}

const h265NonVclBuffer = Uint8Array.from([
  ...h265Nal(35, [0x50]),             // pic_type = 2, rbsp_trailing_bits()
  ...h265Nal(38, [0xFF, 0xFF, 0x80]), // two ff_byte values, rbsp_trailing_bits()
  ...h265Nal(36),                     // end_of_seq_rbsp()
  ...h265Nal(37),                     // end_of_bitstream_rbsp()
  ...h265Nal(41, [0x12, 0x34]),       // reserved non-VCL payload bytes
  ...h265Nal(48, [0x56])              // unspecified non-VCL payload bytes
]).buffer;
parseResult = null;
messages.length = 0;
self.onmessage({ data: { type: 'parse', buffer: h265NonVclBuffer } });

assert.strictEqual(parseResult.summary.codec, 'H265', 'synthetic non-VCL stream should be detected as H.265');
assert.strictEqual(parseResult.errors.length, 0, 'synthetic H.265 non-VCL NALs should parse without errors');
const audNal = parseResult.nals.find(nal => nal.nal_unit_type === 35);
assert.strictEqual(audNal.parseResult.pic_type, 2, 'AUD_NUT should parse pic_type u(3)');
assert.strictEqual(findField(audNal, 'parseResult.pic_type').coding, 'u(3)', 'AUD pic_type should expose u(3) coding');
assert(findField(audNal, 'parseResult.rbsp_trailing_bits.rbsp_stop_one_bit'), 'AUD should map rbsp_trailing_bits separately');
const fdNal = parseResult.nals.find(nal => nal.nal_unit_type === 38);
assert.deepStrictEqual(fdNal.parseResult.ff_byte, [0xFF, 0xFF], 'FD_NUT should parse every ff_byte before trailing bits');
assert.strictEqual(findField(fdNal, 'parseResult.ff_byte[0]').coding, 'f(8)', 'FD ff_byte should expose f(8) coding');
assert(findField(fdNal, 'parseResult.rbsp_trailing_bits.rbsp_stop_one_bit'), 'FD should map rbsp_trailing_bits separately');
const eosNal = parseResult.nals.find(nal => nal.nal_unit_type === 36);
const eobNal = parseResult.nals.find(nal => nal.nal_unit_type === 37);
assert.strictEqual(eosNal.parseResult.syntax, 'end_of_seq_rbsp', 'EOS_NUT should expose end_of_seq_rbsp syntax');
assert.strictEqual(eobNal.parseResult.syntax, 'end_of_bitstream_rbsp', 'EOB_NUT should expose end_of_bitstream_rbsp syntax');
const rsvNvclNal = parseResult.nals.find(nal => nal.nal_unit_type === 41);
const unspecNal = parseResult.nals.find(nal => nal.nal_unit_type === 48);
assert.strictEqual(rsvNvclNal.type_name, 'RSV_NVCL41', 'reserved H.265 non-VCL type names should follow Table 7-1');
assert.strictEqual(unspecNal.type_name, 'UNSPEC48', 'unspecified H.265 non-VCL type names should follow Table 7-1');
assert.deepStrictEqual(rsvNvclNal.parseResult.rbsp_byte, [0x12, 0x34], 'reserved non-VCL NAL units should expose raw rbsp_byte values');
assert.deepStrictEqual(unspecNal.parseResult.rbsp_byte, [0x56], 'unspecified non-VCL NAL units should expose raw rbsp_byte values');

console.log('parser-worker field map assertions passed');
