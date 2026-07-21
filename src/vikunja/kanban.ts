import { z } from 'zod';
import {
  serviceInstance,
  wrapRequest,
  getList,
  patch,
  slimList,
} from './common.js';
import type { ToolHandler } from './common.js';

// Kanban in Vikunja lives under project VIEWS, not the project directly. A
// project has several views (list/gantt/table/kanban); only the kanban view
// owns buckets. Buckets are therefore addressed per-view, and a task's
// membership in a bucket is unique per (task, project_view_id) — the global
// task.bucket_id field is ambiguous across views and must NOT be used to move
// a task. Use move_task_to_bucket (POST .../buckets/{bucket}/tasks) instead.

// View fields worth returning to the LLM. The kanban view's default_bucket_id
// (where new tasks land) and done_bucket_id (tasks dropped here are marked
// done) are the high-value bits for automation.
type ProjectView = {
  id: number;
  title: string;
  project_id: number;
  view_kind: string;
  position: number;
  default_bucket_id: number;
  done_bucket_id: number;
};

const VIEW_KEEP_KEYS = [
  'id',
  'title',
  'project_id',
  'view_kind',
  'position',
  'default_bucket_id',
  'done_bucket_id',
] as const;

const slimView = (view: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of VIEW_KEEP_KEYS) if (k in view) out[k] = view[k];
  return out;
};

type Bucket = {
  id: number;
  title: string;
  project_view_id: number;
  limit: number;
  count: number;
  position: number;
};

// The board endpoint the web UI uses to render a kanban view. Same buckets as
// the /buckets endpoint, but each carries a nested `tasks[]` array.
type ViewBucketWithTasks = Bucket & {
  tasks?: Array<Record<string, unknown>> | null;
};

// Bucket metadata worth returning alongside the tasks. `count` is derived from
// the nested tasks[] length, not the server's `count` field — the latter is
// broken (always 0) on the /buckets endpoint in Vikunja v2.3.0.
const BOARD_BUCKET_KEEP_KEYS = [
  'id',
  'title',
  'project_view_id',
  'position',
  'limit',
] as const;

const BucketInputSchema = z.object({
  title: z.string().optional(),
  // Per-bucket WIP limit; 0 means no limit.
  limit: z.number().int().min(0).optional(),
  position: z.number().optional(),
});

export type BucketInput = z.infer<typeof BucketInputSchema>;

const listProjectViews = async (projectId: number) =>
  getList<ProjectView>(`/projects/${projectId}/views`);

const listBuckets = async (projectId: number, viewId: number) =>
  getList<Bucket>(`/projects/${projectId}/views/${viewId}/buckets`);

// The board endpoint — buckets each with a nested `tasks[]` array — is the ONLY
// way to read which tasks sit in which kanban column (plain task lists report
// bucket_id: 0 because membership is per-view). In v2 this moved: the board is
// GET /views/{v}/buckets/tasks (returns { items: Bucket[], total }, unwrapped by
// getList), while /views/{v}/tasks now returns a flat paginated task list.
// `per_page` bounds tasks per bucket.
const listViewTasks = async (
  projectId: number,
  viewId: number,
  perPage = 200,
) =>
  getList<ViewBucketWithTasks>(
    `/projects/${projectId}/views/${viewId}/buckets/tasks`,
    { params: { per_page: perPage } },
  );

const createBucket = async (
  projectId: number,
  viewId: number,
  bucket: BucketInput,
) =>
  wrapRequest(
    serviceInstance.post<Bucket>(
      `/projects/${projectId}/views/${viewId}/buckets`,
      bucket,
    ),
  );

// PUT /projects/{p}/views/{v}/buckets/{b} is full-replace (v2 exposes no PATCH
// for buckets), and there is no GET-single-bucket route — so we list the view's
// buckets, find this one, overlay the caller's partial, and PUT the merged
// object. Omitting `position` here would otherwise reset it to 0 and silently
// reorder the board.
const BUCKET_UPDATE_STRIP_KEYS = [
  'created',
  'updated',
  'created_by',
  'count',
  'tasks',
  '$schema',
] as const;

