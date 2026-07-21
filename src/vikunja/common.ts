import {
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
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

type Response<T> = {
  data?: T;
  isError: boolean;
  error?: string;
};

export type ErrorResponse = { isError: true; error: string };

// v2 returns RFC-9457-style problem+json errors (VikunjaErrorModel):
// { status, title, detail, errors: [{ location, message, value }], type }.
// Attachment uploads use a simpler { code, message }. We surface title+detail
// plus any field-validation messages, falling back to `message` then the
// axios error text.
const extractError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return `Unexpected error: ${error}`;
  const data = error.response?.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object') {
    const parts: string[] = [];
    if (typeof data.title === 'string') parts.push(data.title);
    if (typeof data.detail === 'string' && data.detail !== data.title)
      parts.push(data.detail);
    if (Array.isArray(data.errors) && data.errors.length) {
      const fields = (data.errors as Array<Record<string, unknown>>)
        .map(e =>
          typeof e?.message === 'string'
            ? `${e.location ? `${e.location}: ` : ''}${e.message}`
            : JSON.stringify(e),
        )
        .join('; ');
      if (fields) parts.push(fields);
    }
    if (parts.length) return parts.join(' — ');
    if (typeof data.message === 'string') return data.message;
  }
  return error.message;
};

export const wrapRequest = async <T>(
  request: Promise<AxiosResponse<T>>,
): Promise<Response<T>> => {
  try {
    const response = await request;
    return {
      data: response.data,
      isError: false,
    };
  } catch (error) {
    return {
      isError: true,
      error: extractError(error),
    };
  }
};

// v2 wraps list responses in a pagination envelope:
//   { items: T[] | null, page, per_page, total, total_pages }
// The kanban board endpoint uses the same `items` field (BucketsWithTasksBody).
// getList performs the GET and hands callers back a plain T[] in `data`, so the
// tool handlers stay envelope-agnostic. Pagination metadata (total etc.) lives
// in the body now, but the handlers only need the page's items.
type Paginated<T> = {
  items: T[] | null;
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
};

export const getList = async <T>(
  path: string,
  config?: Parameters<typeof serviceInstance.get>[1],
): Promise<Response<T[]>> => {
  const res = await wrapRequest(
    serviceInstance.get<Paginated<T>>(path, config),
  );
  if (res.isError) return { isError: true, error: res.error };
  return { isError: false, data: res.data?.items ?? [] };
};

// Vikunja's attachment endpoint is the only one that takes files, not JSON. The
// shared serviceInstance defaults Content-Type to application/json, so we null
// it here and let axios derive the multipart/form-data boundary from the
// FormData body. Files are read from the MCP host's local filesystem by path —
// MCP tool calls carry JSON args, not raw bytes, so the caller passes paths.
// v2 creates attachments with POST (v1 used PUT).
export const uploadFiles = async <T>(
  path: string,
  filePaths: string[],
  fieldName = 'files',
): Promise<Response<T>> => {
  const form = new FormData();
  for (const fp of filePaths) {
    const buf = await readFile(fp);
    form.append(fieldName, new Blob([buf]), basename(fp));
  }
  return wrapRequest(
    serviceInstance.post<T>(path, form, {
      headers: { 'Content-Type': null },
    }),
  );
};

export type ToolHandler = (request: CallToolRequest) => Promise<CallToolResult>;

// v2 partial update: PATCH sends only the fields the caller changed, so there's
// no GET-then-merge round-trip and no risk of zeroing omitted fields (this
// replaces v1's mergeAndPost). stripKeys drops any caller-supplied field the
// endpoint rejects or that lives on a nested route (e.g. task labels/assignees).
export const patch = async <T>(
  path: string,
  partial: Record<string, unknown>,
  stripKeys: readonly string[] = [],
): Promise<Response<T>> => {
  const body: Record<string, unknown> = { ...partial };
  for (const k of stripKeys) delete body[k];
  return wrapRequest(serviceInstance.patch<T>(path, body));
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
] as const;

const PROJECT_STRIP_KEYS = [
  'background_blur_hash',
  'background_information',
  'subscription',
  'views',
  'owner',
  'position',
  'hex_color',
  '$schema',
] as const;

const stripFields = <T extends Record<string, unknown>>(
  obj: T,
  keys: readonly string[],
): Partial<T> => {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) delete out[k];
  return out as Partial<T>;
};

export const slimTask = <T extends Record<string, unknown>>(
  task: T,
  verbose = false,
): Partial<T> | T => (verbose ? task : stripFields(task, TASK_STRIP_KEYS));

export const slimProject = <T extends Record<string, unknown>>(
  project: T,
  verbose = false,
): Partial<T> | T =>
  verbose ? project : stripFields(project, PROJECT_STRIP_KEYS);

export const slimList = <T extends Record<string, unknown>>(
  items: T[],
  kind: 'task' | 'project',
  verbose = false,
): Array<Partial<T> | T> => {
  if (verbose) return items;
  const keys = kind === 'task' ? TASK_STRIP_KEYS : PROJECT_STRIP_KEYS;
  return items.map(item => stripFields(item, keys));
};
