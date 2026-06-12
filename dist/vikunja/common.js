import axios from 'axios';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
const baseURL = `${process.env.VIKUNJA_API_BASE}/api/v1`;
const headers = {
    Authorization: `Bearer ${process.env.VIKUNJA_API_TOKEN}`,
    'Content-Type': 'application/json',
};
export const serviceInstance = axios.create({
    baseURL,
    headers,
});
export const wrapRequest = async (request) => {
    try {
        const response = await request;
        return {
            data: response.data,
            isError: false,
        };
    }
    catch (error) {
        const errorMessage = axios.isAxiosError(error)
            ? error.response?.data?.message || error.message
            : `Unexpected error: ${error}`;
        return {
            isError: true,
            error: errorMessage,
        };
    }
};
// Vikunja's attachment endpoint is the only one that takes files, not JSON. The
// shared serviceInstance defaults Content-Type to application/json, so we null
// it here and let axios derive the multipart/form-data boundary from the
// FormData body. Files are read from the MCP host's local filesystem by path —
// MCP tool calls carry JSON args, not raw bytes, so the caller passes paths.
export const uploadFiles = async (path, filePaths, fieldName = 'files') => {
    const form = new FormData();
    for (const fp of filePaths) {
        const buf = await readFile(fp);
        form.append(fieldName, new Blob([buf]), basename(fp));
    }
    return wrapRequest(serviceInstance.put(path, form, {
        headers: { 'Content-Type': null },
    }));
};
// Vikunja's POST /resource/{id} endpoints are full-replace, not partial merge:
// any field omitted from the body is reset to its zero value (title -> "",
// priority -> 0, parent_project_id -> 0, etc.). To get true partial-update
// semantics we GET the current resource, overlay the caller's partial, strip
// server-managed / endpoint-rejected fields, and POST the merged object.
export const mergeAndPost = async (path, partial, stripKeys) => {
    const current = await wrapRequest(serviceInstance.get(path));
    if (current.isError || !current.data) {
        return current;
    }
    const merged = { ...current.data, ...partial };
    for (const k of stripKeys)
        delete merged[k];
    return wrapRequest(serviceInstance.post(path, merged));
};
// Fields that bloat LLM context with no value for typical task workflows.
// Stripped by default; pass verbose=true on a tool call to retain them.
const TASK_STRIP_KEYS = [
    'reactions',
    'attachments',
    'created_by',
    'related_tasks',
    'cover_image_attachment_id',
    'position',
    'index',
    'reminders',
    'hex_color',
    'repeat_after',
    'repeat_mode',
];
const PROJECT_STRIP_KEYS = [
    'background_blur_hash',
    'background_information',
    'subscription',
    'views',
    'owner',
    'position',
    'hex_color',
];
const stripFields = (obj, keys) => {
    const out = { ...obj };
    for (const k of keys)
        delete out[k];
    return out;
};
export const slimTask = (task, verbose = false) => (verbose ? task : stripFields(task, TASK_STRIP_KEYS));
export const slimProject = (project, verbose = false) => verbose ? project : stripFields(project, PROJECT_STRIP_KEYS);
export const slimList = (items, kind, verbose = false) => {
    if (verbose)
        return items;
    const keys = kind === 'task' ? TASK_STRIP_KEYS : PROJECT_STRIP_KEYS;
    return items.map(item => stripFields(item, keys));
};