const updateBucket = async (
  projectId: number,
  viewId: number,
  bucketId: number,
  partial: BucketInput,
) => {
  const current = await listBuckets(projectId, viewId);
  if (current.isError || !current.data) return current;
  const existing = current.data.find(b => b.id === bucketId);
  if (!existing) {
    return {
      isError: true as const,
      error: `Bucket ${bucketId} not found in project ${projectId} view ${viewId}`,
    };
  }
  // Overlay only DEFINED fields — zod keeps optional keys the caller omitted as
  // explicit `undefined`, which would otherwise clobber the existing value
  // (e.g. reset a WIP limit to 0) once JSON.stringify drops the undefined on a
  // full-replace PUT.
  const overlay = Object.fromEntries(
    Object.entries(partial).filter(([, v]) => v !== undefined),
  );
  const merged: Record<string, unknown> = { ...existing, ...overlay };
  for (const k of BUCKET_UPDATE_STRIP_KEYS) delete merged[k];
  return wrapRequest(
    serviceInstance.put<Bucket>(
      `/projects/${projectId}/views/${viewId}/buckets/${bucketId}`,
      merged,
    ),
  );
};

const deleteBucket = async (
  projectId: number,
  viewId: number,
  bucketId: number,
) =>
  wrapRequest(
    serviceInstance.delete(
      `/projects/${projectId}/views/${viewId}/buckets/${bucketId}`,
    ),
  );

const moveTaskToBucket = async (
  projectId: number,
  viewId: number,
  bucketId: number,
  taskId: number,
) =>
  wrapRequest(
    serviceInstance.put(
      `/projects/${projectId}/views/${viewId}/buckets/${bucketId}/tasks`,
      { task_id: taskId, bucket_id: bucketId, project_view_id: viewId },
    ),
  );

// View CRUD (v2): create = POST, update = PATCH (partial, so the view's filter
// object and bucket config are preserved without a fetch-then-merge). `filter`
// is a TaskCollection object ({ filter: "<DSL>", filter_include_nulls, ... }),
// and `bucket_configuration` an array — both passed through as-is.
const ViewInputSchema = z.object({
  title: z.string().optional(),
  view_kind: z.enum(['list', 'gantt', 'table', 'kanban']).optional(),
  filter: z.record(z.unknown()).optional(),
  position: z.number().optional(),
  bucket_configuration_mode: z.enum(['none', 'manual', 'filter']).optional(),
  default_bucket_id: z.number().int().optional(),
  done_bucket_id: z.number().int().optional(),
  bucket_configuration: z.array(z.unknown()).optional(),
});

export type ViewInput = z.infer<typeof ViewInputSchema>;

const createView = async (projectId: number, view: ViewInput) =>
  wrapRequest(
    serviceInstance.post<ProjectView>(`/projects/${projectId}/views`, view),
  );

const updateView = async (
  projectId: number,
  viewId: number,
  partial: ViewInput,
) =>
  patch<ProjectView>(
    `/projects/${projectId}/views/${viewId}`,
    partial as Record<string, unknown>,
  );

const deleteView = async (projectId: number, viewId: number) =>
  wrapRequest(serviceInstance.delete(`/projects/${projectId}/views/${viewId}`));

export default {
  listProjectViews,
  listBuckets,
  listViewTasks,
  createBucket,
  updateBucket,
  deleteBucket,
  moveTaskToBucket,
  createView,
  updateView,
  deleteView,
};

