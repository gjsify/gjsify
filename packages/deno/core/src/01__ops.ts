// Based on https://github.com/denoland/deno/blob/main/core/ops.rs
// Based on https://github.com/denoland/deno/blob/main/core/ops_builtin.rs
// Based on https://github.com/denoland/deno/blob/main/core/ops_builtin_v8.rs
// Based on https://github.com/denoland/deno/blob/main/core/ops_metrics.rs

import { stringify } from 'querystring';
import type { UncaughtExceptionCallback, UrlComponent, UrlComponents, URLPatternInput, PermissionState, PermissionDescriptor } from './types/index.js';

export const op_close = (...args: any[]) => {
    console.warn("Not implemented: ops.op_close");
}
export const op_try_close = (...args: any[]) => {
    console.warn("Not implemented: ops.op_try_close");
}
export const op_print = (...args: any[]) => {
    console.warn("Not implemented: ops.op_print");
}
export const op_resources = () => {
    console.warn("Not implemented: ops.op_resources");
}
export const op_wasm_streaming_feed = (...args: any[]) => {
    console.warn("Not implemented: ops.op_wasm_streaming_feed");
}
export const op_wasm_streaming_set_url = (...args: any[]) => {
    console.warn("Not implemented: ops.op_wasm_streaming_set_url");
}
export const op_void_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_void_sync");
}
export const op_void_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_void_async");
}
export const op_read = async (rid: number, buffer: Uint8Array): Promise<number> => {
    console.warn("Not implemented: ops.op_read");
    return -1;
}
export const op_read_all = async (rid: number) => {
    console.warn("Not implemented: ops.op_read_all");
}
export const op_write = async (rid: number, buffer: Uint8Array): Promise<number> => {
    console.warn("Not implemented: ops.op_write");
    return -1;
}
export const op_write_all = async (rid: number, buffer: Uint8Array): Promise<void> => {
    console.warn("Not implemented: ops.op_write_all");
}
export const op_shutdown = async (rid: number): Promise<void> => {
    console.warn("Not implemented: ops.op_shutdown");
}
export const op_metrics = (...args: any[]) => {
    console.warn("Not implemented: ops.op_metrics");
    return [];
}
export const op_url_parse = (href: string, buf: ArrayBufferLike): number => {
    console.warn("Not implemented: ops.op_url_parse");
    const status = -1;
    return status;
}

export const op_url_parse_with_base = (href: string, maybeBase: string, buf: ArrayBufferLike): number => {
    console.warn("Not implemented: ops.op_url_parse_with_base");
    const status = -1;
    return status;
}

export const op_url_reparse = (href: string, setter: number, value: any, buf: ArrayBufferLike): number => {
    console.warn("Not implemented: ops.op_url_reparse");
    const status = -1;
    return status;
}
export const op_url_parse_search_params = (a?: string | null, bytes?: Uint8Array): [string, string][] => {
    console.warn("Not implemented: ops.op_url_parse_search_params");
    return [];
}
export const op_url_stringify_search_params = (value: any): string => {
    console.warn("Not implemented: ops.op_url_stringify_search_params");
    return "";
}
export const op_urlpattern_parse = (input: URLPatternInput, baseURL: string): UrlComponents => {
    console.warn("Not implemented: ops.op_urlpattern_parse");
    const emptyRes: UrlComponent = {
        patternString: "",
        regexp: new RegExp(""),
        groupNameList: []
    }

    return {
        protocol: emptyRes,
        username: emptyRes,
        password: emptyRes,
        hostname: emptyRes,
        port: emptyRes,
        pathname: emptyRes,
        search: emptyRes,
        hash: emptyRes,
    }
}

export const op_urlpattern_process_match_input = (...args: any[]): [values: {[key: string]: any}, inputs: Array<any>] => {
    console.warn("Not implemented: ops.op_urlpattern_process_match_input");
    const values = {};
    const inputs = [];
    return [values, inputs];
}

