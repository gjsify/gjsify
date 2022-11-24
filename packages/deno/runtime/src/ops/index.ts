// Based on https://github.com/denoland/deno/blob/main/core/ops.rs
// Based on https://github.com/denoland/deno/blob/main/core/ops_builtin.rs
// Based on https://github.com/denoland/deno/blob/main/core/ops_builtin_v8.rs
// Based on https://github.com/denoland/deno/blob/main/core/ops_metrics.rs

export * from './webstorage.js';
export * from './crypto.js';

import type {
    PromiseRejectCallback,
    UrlComponent,
    UrlComponents,
    URLPatternInput,
    PermissionState,
    PermissionDescriptor,
    MakeTempOptions,
    SeekMode,
    OpenOptions,
    CreateHttpClientOptions,
    Signal,
    ChildStatus,
    PermissionOptions,
    TestStepDefinition,
    PointerValue,
    GPUSamplerDescriptor,
    GPUBindGroupLayoutEntry,
    GPUTextureDescriptor,
    GPUExtent3DDict,
    GPUVertexBufferLayout,
    GPUPrimitiveState,
    GPUMultisampleState,
    GPUDepthStencilState,
    GPURenderBundleEncoderDescriptor,
    GPUQuerySetDescriptor,
    TypedArray,
    messagePort,
} from '../types/index.js';

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
export const op_void_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_void_async");
}
export const op_read = async (rid: number, buffer: Uint8Array): Promise<number> => {
    console.warn("Not implemented: ops.op_read");
    return 0;
}
export const op_read_all = async (rid: number): Promise<Uint8Array> => {
    console.warn("Not implemented: ops.op_read_all");
    return new Uint8Array();
}
export const op_write = async (rid: number, buffer: Uint8Array): Promise<number> => {
    console.warn("Not implemented: ops.op_write");
    return 0;
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
export const op_base64_atob = (data: string): string => {
    console.warn("Not implemented: ops.op_base64_atob");
    return "";
}
export const op_base64_btoa = (data: string): string => {
    console.warn("Not implemented: ops.op_base64_btoa");
    return "";
}
export const op_encoding_normalize_label = (label: string): string => {
    console.warn("Not implemented: ops.op_encoding_normalize_label");
    return "";
}
export const op_encoding_new_decoder = (encoding: string, fatal: boolean, ignoreBOM: boolean): number => {
    console.warn("Not implemented: ops.op_encoding_new_decoder");
    return 0;
}
export const op_encoding_decode = (input: BufferSource, rid: number, stream: boolean): string => {
    console.warn("Not implemented: ops.op_encoding_decode");
    return "";
}
export const op_encoding_decode_single = (input: BufferSource, encoding: string, fatal: boolean, ignoreBOM: boolean): string => {
    console.warn("Not implemented: ops.op_encoding_decode_single");
    return "";
}
export const op_encoding_encode_into = (...args: any[]) => {
    console.warn("Not implemented: ops.op_encoding_encode_into");
}
export const op_blob_create_part = (data: Uint8Array): string => {
    console.warn("Not implemented: ops.op_blob_create_part");
    return "";
}
export const op_blob_slice_part = (id: string, data: { start: number, len: number}): string => {
    console.warn("Not implemented: ops.op_blob_slice_part");
    return "";
}
export const op_blob_read_part = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_read_part");
}
export const op_blob_remove_part = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_remove_part");
}
export const op_blob_create_object_url = (type: string, parts: string[]): string => {
    console.warn("Not implemented: ops.op_blob_create_object_url");
    return "";
}
export const op_blob_revoke_object_url = (...args: any[]) => {
    console.warn("Not implemented: ops.op_blob_revoke_object_url");
}
export const op_blob_from_object_url = (url: string): { parts: [], media_type: string } | null => {
    console.warn("Not implemented: ops.op_blob_from_object_url");
    return null;
}
export const op_message_port_create_entangled = (): [number, number] => {
    console.warn("Not implemented: ops.op_message_port_create_entangled");
    return [-1, -1];
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
export const op_fetch_custom_client = (options: CreateHttpClientOptions) => {
    console.warn("Not implemented: ops.op_fetch_custom_client");
    const rid = 0;
    return rid;
}
export const op_ws_check_permission_and_cancel_handle = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ws_check_permission_and_cancel_handle");
    const cancelRid = -1;
    return cancelRid;
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

export const op_webgpu_request_adapter = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_request_adapter");
}
export const op_webgpu_request_device = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_request_device");
}
export const op_webgpu_create_query_set = (data: GPUQuerySetDescriptor & { deviceRid: number }) => {
    console.warn("Not implemented: ops.op_webgpu_create_query_set");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_query_set"};
    return { rid: data.deviceRid, err };
}
export const op_webgpu_create_buffer = (
    rid: number,
    label: string,
    size: number,
    usage: number,
    mappedAtCreation?: boolean,
) => {
    console.warn("Not implemented: ops.op_webgpu_create_buffer");
    rid = -1;
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_buffer"};
    return { rid, err };
}
export const op_webgpu_buffer_get_mapped_range = (bufferRid: number, offset: number, size: number, data: Uint8Array) => {
    console.warn("Not implemented: ops.op_webgpu_buffer_get_mapped_range");
    return { rid: bufferRid }
}
export const op_webgpu_buffer_unmap = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_buffer_unmap");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_buffer_unmap"};
    return { err };
}
export const op_webgpu_buffer_get_map_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_buffer_get_map_async");
}
export const op_webgpu_create_texture = (options: GPUTextureDescriptor & { deviceRid: number; size: GPUExtent3DDict }) => {
    console.warn("Not implemented: ops.op_webgpu_create_texture");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_sampler"};
    return { rid: options.deviceRid, err };
}
export const op_webgpu_create_texture_view = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_create_texture_view");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_texture_view"};
    return { rid: -1, err };
}
export const op_webgpu_create_sampler = (desc: GPUSamplerDescriptor & {deviceRid: number}) => {
    console.warn("Not implemented: ops.op_webgpu_create_sampler");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_sampler"};
    return { rid: desc.deviceRid, err };
}
export const op_webgpu_create_bind_group_layout = (
    rid: number,
    label: string,
    entries: GPUBindGroupLayoutEntry[],
) => {
    console.warn("Not implemented: ops.op_webgpu_create_bind_group_layout");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_bind_group_layout"};
    return { rid, err };
}
export const op_webgpu_create_pipeline_layout = (
    rid: number,
    label: string,
    entries: number[],
) => {
    console.warn("Not implemented: ops.op_webgpu_create_pipeline_layout");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_pipeline_layout"};
    return { rid, err };
}
export const op_webgpu_create_bind_group = (
    rid: number,
    label: string,
    layout: number,
    entries?: unknown[], // TODO
) => {
    console.warn("Not implemented: ops.op_webgpu_create_bind_group");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_bind_group"};
    return { rid, err };
}
export const op_webgpu_create_compute_pipeline = (rid: number, label: string, layout: string | number, data: { module: number, entryPoint: string, constants: any }) => {
    console.warn("Not implemented: ops.op_webgpu_create_compute_pipeline");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_compute_pipeline"};
    return { rid, err };
}
export const op_webgpu_compute_pipeline_get_bind_group_layout = (computePipelineRid: number, index: number) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pipeline_get_bind_group_layout");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_compute_pipeline_get_bind_group_layout"};
    return { rid: computePipelineRid, err, label: "NotImplemented" };
}
export const op_webgpu_create_render_pipeline = (data: {
    deviceRid: number;
    label: string;
    layout: any;
    vertex: {
      module: number;
      entryPoint: string;
      buffers: GPUVertexBufferLayout[];
    },
    primitive: GPUPrimitiveState;
    depthStencil: GPUDepthStencilState;
    multisample: GPUMultisampleState;
    fragment: any;
}) => {
    console.warn("Not implemented: ops.op_webgpu_create_render_pipeline");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_render_pipeline"};
    return { rid: data.deviceRid, err, label: data.label };
}
export const op_webgpu_render_pipeline_get_bind_group_layout = (renderPipelineRid: number, index: number) => {
    console.warn("Not implemented: ops.op_webgpu_render_pipeline_get_bind_group_layout");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_render_pipeline"};
    return { rid: renderPipelineRid, err, label: "TODO"};
}
export const op_webgpu_create_command_encoder = (rid: number, label: string) => {
    console.warn("Not implemented: ops.op_webgpu_create_command_encoder");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_command_encoder"};
    return { rid, err };
}

