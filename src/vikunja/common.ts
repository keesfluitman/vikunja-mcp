import {
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import type { AxiosResponse } from 'axios';

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

export type ToolHandler = (request: CallToolRequest) => Promise<CallToolResult>;

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