export const op_base64_decode = (data: string): Uint8Array => {
    console.warn("Not implemented: ops.op_base64_decode");
    return new Uint8Array();
}
export const op_base64_encode = (data: Uint8Array): string => {
    console.warn("Not implemented: ops.op_base64_encode");
    return "";
}
export const op_base64_atob = (...args: any[]) => {
    console.warn("Not implemented: ops.op_base64_atob");
}
export const op_base64_btoa = (...args: any[]) => {
    console.warn("Not implemented: ops.op_base64_btoa");
}
export const op_encoding_normalize_label = (...args: any[]) => {
    console.warn("Not implemented: ops.op_encoding_normalize_label");
}
export const op_encoding_new_decoder = (...args: any[]) => {
    console.warn("Not implemented: ops.op_encoding_new_decoder");
}
export const op_encoding_decode = (...args: any[]) => {
    console.warn("Not implemented: ops.op_encoding_decode");
}
export const op_encoding_encode_into = (...args: any[]) => {
    console.warn("Not implemented: ops.op_encoding_encode_into");
}
export const op_blob_create_part = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_create_part");
}
export const op_blob_slice_part = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_slice_part");
}
export const op_blob_read_part = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_read_part");
}
export const op_blob_remove_part = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_remove_part");
}
export const op_blob_create_object_url = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_create_object_url");
}
export const op_blob_revoke_object_url = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_revoke_object_url");
}
export const op_blob_from_object_url = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_from_object_url");
}
export const op_message_port_create_entangled = (...args: any[]) => {
    console.warn("Not implemented: ops.op_message_port_create_entangled");
}
export const op_message_port_post_message = (...args: any[]) => {
    console.warn("Not implemented: ops.op_message_port_post_message");
}
export const op_message_port_recv_message = (...args: any[]) => {
    console.warn("Not implemented: ops.op_message_port_recv_message");
}
export const op_compression_new = (...args: any[]) => {
    console.warn("Not implemented: ops.op_compression_new");
}
export const op_compression_write = (...args: any[]) => {
    console.warn("Not implemented: ops.op_compression_write");
}
export const op_compression_finish = (...args: any[]) => {
    console.warn("Not implemented: ops.op_compression_finish");
}
export const op_now = (...args: any[]) => {
    console.warn("Not implemented: ops.op_now");
}
export const op_timer_handle = (...args: any[]) => {
    console.warn("Not implemented: ops.op_timer_handle");
}
export const op_cancel_handle = (...args: any[]) => {
    console.warn("Not implemented: ops.op_cancel_handle");
}
export const op_sleep = (...args: any[]) => {
    console.warn("Not implemented: ops.op_sleep");
}
export const op_sleep_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_sleep_sync");
}
export const op_fetch = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fetch");
}
export const op_fetch_send = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fetch_send");
}
export const op_fetch_custom_client = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fetch_custom_client");
}
export const op_ws_check_permission_and_cancel_handle = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ws_check_permission_and_cancel_handle");
}
export const op_ws_create = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ws_create");
}
export const op_ws_send = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ws_send");
}
export const op_ws_close = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ws_close");
}
export const op_ws_next_event = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ws_next_event");
}
export const op_webstorage_length = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webstorage_length");
}
export const op_webstorage_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webstorage_key");
}
export const op_webstorage_set = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webstorage_set");
}
export const op_webstorage_get = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webstorage_get");
}
export const op_webstorage_remove = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webstorage_remove");
}
export const op_webstorage_clear = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webstorage_clear");
}
export const op_webstorage_iterate_keys = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webstorage_iterate_keys");
}
export const op_broadcast_subscribe = (...args: any[]) => {
    console.warn("Not implemented: ops.op_broadcast_subscribe");
}
export const op_broadcast_unsubscribe = (...args: any[]) => {
    console.warn("Not implemented: ops.op_broadcast_unsubscribe");
}
export const op_broadcast_send = (...args: any[]) => {
    console.warn("Not implemented: ops.op_broadcast_send");
}
export const op_broadcast_recv = (...args: any[]) => {
    console.warn("Not implemented: ops.op_broadcast_recv");
}
export const op_crypto_get_random_values = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_get_random_values");
}
export const op_crypto_generate_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_generate_key");
}
export const op_crypto_sign_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_sign_key");
}
export const op_crypto_verify_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_verify_key");
}
export const op_crypto_derive_bits = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_derive_bits");
}
export const op_crypto_import_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_import_key");
}
export const op_crypto_export_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_export_key");
}
export const op_crypto_encrypt = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_encrypt");
}
export const op_crypto_decrypt = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_decrypt");
}
export const op_crypto_subtle_digest = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_subtle_digest");
}
export const op_crypto_random_uuid = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_random_uuid");
}
export const op_crypto_wrap_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_wrap_key");
}
export const op_crypto_unwrap_key = (...args: any[]) => {
    console.warn("Not implemented: ops.op_crypto_unwrap_key");
}
export const op_webgpu_request_adapter = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_request_adapter");
}
export const op_webgpu_request_device = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_request_device");
}
export const op_webgpu_create_query_set = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_query_set");
}
export const op_webgpu_create_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_buffer");
}
export const op_webgpu_buffer_get_mapped_range = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_buffer_get_mapped_range");
}
export const op_webgpu_buffer_unmap = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_buffer_unmap");
}
export const op_webgpu_buffer_get_map_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_buffer_get_map_async");
}
export const op_webgpu_create_texture = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_texture");
}
export const op_webgpu_create_texture_view = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_texture_view");
}
export const op_webgpu_create_sampler = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_sampler");
}
export const op_webgpu_create_bind_group_layout = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_bind_group_layout");
}
export const op_webgpu_create_pipeline_layout = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_pipeline_layout");
}
export const op_webgpu_create_bind_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_bind_group");
}
export const op_webgpu_create_compute_pipeline = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_compute_pipeline");
}
export const op_webgpu_compute_pipeline_get_bind_group_layout = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pipeline_get_bind_group_layout");
}
export const op_webgpu_create_render_pipeline = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_render_pipeline");
}
export const op_webgpu_render_pipeline_get_bind_group_layout = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pipeline_get_bind_group_layout");
}
export const op_webgpu_create_command_encoder = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_command_encoder");
}
export const op_webgpu_command_encoder_begin_render_pass = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_begin_render_pass");
}
export const op_webgpu_command_encoder_begin_compute_pass = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_begin_compute_pass");
}
export const op_webgpu_command_encoder_copy_buffer_to_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_copy_buffer_to_buffer");
}
export const op_webgpu_command_encoder_copy_buffer_to_texture = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_copy_buffer_to_texture");
}
export const op_webgpu_command_encoder_copy_texture_to_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_copy_texture_to_buffer");
}
export const op_webgpu_command_encoder_copy_texture_to_texture = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_copy_texture_to_texture");
}
export const op_webgpu_command_encoder_clear_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_clear_buffer");
}
export const op_webgpu_command_encoder_push_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_push_debug_group");
}
export const op_webgpu_command_encoder_pop_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_pop_debug_group");
}
export const op_webgpu_command_encoder_insert_debug_marker = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_insert_debug_marker");
}
export const op_webgpu_command_encoder_write_timestamp = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_write_timestamp");
}
export const op_webgpu_command_encoder_resolve_query_set = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_resolve_query_set");
}
export const op_webgpu_command_encoder_finish = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_finish");
}
export const op_webgpu_render_pass_set_viewport = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_set_viewport");
}
export const op_webgpu_render_pass_set_scissor_rect = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_set_scissor_rect");
}
export const op_webgpu_render_pass_set_blend_constant = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_set_blend_constant");
}
export const op_webgpu_render_pass_set_stencil_reference = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_set_stencil_reference");
}
export const op_webgpu_render_pass_begin_pipeline_statistics_query = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_begin_pipeline_statistics_query");
}
export const op_webgpu_render_pass_end_pipeline_statistics_query = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_end_pipeline_statistics_query");
}
export const op_webgpu_render_pass_write_timestamp = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_write_timestamp");
}
export const op_webgpu_render_pass_execute_bundles = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_execute_bundles");
}
export const op_webgpu_render_pass_end_pass = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_end_pass");
}
export const op_webgpu_render_pass_set_bind_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_set_bind_group");
}
export const op_webgpu_render_pass_push_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_push_debug_group");
}
export const op_webgpu_render_pass_pop_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_pop_debug_group");
}
export const op_webgpu_render_pass_insert_debug_marker = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_insert_debug_marker");
}
export const op_webgpu_render_pass_set_pipeline = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_set_pipeline");
}
export const op_webgpu_render_pass_set_index_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_set_index_buffer");
}
export const op_webgpu_render_pass_set_vertex_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_set_vertex_buffer");
}
export const op_webgpu_render_pass_draw = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_draw");
}
export const op_webgpu_render_pass_draw_indexed = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_draw_indexed");
}
export const op_webgpu_render_pass_draw_indirect = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_draw_indirect");
}
export const op_webgpu_render_pass_draw_indexed_indirect = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_draw_indexed_indirect");
}
export const op_webgpu_compute_pass_set_pipeline = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_set_pipeline");
}
export const op_webgpu_compute_pass_dispatch = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_dispatch");
}
export const op_webgpu_compute_pass_dispatch_indirect = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_dispatch_indirect");
}
export const op_webgpu_compute_pass_begin_pipeline_statistics_query = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_begin_pipeline_statistics_query");
}
export const op_webgpu_compute_pass_end_pipeline_statistics_query = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_end_pipeline_statistics_query");
}
export const op_webgpu_compute_pass_write_timestamp = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_write_timestamp");
}
export const op_webgpu_compute_pass_end_pass = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_end_pass");
}
export const op_webgpu_compute_pass_set_bind_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_set_bind_group");
}
export const op_webgpu_compute_pass_push_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_push_debug_group");
}
export const op_webgpu_compute_pass_pop_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_pop_debug_group");
}
export const op_webgpu_compute_pass_insert_debug_marker = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_insert_debug_marker");
}
export const op_webgpu_create_render_bundle_encoder = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_render_bundle_encoder");
}
export const op_webgpu_render_bundle_encoder_finish = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_finish");
}
export const op_webgpu_render_bundle_encoder_set_bind_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_set_bind_group");
}
export const op_webgpu_render_bundle_encoder_push_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_push_debug_group");
}
export const op_webgpu_render_bundle_encoder_pop_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_pop_debug_group");
}
export const op_webgpu_render_bundle_encoder_insert_debug_marker = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_insert_debug_marker");
}
export const op_webgpu_render_bundle_encoder_set_pipeline = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_set_pipeline");
}
export const op_webgpu_render_bundle_encoder_set_index_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_set_index_buffer");
}
export const op_webgpu_render_bundle_encoder_set_vertex_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_set_vertex_buffer");
}
export const op_webgpu_render_bundle_encoder_draw = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_draw");
}
export const op_webgpu_render_bundle_encoder_draw_indexed = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_draw_indexed");
}
export const op_webgpu_render_bundle_encoder_draw_indirect = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_draw_indirect");
}
export const op_webgpu_queue_submit = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_queue_submit");
}
export const op_webgpu_write_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_write_buffer");
}
export const op_webgpu_write_texture = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_write_texture");
}
export const op_webgpu_create_shader_module = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_shader_module");
}
export const op_ffi_load = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_load");
}
export const op_ffi_get_static = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_get_static");
}
export const op_ffi_call = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_call");
}
export const op_ffi_call_nonblocking = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_call_nonblocking");
}
export const op_ffi_call_ptr = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_call_ptr");
}
export const op_ffi_call_ptr_nonblocking = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_call_ptr_nonblocking");
}
export const op_ffi_ptr_of = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_ptr_of");
}
export const op_ffi_buf_copy_into = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_buf_copy_into");
}
export const op_ffi_cstr_read = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_cstr_read");
}
export const op_ffi_read_u8 = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_read_u8");
}
export const op_ffi_read_i8 = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_read_i8");
}
export const op_ffi_read_u16 = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_read_u16");
}
export const op_ffi_read_i16 = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_read_i16");
}
export const op_ffi_read_u32 = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_read_u32");
}
export const op_ffi_read_i32 = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_read_i32");
}
export const op_ffi_read_u64 = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_read_u64");
}
export const op_ffi_read_f32 = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_read_f32");
}
export const op_ffi_read_f64 = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ffi_read_f64");
}
export const op_main_module = (...args: any[]) => {
    console.warn("Not implemented: ops.op_main_module");
}
export const op_create_worker = (...args: any[]) => {
    console.warn("Not implemented: ops.op_create_worker");
}
export const op_host_terminate_worker = (...args: any[]) => {
    console.warn("Not implemented: ops.op_host_terminate_worker");
}
export const op_host_post_message = (...args: any[]) => {
    console.warn("Not implemented: ops.op_host_post_message");
}
export const op_host_recv_ctrl = (...args: any[]) => {
    console.warn("Not implemented: ops.op_host_recv_ctrl");
}
export const op_host_recv_message = (...args: any[]) => {
    console.warn("Not implemented: ops.op_host_recv_message");
}
export const op_spawn_child = (...args: any[]) => {
    console.warn("Not implemented: ops.op_spawn_child");
}
export const op_spawn_wait = (...args: any[]) => {
    console.warn("Not implemented: ops.op_spawn_wait");
}
export const op_spawn_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_spawn_sync");
}
export const op_fs_events_open = (...args: any[]): number => {
    console.warn("Not implemented: ops.op_fs_events_open");
    return -1;
}
export const op_fs_events_poll = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fs_events_poll");
}
export const op_open_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_open_sync");
}
export const op_open_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_open_async");
}
export const op_write_file_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_write_file_sync");
}
export const op_write_file_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_write_file_async");
}
export const op_seek_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_seek_sync");
}
export const op_seek_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_seek_async");
}
export const op_fdatasync_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fdatasync_sync");
}
export const op_fdatasync_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fdatasync_async");
}
export const op_fsync_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fsync_sync");
}
export const op_fsync_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fsync_async");
}
export const op_fstat_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fstat_sync");
}
export const op_fstat_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fstat_async");
}
export const op_flock_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_flock_sync");
}
export const op_flock_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_flock_async");
}
export const op_funlock_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_funlock_sync");
}
export const op_funlock_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_funlock_async");
}
export const op_umask = (...args: any[]) => {
    console.warn("Not implemented: ops.op_umask");
}
export const op_chdir = (...args: any[]) => {
    console.warn("Not implemented: ops.op_chdir");
}
export const op_mkdir_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_mkdir_sync");
}
export const op_mkdir_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_mkdir_async");
}
export const op_chmod_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_chmod_sync");
}
export const op_chmod_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_chmod_async");
}
export const op_chown_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_chown_sync");
}
export const op_chown_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_chown_async");
}
export const op_remove_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_remove_sync");
}
export const op_remove_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_remove_async");
}
export const op_copy_file_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_copy_file_sync");
}
export const op_copy_file_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_copy_file_async");
}
export const op_stat_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_stat_sync");
}
export const op_stat_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_stat_async");
}
export const op_realpath_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_realpath_sync");
}
export const op_realpath_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_realpath_async");
}
export const op_read_dir_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_read_dir_sync");
}
export const op_read_dir_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_read_dir_async");
}
export const op_rename_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_rename_sync");
}
export const op_rename_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_rename_async");
}
export const op_link_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_link_sync");
}
export const op_link_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_link_async");
}
export const op_symlink_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_symlink_sync");
}
export const op_symlink_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_symlink_async");
}
export const op_read_link_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_read_link_sync");
}
export const op_read_link_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_read_link_async");
}
export const op_ftruncate_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ftruncate_sync");
}
export const op_ftruncate_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ftruncate_async");
}
export const op_truncate_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_truncate_sync");
}
export const op_truncate_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_truncate_async");
}
export const op_make_temp_dir_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_make_temp_dir_sync");
}
export const op_make_temp_dir_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_make_temp_dir_async");
}
export const op_make_temp_file_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_make_temp_file_sync");
}
export const op_make_temp_file_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_make_temp_file_async");
}
export const op_cwd = (...args: any[]) => {
    console.warn("Not implemented: ops.op_cwd");
}
export const op_futime_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_futime_sync");
}
export const op_futime_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_futime_async");
}
export const op_utime_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_utime_sync");
}
export const op_utime_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_utime_async");
}
export const op_readfile_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_readfile_sync");
}
export const op_readfile_text_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_readfile_text_sync");
}
export const op_readfile_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_readfile_async");
}
export const op_readfile_text_async = (...args: any[]) => {
    console.warn("Not implemented: ops.op_readfile_text_async");
}
export const op_read_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_read_sync");
}
export const op_write_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_write_sync");
}
export const op_net_accept = (...args: any[]) => {
    console.warn("Not implemented: ops.op_net_accept");
}
export const op_net_connect = (...args: any[]) => {
    console.warn("Not implemented: ops.op_net_connect");
}
export const op_net_listen = (...args: any[]) => {
    console.warn("Not implemented: ops.op_net_listen");
}
export const op_dgram_recv = (...args: any[]) => {
    console.warn("Not implemented: ops.op_dgram_recv");
}
export const op_dgram_send = (...args: any[]) => {
    console.warn("Not implemented: ops.op_dgram_send");
}
export const op_dns_resolve = (...args: any[]) => {
    console.warn("Not implemented: ops.op_dns_resolve");
}
export const op_set_nodelay = (...args: any[]) => {
    console.warn("Not implemented: ops.op_set_nodelay");
}
export const op_set_keepalive = (...args: any[]) => {
    console.warn("Not implemented: ops.op_set_keepalive");
}
export const op_tls_start = (...args: any[]) => {
    console.warn("Not implemented: ops.op_tls_start");
}
export const op_tls_connect = (...args: any[]) => {
    console.warn("Not implemented: ops.op_tls_connect");
}
export const op_tls_listen = (...args: any[]) => {
    console.warn("Not implemented: ops.op_tls_listen");
}
export const op_tls_accept = (...args: any[]) => {
    console.warn("Not implemented: ops.op_tls_accept");
}
export const op_tls_handshake = (...args: any[]) => {
    console.warn("Not implemented: ops.op_tls_handshake");
}
export const op_env = (...args: any[]) => {
    console.warn("Not implemented: ops.op_env");
}
export const op_exec_path = (...args: any[]) => {
    console.warn("Not implemented: ops.op_exec_path");
}
export const op_exit = (...args: any[]) => {
    console.warn("Not implemented: ops.op_exit");
}
export const op_delete_env = (...args: any[]) => {
    console.warn("Not implemented: ops.op_delete_env");
}
export const op_get_env = (...args: any[]) => {
    console.warn("Not implemented: ops.op_get_env");
}
export const op_getuid = (...args: any[]) => {
    console.warn("Not implemented: ops.op_getuid");
}
export const op_hostname = (...args: any[]) => {
    console.warn("Not implemented: ops.op_hostname");
}
export const op_loadavg = (...args: any[]) => {
    console.warn("Not implemented: ops.op_loadavg");
}
export const op_network_interfaces = (...args: any[]) => {
    console.warn("Not implemented: ops.op_network_interfaces");
}
export const op_os_release = (...args: any[]) => {
    console.warn("Not implemented: ops.op_os_release");
}
export const op_set_env = (...args: any[]) => {
    console.warn("Not implemented: ops.op_set_env");
}
export const op_set_exit_code = (...args: any[]) => {
    console.warn("Not implemented: ops.op_set_exit_code");
}
export const op_system_memory_info = (...args: any[]) => {
    console.warn("Not implemented: ops.op_system_memory_info");
}
export const op_query_permission = (desc: PermissionDescriptor): PermissionState => {
    console.warn("Not implemented: ops.op_query_permission");
    return "denied";
}
export const op_revoke_permission = (desc: PermissionDescriptor): PermissionState => {
    console.warn("Not implemented: ops.op_revoke_permission");
    return "denied";
}
export const op_request_permission = (desc: PermissionDescriptor): PermissionState => {
    console.warn("Not implemented: ops.op_request_permission");
    return "denied";
}
export const op_run = (...args: any[]) => {
    console.warn("Not implemented: ops.op_run");
}
export const op_run_status = (...args: any[]) => {
    console.warn("Not implemented: ops.op_run_status");
}
export const op_kill = (...args: any[]) => {
    console.warn("Not implemented: ops.op_kill");
}
export const op_signal_bind = (...args: any[]) => {
    console.warn("Not implemented: ops.op_signal_bind");
}
export const op_signal_unbind = (...args: any[]) => {
    console.warn("Not implemented: ops.op_signal_unbind");
}
export const op_signal_poll = (...args: any[]) => {
    console.warn("Not implemented: ops.op_signal_poll");
}
export const op_set_raw = (...args: any[]) => {
    console.warn("Not implemented: ops.op_set_raw");
}
export const op_isatty = (...args: any[]) => {
    console.warn("Not implemented: ops.op_isatty");
}
export const op_console_size = (...args: any[]) => {
    console.warn("Not implemented: ops.op_console_size");
}
export const op_http_accept = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_accept");
}
export const op_http_read = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_read");
}
export const op_http_write_headers = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_write_headers");
}
export const op_http_write = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_write");
}
export const op_http_write_resource = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_write_resource");
}
export const op_http_shutdown = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_shutdown");
}
export const op_http_websocket_accept_header = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_websocket_accept_header");
}
export const op_http_upgrade_websocket = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_upgrade_websocket");
}
export const op_http_start = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_start");
}
export const op_http_upgrade = (...args: any[]) => {
    console.warn("Not implemented: ops.op_http_upgrade");
}
export const op_format_diagnostic = (...args: any[]) => {
    console.warn("Not implemented: ops.op_format_diagnostic");
}
export const op_format_file_name = (...args: any[]) => {
    console.warn("Not implemented: ops.op_format_file_name");
}
export const op_emit = (...args: any[]) => {
    console.warn("Not implemented: ops.op_emit");
}