export const op_webgpu_render_pass_end = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_render_pass_end");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_render_pass_end"};
    return { err };
}

export const op_webgpu_command_encoder_begin_render_pass = (commandEncoderRid: number, label: string, colorAttachments: unknown[], depthStencilAttachment: any) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_begin_render_pass");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_begin_render_pass"};
    return { rid: commandEncoderRid, err };
}
export const op_webgpu_command_encoder_begin_compute_pass = (commandEncoderRid: number, label: string) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_begin_compute_pass");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_begin_compute_pass"};
    return { rid: commandEncoderRid, err };
}
export const op_webgpu_command_encoder_copy_buffer_to_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_copy_buffer_to_buffer");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_copy_buffer_to_buffer"};
    return { err };
}
export const op_webgpu_command_encoder_copy_buffer_to_texture = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_copy_buffer_to_texture");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_copy_buffer_to_texture"};
    return { err };
}
export const op_webgpu_command_encoder_copy_texture_to_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_copy_texture_to_buffer");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_copy_texture_to_buffer"};
    return { err };
}
export const op_webgpu_command_encoder_copy_texture_to_texture = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_copy_texture_to_texture");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_copy_texture_to_texture"};
    return { err };
}
export const op_webgpu_command_encoder_clear_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_clear_buffer");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_clear_buffer"};
    return { err };
}
export const op_webgpu_command_encoder_push_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_push_debug_group");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_push_debug_group"};
    return { err };
}
export const op_webgpu_command_encoder_pop_debug_group = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_pop_debug_group");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_pop_debug_group"};
    return { err };
}
export const op_webgpu_command_encoder_insert_debug_marker = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_insert_debug_marker");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_insert_debug_marker"};
    return { err };
}
export const op_webgpu_command_encoder_write_timestamp = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_write_timestamp");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_write_timestamp"};
    return { err };
}
export const op_webgpu_command_encoder_resolve_query_set = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_resolve_query_set");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_resolve_query_set"};
    return { rid: -1, err };
}
export const op_webgpu_command_encoder_finish = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_command_encoder_finish");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_command_encoder_finish"};
    return { rid: -1, err };
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
export const op_webgpu_create_render_bundle_encoder = (desc: GPURenderBundleEncoderDescriptor & { deviceRid: number }) => {
    console.warn("Not implemented: ops.op_webgpu_create_render_bundle_encoder");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_render_bundle_encoder"};
    return { rid: desc.deviceRid, err };
}
export const op_webgpu_render_bundle_encoder_finish = (renderBundleEncoderRid: number, label: string) => {
    console.warn("Not implemented: ops.op_webgpu_render_bundle_encoder_finish");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_render_bundle_encoder_finish"};
    return { rid: renderBundleEncoderRid, err };
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
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_queue_submit"};
    return { err }
}
export const op_webgpu_write_buffer = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_write_buffer");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_write_buffer"};
    return { err }
}
export const op_webgpu_write_texture = (...args: any[]) => {
    console.warn("Not implemented: ops.op_webgpu_write_texture");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_write_texture"};
    return { err }
}

