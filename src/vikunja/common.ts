import {
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
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

type Response<T> = {
  data?: T;
  isError: boolean;
  error?: string;
};

export type ErrorResponse = { isError: true; error: string };

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
    serviceInstance.put<T>(path, form, {
      headers: { 'Content-Type': null },
    }),
  );
};

export type ToolHandler = (request: CallToolRequest) => Promise<CallToolResult>;

// Coerce an ID argument to a number. MCP clients may serialize integers as
// strings depending on the transport, so we cannot rely on `typeof === 'number'`
// to validate IDs — that rejects a perfectly valid "42". Returns NaN when the
// value can't be converted; callers gate on isNaN(toInt(x)).
export const toInt = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return parseInt(value, 10);
  return NaN;
};

// Vikunja's POST /resource/{id} endpoints are full-replace, not partial merge:
// any field omitted from the body is reset to its zero value (title -> "",
// priority -> 0, parent_project_id -> 0, etc.). To get true partial-update
// semantics we GET the current resource, overlay the caller's partial, strip
// server-managed / endpoint-rejected fields, and POST the merged object.
export const mergeAndPost = async <T>(
  path: string,
  partial: Record<string, unknown>,
  stripKeys: readonly string[],
): Promise<Response<T>> => {
  const current = await wrapRequest(
    serviceInstance.get<Record<string, unknown>>(path),
  );
  if (current.isError || !current.data) {
    return current as Response<T>;
  }
  const merged: Record<string, unknown> = { ...current.data, ...partial };
  for (const k of stripKeys) delete merged[k];
  return wrapRequest(serviceInstance.post<T>(path, merged));
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
] as const;

const PROJECT_STRIP_KEYS = [
  'background_blur_hash',
  'background_information',
  'subscription',
  'views',
  'owner',
  'position',
  'hex_color',
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