export const op_ref_op = (promiseId: number) => {
    console.warn("Not implemented: ops.op_ref_op");
}

export const op_unref_op = (promiseId: number) => {
    console.warn("Not implemented: ops.op_unref_op");
}

export const op_op_names = () => {
    console.warn("Not implemented: ops.op_op_names");
    return [];
}

export const asyncOpsInfo = () => {
    console.warn("Not implemented: ops.asyncOpsInfo");
    return {}
}

export const op_queue_microtask = (cb: () => void) => {
    console.warn("Not implemented: ops.op_queue_microtask");
    cb();
}

export const op_set_promise_hooks = (
    init: (promise: Promise<unknown>, parentPromise: Promise<unknown>) => void,
    before: (promise: Promise<unknown>) => void,
    after: (promise: Promise<unknown>) => void,
    resolve: (promise: Promise<unknown>) => void) => {
    console.warn("Not implemented: ops.op_set_promise_hooks");
}

export const op_set_macrotask_callback = (fn: () => boolean): void => {
    console.warn("Not implemented: ops.op_set_macrotask_callback");
    fn();
}

export const op_set_next_tick_callback = (fn: () => void): void => {
    console.warn("Not implemented: ops.op_set_next_tick_callback");
    fn();
}

export const op_run_microtasks = () => {
    console.warn("Not implemented: ops.op_run_microtasks");
}