export const toolDefinitions = [
  {
    name: 'list_project_views',
    description:
      "List a project's views (list/gantt/table/kanban). Use this to discover the kanban view's id plus its default_bucket_id (where new tasks land) and done_bucket_id (dropping a task here marks it done) before working with buckets.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_buckets',
    description:
      'List the kanban buckets (columns) of a project view — id, title, position, WIP limit, and a per-bucket task count. The count is derived from the board endpoint (the buckets endpoint’s own count is broken on Vikunja v2.3.0). Metadata only, no tasks — use get_kanban_board to read the tasks in each column. Get the viewId from list_project_views (the view_kind="kanban" entry).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        viewId: {
          type: 'integer',
          description: 'The kanban view ID (from list_project_views)',
        },
      },
      required: ['projectId', 'viewId'],
    },
  },
  {
    name: 'get_kanban_board',
    description:
      'Read a kanban board: returns each bucket (column) with its tasks nested inside. This is the ONLY way to see which tasks sit in which column — plain task lists report bucket_id: 0 because bucket membership is per-view. Tasks are slimmed like the other list tools (pass verbose:true for full objects). Get the viewId from list_project_views (the view_kind="kanban" entry).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        viewId: {
          type: 'integer',
          description: 'The kanban view ID (from list_project_views)',
        },
        per_page: {
          type: 'integer',
          description: 'Max tasks per bucket (default 200)',
        },
        verbose: {
          type: 'boolean',
          description:
            'Return full task objects instead of the slimmed payload. Default false.',
        },
      },
      required: ['projectId', 'viewId'],
    },
  },
  {
    name: 'create_bucket',
    description: 'Create a new kanban bucket (column) in a project view.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        viewId: { type: 'integer', description: 'The kanban view ID' },
        title: { type: 'string', description: 'Bucket title' },
        limit: {
          type: 'integer',
          description: 'WIP limit (0 = no limit, default)',
          minimum: 0,
        },
        position: {
          type: 'number',
          description: 'Sort position among buckets (optional)',
        },
      },
      required: ['projectId', 'viewId', 'title'],
    },
  },
  {
    name: 'update_bucket',
    description:
      'Update a kanban bucket’s title, WIP limit, or position. Fetches the bucket first and merges, so fields you omit are preserved.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        viewId: { type: 'integer', description: 'The kanban view ID' },
        bucketId: {
          type: 'integer',
          description: 'The ID of the bucket to update',
        },
        title: { type: 'string' },
        limit: { type: 'integer', minimum: 0 },
        position: { type: 'number' },
      },
      required: ['projectId', 'viewId', 'bucketId'],
    },
  },
  {
    name: 'delete_bucket',
    description:
      'Delete a kanban bucket. Tasks in it are not deleted; they fall back to the view’s default bucket. Cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        viewId: { type: 'integer', description: 'The kanban view ID' },
        bucketId: {
          type: 'integer',
          description: 'The ID of the bucket to delete',
        },
      },
      required: ['projectId', 'viewId', 'bucketId'],
    },
  },
  {
    name: 'move_task_to_bucket',
    description:
      'Move a task into a kanban bucket within a specific project view. This is the correct way to move a task between columns — do NOT use update_task with bucket_id, which is ambiguous across views. Moving a task into the view’s done_bucket_id marks it done.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        viewId: { type: 'integer', description: 'The kanban view ID' },
        bucketId: {
          type: 'integer',
          description: 'The destination bucket ID',
        },
        taskId: { type: 'integer', description: 'The ID of the task to move' },
      },
      required: ['projectId', 'viewId', 'bucketId', 'taskId'],
    },
  },
  {
    name: 'create_view',
    description:
      'Create a new view on a project. view_kind is one of list/gantt/table/kanban — only a kanban view owns buckets. For a kanban view you usually then create buckets and set default_bucket_id/done_bucket_id via update_view.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        title: { type: 'string', description: 'View title' },
        view_kind: {
          type: 'string',
          enum: ['list', 'gantt', 'table', 'kanban'],
          description: 'The kind of view',
        },
        position: {
          type: 'number',
          description: 'Sort position among the project’s views (optional)',
        },
        bucket_configuration_mode: {
          type: 'string',
          enum: ['none', 'manual', 'filter'],
          description:
            'Kanban bucket mode. "manual" = user-managed columns; "filter" = columns defined by bucket_configuration filters.',
        },
        filter: {
          type: 'object',
          description:
            'TaskCollection filter object, e.g. { "filter": "done = false" }. Optional.',
        },
      },
      required: ['projectId', 'title', 'view_kind'],
    },
  },
  {
    name: 'update_view',
    description:
      'Update a view (title, position, filter, or kanban bucket settings: bucket_configuration_mode, default_bucket_id, done_bucket_id). Fetches the view first and merges, so omitted fields — including the existing filter and bucket config — are preserved.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        viewId: {
          type: 'integer',
          description: 'The ID of the view to update',
        },
        title: { type: 'string' },
        view_kind: {
          type: 'string',
          enum: ['list', 'gantt', 'table', 'kanban'],
        },
        position: { type: 'number' },
        bucket_configuration_mode: {
          type: 'string',
          enum: ['none', 'manual', 'filter'],
        },
        default_bucket_id: {
          type: 'integer',
          description: 'Bucket where new tasks land',
        },
        done_bucket_id: {
          type: 'integer',
          description: 'Tasks moved here are marked done',
        },
        filter: {
          type: 'object',
          description: 'TaskCollection filter object, e.g. { "filter": "..." }',
        },
      },
      required: ['projectId', 'viewId'],
    },
  },
  {
    name: 'delete_view',
    description:
      'Delete a view from a project. Destructive — for a kanban view this drops its buckets. Cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        viewId: {
          type: 'integer',
          description: 'The ID of the view to delete',
        },
      },
      required: ['projectId', 'viewId'],
    },
  },
];