export const op_webgpu_create_shader_module = (rid: number, label: string, code: string, sourceMap: any) => {
    console.warn("Not implemented: ops.op_webgpu_create_shader_module");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_create_shader_module"};
    return { rid, err };
}

export const op_webgpu_compute_pass_dispatch_workgroups = (computePassRid: number, workgroupCountX: number, workgroupCountY: number, workgroupCountZ: number) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_dispatch_workgroups");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_compute_pass_dispatch_workgroups"};
    return { rid: computePassRid, err };
}

export const op_webgpu_compute_pass_dispatch_workgroups_indirect = (computePassRid: number, indirectBufferRid: number, indirectOffset: number) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_dispatch_workgroups_indirect");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_compute_pass_dispatch_workgroups_indirect"};
    return { err };
}

export const op_webgpu_compute_pass_end = (commandEncoderRid: number, computePassRid: number) => {
    console.warn("Not implemented: ops.op_webgpu_compute_pass_end");
    const err: { type: string, value: string} = { type: 'NotImplemented', value: "Not implemented: ops.op_webgpu_compute_pass_end"};
    return { rid: computePassRid, err };
}

export const op_ffi_load = (options: { path: string, symbols: {} }) => {
    console.warn("Not implemented: ops.op_ffi_load");
    const rid = 0;
    const symbols = {};
    return [rid, symbols];
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

export const op_ffi_cstr_read = (pointer: PointerValue, offset: number): string => {
    console.warn("Not implemented: ops.op_ffi_cstr_read");
    return "";
}

export const op_ffi_get_buf = (pointer: PointerValue, offset: number, byteLength: number): ArrayBuffer => {
    console.warn("Not implemented: ops.op_ffi_get_buf");
    return new ArrayBuffer(byteLength);
}

export const op_ffi_read_bool = (pointer: PointerValue, offset: number): boolean => {
    console.warn("Not implemented: ops.op_ffi_read_bool");
    return false;
}

export const op_ffi_read_u8 = (pointer: PointerValue, offset: number): number => {
    console.warn("Not implemented: ops.op_ffi_read_u8");
    return 0;
}
export const op_ffi_read_i8 = (pointer: PointerValue, offset: number): number => {
    console.warn("Not implemented: ops.op_ffi_read_i8");
    return 0;
}
export const op_ffi_read_u16 = (pointer: PointerValue, offset: number): number => {
    console.warn("Not implemented: ops.op_ffi_read_u16");
    return 0;
}
export const op_ffi_read_i16 = (pointer: PointerValue, offset: number): number => {
    console.warn("Not implemented: ops.op_ffi_read_i16");
    return 0;
}
export const op_ffi_read_u32 = (pointer: PointerValue, offset: number): number => {
    console.warn("Not implemented: ops.op_ffi_read_u32");
    return 0;
}
export const op_ffi_read_i32 = (pointer: PointerValue, offset: number): number => {
    console.warn("Not implemented: ops.op_ffi_read_i32");
    return 0;
}
export const op_ffi_read_u64 = (pointer: PointerValue, offset: number, buffer: Uint32Array): void => {
    console.warn("Not implemented: ops.op_ffi_read_u64");
}

export const op_ffi_read_i64 = (pointer: PointerValue, offset: number, buffer: Uint32Array): void => {
    console.warn("Not implemented: ops.op_ffi_read_i64");
}

export const op_ffi_read_f32 = (pointer: PointerValue, offset: number): number => {
    console.warn("Not implemented: ops.op_ffi_read_f32");
    return 0;
}
export const op_ffi_read_f64 = (pointer: PointerValue, offset: number): number => {
    console.warn("Not implemented: ops.op_ffi_read_f64");
    return 0;
}

export const op_ffi_unsafe_callback_create = (definition: any, callback: any): [number, PointerValue] => {
    console.warn("Not implemented: ops.op_ffi_unsafe_callback_create");
    const rid = 0;
    const pointer: PointerValue = 0;
    return [rid, pointer];
}

export const op_ffi_unsafe_callback_unref = (rid: number) => {
    console.warn("Not implemented: ops.op_ffi_unsafe_callback_unref");
}

export const op_main_module = (...args: any[]) => {
    console.warn("Not implemented: ops.op_main_module");
}
export const op_create_worker = (...args: any[]): number => {
    console.warn("Not implemented: ops.op_create_worker");
    return 0;
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
export const op_spawn_child = (
    options: {
        cmd: string;
        args: string[];
        cwd: string;
        clearEnv: boolean;
        env: [string, string][];
        uid: number;
        gid: number;
        stdin: "piped" | "inherit" | "null";
        stdout: "piped" | "inherit" | "null";
        stderr: "piped" | "inherit" | "null"
        windowsRawArguments: boolean;
    },
    apiName: string,
): {
    rid: number;
    pid: number;
    stdinRid: number,
    stdoutRid: number,
    stderrRid: number,
  } => {
    console.warn("Not implemented: ops.op_spawn_child");
    return {
        rid: 0,
        pid: 0,
        stdinRid: 0,
        stdoutRid: 0,
        stderrRid: 0,
    }
}
export const op_spawn_wait = (...args: any[]) => {
    console.warn("Not implemented: ops.op_spawn_wait");
}
export const op_spawn_sync = (...args: any[]): {
    status: ChildStatus;
    stdout: Uint8Array | null;
    stderr: Uint8Array | null;
} => {
    console.warn("Not implemented: ops.op_spawn_sync");
    const status: ChildStatus = {
        code: 0,
        signal: null,
        success: false,
    }
    return {
        status,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
    }
}
export const op_fs_events_open = (options: { recursive: boolean, paths: string[] }): number => {
    console.warn("Not implemented: ops.op_fs_events_open");
    return 0;
}
export const op_fs_events_poll = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fs_events_poll");
}
export const op_open_sync = (path: string, options: OpenOptions, mode: number): number => {
    console.warn("Not implemented: ops.op_open_sync");
    return 0;
}
export const op_open_async = async (path: string, options: OpenOptions, mode: number): Promise<number> => {
    console.warn("Not implemented: ops.op_open_async");
    return 0;
}
export const op_write_file_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_write_file_sync");
}
export const op_write_file_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_write_file_async");
}
export const op_seek_sync = (options: { rid: number, offset: number, whence: SeekMode }): number => {
    console.warn("Not implemented: ops.op_seek_sync");
    return 0;
}
export const op_seek_async = async (options: { rid: number, offset: number, whence: SeekMode }): Promise<number> => {
    console.warn("Not implemented: ops.op_seek_async");
    return 0;
}
export const op_fdatasync_sync = (rid: number): void => {
    console.warn("Not implemented: ops.op_fdatasync_sync");
}
export const op_fdatasync_async = async (rid: number): Promise<void> => {
    console.warn("Not implemented: ops.op_fdatasync_async");
}
export const op_fsync_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fsync_sync");
}
export const op_fsync_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_fsync_async");
}
export const op_fstat_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_fstat_sync");
}
export const op_fstat_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_fstat_async");
}
export const op_flock_sync = (rid: number, exclusive: boolean) => {
    console.warn("Not implemented: ops.op_flock_sync");
}
export const op_flock_async = async (rid: number, exclusive: boolean) => {
    console.warn("Not implemented: ops.op_flock_async");
}
export const op_funlock_sync = (rid: number) => {
    console.warn("Not implemented: ops.op_funlock_sync");
}
export const op_funlock_async = async (rid: number) => {
    console.warn("Not implemented: ops.op_funlock_async");
}
export const op_umask = (...args: any[]) => {
    console.warn("Not implemented: ops.op_umask");
}
export const op_chdir = (...args: any[]) => {
    console.warn("Not implemented: ops.op_chdir");
}
export const op_mkdir_sync = (args: { path: string; recursive: boolean; mode?: number; }): void => {
    console.warn("Not implemented: ops.op_mkdir_sync");
}
export const op_mkdir_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_mkdir_async");
}
export const op_chmod_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_chmod_sync");
}
export const op_chmod_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_chmod_async");
}
export const op_chown_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_chown_sync");
}
export const op_chown_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_chown_async");
}
export const op_remove_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_remove_sync");
}
export const op_remove_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_remove_async");
}
export const op_copy_file_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_copy_file_sync");
}
export const op_copy_file_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_copy_file_async");
}
export const op_stat_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_stat_sync");
}
export const op_stat_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_stat_async");
}
export const op_realpath_sync = (path: string): string => {
    console.warn("Not implemented: ops.op_realpath_sync");
    return "";
}
export const op_realpath_async = async (path: string): Promise<string> => {
    console.warn("Not implemented: ops.op_realpath_async");
    return "";
}
export const op_read_dir_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_read_dir_sync");
}
export const op_read_dir_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_read_dir_async");
}
export const op_rename_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_rename_sync");
}
export const op_rename_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_rename_async");
}
export const op_link_sync = (oldpath: string, newpath: string): void => {
    console.warn("Not implemented: ops.op_link_sync");
}
export const op_link_async = async (oldpath: string, newpath: string): Promise<void> => {
    console.warn("Not implemented: ops.op_link_async");
}
export const op_symlink_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_symlink_sync");
}
export const op_symlink_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_symlink_async");
}
export const op_read_link_sync = (path: string): string => {
    console.warn("Not implemented: ops.op_read_link_sync");
    return "";
}
export const op_read_link_async = async (path: string): Promise<string> => {
    console.warn("Not implemented: ops.op_read_link_async");
    return "";
}
export const op_ftruncate_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_ftruncate_sync");
}
export const op_ftruncate_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_ftruncate_async");
}
export const op_truncate_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_truncate_sync");
}
export const op_truncate_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_truncate_async");
}
export const op_make_temp_dir_sync = (options: MakeTempOptions): string => {
    console.warn("Not implemented: ops.op_make_temp_dir_sync");
    return "";
}
export const op_make_temp_dir_async = async (options: MakeTempOptions): Promise<string> => {
    console.warn("Not implemented: ops.op_make_temp_dir_async");
    return "";
}
export const op_make_temp_file_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_make_temp_file_sync");
}
export const op_make_temp_file_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_make_temp_file_async");
}
export const op_cwd = (): string => {
    console.warn("Not implemented: ops.op_cwd");
    return "";
}
export const op_futime_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_futime_sync");
}
export const op_futime_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_futime_async");
}
export const op_utime_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_utime_sync");
}
export const op_utime_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_utime_async");
}
export const op_readfile_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_readfile_sync");
}
export const op_readfile_text_sync = (...args: any[]) => {
    console.warn("Not implemented: ops.op_readfile_text_sync");
}
export const op_readfile_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_readfile_async");
}
export const op_readfile_text_async = async (...args: any[]) => {
    console.warn("Not implemented: ops.op_readfile_text_async");
}
export const op_read_sync = (...args: any[]): number => {
    console.warn("Not implemented: ops.op_read_sync");
    return 0;
}
export const op_write_sync = (rid: number, data: Uint8Array): number => {
    console.warn("Not implemented: ops.op_write_sync");
    return 0;
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
export const op_env = (): { [index: string]: string } => {
    console.warn("Not implemented: ops.op_env");
    return {};
}
export const op_exec_path = (...args: any[]) => {
    console.warn("Not implemented: ops.op_exec_path");
}
export const op_exit = (...args: any[]) => {
    console.warn("Not implemented: ops.op_exit");
}
export const op_delete_env = (key: string): void => {
    console.warn("Not implemented: ops.op_delete_env");
}
export const op_get_env = (key: string): string | undefined => {
    console.warn("Not implemented: ops.op_get_env");
    return undefined;
}
export const op_getuid = (...args: any[]) => {
    console.warn("Not implemented: ops.op_getuid");
}
export const op_hostname = (): string => {
    console.warn("Not implemented: ops.op_hostname");
    return "";
}
export const op_loadavg = (): number[] => {
    console.warn("Not implemented: ops.op_loadavg");
    return [];
}
export const op_network_interfaces = (...args: any[]) => {
    console.warn("Not implemented: ops.op_network_interfaces");
}
export const op_os_release = (): string => {
    console.warn("Not implemented: ops.op_os_release");
    return "";
}
export const op_set_env = (key: string, value: string): void => {
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
export const op_kill = (pid: number, signo: Signal, parent: string) => {
    console.warn("Not implemented: ops.op_kill");
}
export const op_signal_bind = (signo: Signal): number => {
    console.warn("Not implemented: ops.op_signal_bind");
    return 0;
}
export const op_signal_unbind = (rid: number) => {
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
export const op_http_start = (rid: number): number => {
    console.warn("Not implemented: ops.op_http_start");
    return 0;
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

export const op_create_host_object = (): object => {
    console.warn("Not implemented: ops.op_create_host_object");
    return new Object();
}

export const op_encode = (text: string): Uint8Array => {
    console.warn("Not implemented: ops.op_encode");
    return new Uint8Array();
}

export const op_encode_binary_string = (bytes: Uint8Array): string => {
    console.warn("Not implemented: ops.op_encode_binary_string");
    return "";
}

export const op_decode = (buffer: Uint8Array): string => {
    console.warn("Not implemented: ops.op_decode");
    return "";
}

export const op_serialize = (value, options = {}, errorCallback?): any => {
    console.warn("Not implemented: ops.op_serialize");
}

export const op_deserialize = (buffer, options = {}): any => {
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

export const op_abort_wasm_streaming = (rid: number, error: Error): void  => {
    console.warn("Not implemented: ops.op_abort_wasm_streaming");
}

export const op_destructure_error = (error: Error) => {
    console.warn("Not implemented: ops.op_destructure_error");
    const frames = [];
    return {
        frames,
        exceptionMessage: ""
    }
}

export const op_dispatch_exception = (error: Error) => {
    console.warn("Not implemented: ops.op_dispatch_exception");
}

export const op_event_loop_has_more_work = (): void  => {
    console.warn("Not implemented: ops.op_event_loop_has_more_work");
}

export const op_set_promise_reject_callback = (fn: PromiseRejectCallback): void  => {
    console.warn("Not implemented: ops.op_set_promise_reject_callback");
}

export const op_str_byte_length = (str: string): number  => {
    console.warn("Not implemented: ops.op_str_byte_length");
    return str.length;
}

export const op_apply_source_map = (cse)  => {
    console.warn("Not implemented: ops.op_apply_source_map");
    return {};
}

export const op_url_get_serialization = () => {
    console.warn("Not implemented: ops.op_url_get_serialization");
    return {};
}

export const op_arraybuffer_was_detached = (O: ArrayBufferLike): boolean => {
    console.warn("Not implemented: ops.op_arraybuffer_was_detached");
    return false;
}

export const op_transfer_arraybuffer = (O: ArrayBufferLike): ArrayBufferLike => {
    console.warn("Not implemented: ops.op_transfer_arraybuffer");
    return new ArrayBuffer(0);
}

export const op_gid = (): number => {
    console.warn("Not implemented: ops.op_gid");
    return 0;
}

export const op_uid = (): number => {
    console.warn("Not implemented: ops.op_uid");
    return 0;
}

export const op_stdin_set_raw = (mode: boolean, cbreak: boolean): void => {
    console.warn("Not implemented: ops.op_stdin_set_raw");
}

export const op_pledge_test_permissions = (permissions: PermissionOptions) => {
    console.warn("Not implemented: ops.op_pledge_test_permissions");
    const token = "";
    return token;
}

export const op_restore_test_permissions = (token: string) => {
    console.warn("Not implemented: ops.op_restore_test_permissions");
}

export const op_dispatch_test_event = (
    options: {
        stepWait?: number;
        stepResult?: any[];
        wait?: number; 
        plan?: any; // TODO
        result?: any[]; // TODO
    }
) => {
    console.warn("Not implemented: ops.op_dispatch_test_event");
}

export const op_dispatch_bench_event = (options: {
    output?: string;
    wait?: number; 
    plan?: any; // TODO
    result?: any[]; // TODO
}) => {
    console.warn("Not implemented: ops.op_dispatch_bench_event");
}

export const op_register_test = (desc: /*TestDescription*/ any) => {
    console.warn("Not implemented: ops.op_register_test");
    const id: number = 0;
    const filteredOut: boolean = false;
    return {
        id,
        filteredOut
    }
}

export const op_bench_check_unstable = () => {
    console.warn("Not implemented: ops.op_bench_check_unstable");
}

export const op_register_bench = (benchDesc: any) => {
    console.warn("Not implemented: ops.op_register_bench");
    const id: number = 0;
    const filteredOut: boolean = false;
    return {
        id,
        filteredOut
    }
}

export const op_bench_now = () => {
    console.warn("Not implemented: ops.op_bench_now");
    return 0;
}

export const op_get_test_origin = () => {
    console.warn("Not implemented: ops.op_get_test_origin");
    return "";
}

export const op_get_bench_origin = () => {
    console.warn("Not implemented: ops.op_get_bench_origin");
    return "";
}

export const op_register_test_step = (stepDesc: TestStepDefinition) => {
    console.warn("Not implemented: ops.op_register_test_step");
    return {
        id: 0
    };
}

export const op_net_listen_tcp = (options: {
    hostname: string;
    port: number;
  }, reusePort: number): [number, {transport: string}] => {
    console.warn("Not implemented: ops.op_net_listen_tcp");
    const rid: number = 0;
    const addr: {
        transport: string
    } = {
        transport: ""
    }
    return [rid, addr];
}

export const op_net_listen_unix = (path: string): [number, string] => {
    console.warn("Not implemented: ops.op_net_listen_unix");
    const rid = 0;
    return [rid, path];
}

export const op_net_listen_tls = (addr: { hostname: string, port: number }, cert: { cert, certFile, key, keyFile, alpnProtocols, reusePort }): [number, any] => {
    console.warn("Not implemented: ops.op_net_listen_tls");
    const rid = 0;
    return [rid, addr];
}

export const op_ws_try_send_string = (rid: number, data: string) => {
    console.warn("Not implemented: ops.op_ws_try_send_string");
    const send = false;
    return send;
}

export const op_ws_try_send_binary = (rid: number, data: TypedArray) => {
    console.warn("Not implemented: ops.op_ws_try_send_binary");
    const send = false;
    return send;
}

export const op_flash_make_request = () => {
    console.warn("Not implemented: ops.op_flash_make_request");
}

export const op_flash_respond = (server, requestId, response, end, shutdown?) => {
    console.warn("Not implemented: ops.op_flash_respond");
    const nwritten = -1;
    return nwritten;
}

export const op_flash_upgrade_http = (streamRid: number, serverId: number) => {
    console.warn("Not implemented: ops.op_flash_upgrade_http");
    const connRid = -1;
    return connRid;
}

export const op_flash_first_packet = (streamRid: number, token) => {
    console.warn("Not implemented: ops.op_flash_first_packet");
    const firstRead = null;
    return firstRead;
}

export const op_flash_next_server = (serverId: number) => {
    console.warn("Not implemented: ops.op_flash_next_server");
}

export const op_flash_path = (serverId: number, index: number) => {
    console.warn("Not implemented: ops.op_flash_path");
}

export const op_flash_headers = (serverId: number, index: number): [string, string][] => {
    console.warn("Not implemented: ops.op_flash_headers");
    return []
}

export const op_flash_method = (serverId: number, token) => {
    console.warn("Not implemented: ops.op_flash_method");
    const firstRead = null;
    return firstRead;
}

export const op_worker_close = () => {
    console.warn("Not implemented: ops.op_worker_close");
}

export const op_worker_post_message = (data: messagePort.MessageData) => {
    console.warn("Not implemented: ops.op_worker_post_message");
}

export const op_worker_get_type = () => {
    console.warn("Not implemented: ops.op_worker_get_type");
    return "";
}

export const op_worker_sync_fetch = (parsedUrls: string[], notLoadedMainWorkerScript: boolean) => {
    console.warn("Not implemented: ops.op_worker_sync_fetch");
    return [];
}

export const op_set_format_exception_callback = (cb: (error: Error | string) => string) => {
    console.warn("Not implemented: ops.op_set_format_exception_callback");
    return [];
}

export const op_store_pending_promise_exception = (promise, reason) => {
    console.warn("Not implemented: ops.op_store_pending_promise_exception");
}

export const op_remove_pending_promise_exception = (promise) => {
    console.warn("Not implemented: ops.op_remove_pending_promise_exception");
}

export const op_has_pending_promise_exception = (promise) => {
    console.warn("Not implemented: ops.op_has_pending_promise_exception");
    return false;
}

