import axios from 'axios';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
// Vikunja API v2 (shipped stable in 2.4.0). v2 is RESTful — POST creates, PUT
// full-replaces, PATCH partial-updates — and wraps every list response in a
// pagination envelope. See the migration note in the llm-notes for the full
// v1→v2 diff. Auth is unchanged: APITokenAuth via a Bearer token.
const baseURL = `${process.env.VIKUNJA_API_BASE}/api/v2`;
const headers = {
    Authorization: `Bearer ${process.env.VIKUNJA_API_TOKEN}`,
    'Content-Type': 'application/json',
};
export const serviceInstance = axios.create({
    baseURL,
    headers,
});
// v2 returns RFC-9457-style problem+json errors (VikunjaErrorModel):
// { status, title, detail, errors: [{ location, message, value }], type }.
// Attachment uploads use a simpler { code, message }. We surface title+detail
// plus any field-validation messages, falling back to `message` then the
// axios error text.
const extractError = (error) => {
    if (!axios.isAxiosError(error))
        return `Unexpected error: ${error}`;
    const data = error.response?.data;
    if (data && typeof data === 'object') {
        const parts = [];
        if (typeof data.title === 'string')
            parts.push(data.title);
        if (typeof data.detail === 'string' && data.detail !== data.title)
            parts.push(data.detail);
        if (Array.isArray(data.errors) && data.errors.length) {
            const fields = data.errors
                .map(e => typeof e?.message === 'string'
                ? `${e.location ? `${e.location}: ` : ''}${e.message}`
                : JSON.stringify(e))
                .join('; ');
            if (fields)
                parts.push(fields);
        }
        if (parts.length)
            return parts.join(' — ');
        if (typeof data.message === 'string')
            return data.message;
    }
    return error.message;
};
export const wrapRequest = async (request) => {
    try {
        const response = await request;
        return {
            data: response.data,
            isError: false,
        };
    }
    catch (error) {
        return {
            isError: true,
            error: extractError(error),
        };
    }
};
export const getList = async (path, config) => {
    const res = await wrapRequest(serviceInstance.get(path, config));
    if (res.isError)
        return { isError: true, error: res.error };
    return { isError: false, data: res.data?.items ?? [] };
};
// Vikunja's attachment endpoint is the only one that takes files, not JSON. The
// shared serviceInstance defaults Content-Type to application/json, so we null
// it here and let axios derive the multipart/form-data boundary from the
// FormData body. Files are read from the MCP host's local filesystem by path —
// MCP tool calls carry JSON args, not raw bytes, so the caller passes paths.
// v2 creates attachments with POST (v1 used PUT).
export const uploadFiles = async (path, filePaths, fieldName = 'files') => {
    const form = new FormData();
    for (const fp of filePaths) {
        const buf = await readFile(fp);
        form.append(fieldName, new Blob([buf]), basename(fp));
    }
    return wrapRequest(serviceInstance.post(path, form, {
        headers: { 'Content-Type': null },
    }));
};
// v2 partial update: PATCH sends only the fields the caller changed, so there's
// no GET-then-merge round-trip and no risk of zeroing omitted fields (this
// replaces v1's mergeAndPost). stripKeys drops any caller-supplied field the
// endpoint rejects or that lives on a nested route (e.g. task labels/assignees).
export const patch = async (path, partial, stripKeys = []) => {
    const body = { ...partial };
    for (const k of stripKeys)
        delete body[k];
    return wrapRequest(serviceInstance.patch(path, body));
};
// Note: the few v2 resources that expose only PUT (full-replace) and no PATCH —
// kanban buckets, project-team/project-user permission rows — either send a
// complete merged body inline (see updateBucket in kanban.ts) or a minimal body
// whose only mutable field is what the caller changed (see sharing.ts).
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
    '$schema',
];
const PROJECT_STRIP_KEYS = [
    'background_blur_hash',
    'background_information',
    'subscription',
    'views',
    'owner',
    'position',
    'hex_color',
    '$schema',
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