const requireInts = (
  args: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const k of keys) {
    if (typeof args[k] !== 'number') return `${k} must be a number`;
  }
  return null;
};

export const handlers: Record<string, ToolHandler> = {
  list_project_views: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, ['projectId']);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    const response = await listProjectViews(args.projectId as number);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error fetching views for project ${args.projectId}: ${response.error}`,
          },
        ],
      };
    }
    const views = (response.data ?? []).map(v =>
      slimView(v as unknown as Record<string, unknown>),
    );
    return {
      content: [
        { type: 'text', text: `Found ${views.length} view(s)` },
        { type: 'text', text: JSON.stringify(views, null, 2) },
      ],
    };
  },

  list_buckets: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, ['projectId', 'viewId']);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    const projectId = args.projectId as number;
    const viewId = args.viewId as number;
    // The /buckets endpoint gives us title/limit/position but a broken count;
    // the board endpoint gives us the real per-bucket task count. Fetch both and
    // backfill count by bucket id.
    const [response, board] = await Promise.all([
      listBuckets(projectId, viewId),
      listViewTasks(projectId, viewId),
    ]);
    if (response.isError) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Error fetching buckets: ${response.error}` },
        ],
      };
    }
    const counts = new Map<number, number>();
    if (!board.isError) {
      for (const b of board.data ?? []) {
        counts.set(b.id, Array.isArray(b.tasks) ? b.tasks.length : 0);
      }
    }
    const buckets = (response.data ?? []).map(b => ({
      ...b,
      count: counts.get(b.id) ?? b.count,
    }));
    return {
      content: [
        { type: 'text', text: `Found ${buckets.length} bucket(s)` },
        { type: 'text', text: JSON.stringify(buckets, null, 2) },
      ],
    };
  },

  get_kanban_board: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, ['projectId', 'viewId']);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    const verbose = args.verbose === true;
    const perPage =
      typeof args.per_page === 'number' ? args.per_page : undefined;

    const response = await listViewTasks(
      args.projectId as number,
      args.viewId as number,
      perPage,
    );
    if (response.isError) {
      // Known Vikunja 2.4.0 server bug: the board endpoint
      // (GET .../buckets/tasks) — the only route that reports which task sits
      // in which bucket — rejects API-token auth with 401, though every other
      // endpoint accepts it. There's no token-accessible alternative for
      // per-bucket task membership, so fall back to the column metadata (which
      // works) and say so, rather than failing outright.
      const meta = await listBuckets(
        args.projectId as number,
        args.viewId as number,
      );
      if (meta.isError) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error fetching kanban board: ${response.error}`,
            },
          ],
        };
      }
      const cols = (meta.data ?? []).map(b => {
        const out: Record<string, unknown> = {};
        for (const k of BOARD_BUCKET_KEEP_KEYS) {
          if (k in b) out[k] = (b as Record<string, unknown>)[k];
        }
        return out;
      });
      return {
        content: [
          {
            type: 'text',
            text: `Board has ${cols.length} column(s). NOTE: task-to-column membership is unavailable — the Vikunja server rejected the board endpoint with API-token auth (a known v2.4.0 bug: ${response.error}). Returning column metadata only; use list_project_tasks to see the tasks.`,
          },
          { type: 'text', text: JSON.stringify(cols, null, 2) },
        ],
      };
    }

    let totalTasks = 0;
    const buckets = (response.data ?? []).map(b => {
      const tasks = Array.isArray(b.tasks) ? b.tasks : [];
      totalTasks += tasks.length;
      const out: Record<string, unknown> = {};
      for (const k of BOARD_BUCKET_KEEP_KEYS) {
        if (k in b) out[k] = (b as Record<string, unknown>)[k];
      }
      out.count = tasks.length;
      out.tasks = slimList(tasks, 'task', verbose);
      return out;
    });

    return {
      content: [
        {
          type: 'text',
          text: `Board has ${buckets.length} bucket(s), ${totalTasks} task(s)`,
        },
        { type: 'text', text: JSON.stringify(buckets, null, 2) },
      ],
    };
  },

  create_bucket: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, ['projectId', 'viewId']);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    try {
      const bucket = BucketInputSchema.parse({
        title: args.title,
        limit: args.limit,
        position: args.position,
      });
      if (!bucket.title) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'title is required' }],
        };
      }
      const response = await createBucket(
        args.projectId as number,
        args.viewId as number,
        bucket,
      );
      if (response.isError) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `Error creating bucket: ${response.error}` },
          ],
        };
      }
      return {
        content: [
          { type: 'text', text: 'Bucket created:' },
          { type: 'text', text: JSON.stringify(response.data, null, 2) },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  },

  update_bucket: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, ['projectId', 'viewId', 'bucketId']);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    try {
      const partial = BucketInputSchema.parse({
        title: args.title,
        limit: args.limit,
        position: args.position,
      });
      const response = await updateBucket(
        args.projectId as number,
        args.viewId as number,
        args.bucketId as number,
        partial,
      );
      if (response.isError) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `Error updating bucket: ${response.error}` },
          ],
        };
      }
      return {
        content: [
          { type: 'text', text: 'Bucket updated:' },
          { type: 'text', text: JSON.stringify(response.data, null, 2) },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  },

  delete_bucket: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, ['projectId', 'viewId', 'bucketId']);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    const response = await deleteBucket(
      args.projectId as number,
      args.viewId as number,
      args.bucketId as number,
    );
    if (response.isError) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Error deleting bucket: ${response.error}` },
        ],
      };
    }
    return {
      content: [{ type: 'text', text: `Bucket ${args.bucketId} deleted` }],
    };
  },

  move_task_to_bucket: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, [
      'projectId',
      'viewId',
      'bucketId',
      'taskId',
    ]);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    const response = await moveTaskToBucket(
      args.projectId as number,
      args.viewId as number,
      args.bucketId as number,
      args.taskId as number,
    );
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error moving task ${args.taskId} to bucket ${args.bucketId}: ${response.error}`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Task ${args.taskId} moved to bucket ${args.bucketId}`,
        },
      ],
    };
  },

  create_view: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, ['projectId']);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    try {
      const view = ViewInputSchema.parse(args);
      if (!view.title || !view.view_kind) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'title and view_kind are required' }],
        };
      }
      const response = await createView(args.projectId as number, view);
      if (response.isError) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `Error creating view: ${response.error}` },
          ],
        };
      }
      return {
        content: [
          { type: 'text', text: 'View created:' },
          {
            type: 'text',
            text: JSON.stringify(
              slimView(response.data as unknown as Record<string, unknown>),
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  },

  update_view: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, ['projectId', 'viewId']);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    try {
      const partial = ViewInputSchema.parse(args);
      const response = await updateView(
        args.projectId as number,
        args.viewId as number,
        partial,
      );
      if (response.isError) {
        return {
          isError: true,
          content: [
            { type: 'text', text: `Error updating view: ${response.error}` },
          ],
        };
      }
      return {
        content: [
          { type: 'text', text: 'View updated:' },
          {
            type: 'text',
            text: JSON.stringify(
              slimView(response.data as unknown as Record<string, unknown>),
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  },

  delete_view: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const err = requireInts(args, ['projectId', 'viewId']);
    if (err) return { isError: true, content: [{ type: 'text', text: err }] };

    const response = await deleteView(
      args.projectId as number,
      args.viewId as number,
    );
    if (response.isError) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Error deleting view: ${response.error}` },
        ],
      };
    }
    return {
      content: [{ type: 'text', text: `View ${args.viewId} deleted` }],
    };
  },
};