export const op_has_tick_scheduled = () => {
    console.warn("Not implemented: ops.op_has_tick_scheduled");
}

export const op_set_has_tick_scheduled = (bool: boolean) => {
    console.warn("Not implemented: ops.op_set_has_tick_scheduled");
}

export const op_eval_context = (source, specifier) => {
    console.warn("Not implemented: ops.op_eval_context");
}

export const op_create_host_object = () => {
    console.warn("Not implemented: ops.op_create_host_object");
}

export const op_encode = (text: string) => {
    console.warn("Not implemented: ops.op_encode");
}

export const op_decode = (buffer: Uint8Array) => {
    console.warn("Not implemented: ops.op_decode");
}

export const op_serialize = (value, options, errorCallback) => {
    console.warn("Not implemented: ops.op_serialize");
}

export const op_deserialize = (buffer, options) => {
    console.warn("Not implemented: ops.op_deserialize");
}

export const op_get_promise_details = (promise: Promise<any>): [state: number, result: any] => {
    console.warn("Not implemented: ops.op_get_promise_details");
    const state: number = -1;
    const result: any = undefined; // TODO
    return [state, result];
}

export const op_get_proxy_details = (proxy) => {
    console.warn("Not implemented: ops.op_get_proxy_details");
}

export const op_is_proxy = (value): boolean => {
    console.warn("Not implemented: ops.op_is_proxy");
    return false;
}

export const op_memory_usage = () => {
    console.warn("Not implemented: ops.op_memory_usage");
}

export const op_set_wasm_streaming_callback = (
    fn: (source: any, rid: number) => void,
  ): void  => {
    console.warn("Not implemented: ops.op_set_wasm_streaming_callback");
}

export const op_abort_wasm_streaming = (rid: number, error): void  => {
    console.warn("Not implemented: ops.op_abort_wasm_streaming");
}

export const op_destructure_error = (error): void  => {
    console.warn("Not implemented: ops.op_destructure_error");
}

export const op_event_loop_has_more_work = (): void  => {
    console.warn("Not implemented: ops.op_event_loop_has_more_work");
}

export const op_set_promise_reject_callback = (fn: UncaughtExceptionCallback): void  => {
    console.warn("Not implemented: ops.op_set_promise_reject_callback");
}

export const op_str_byte_length = (str: string): void  => {
    console.warn("Not implemented: ops.op_str_byte_length");
}

export const op_apply_source_map = (cse)  => {
    console.warn("Not implemented: ops.op_apply_source_map");
    return {};
}

export const op_url_get_serialization = () => {
    console.warn("Not implemented: ops.op_url_get_serialization");
    return {};
}