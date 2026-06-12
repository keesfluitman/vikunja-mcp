import {
  serviceInstance,
  wrapRequest,
  slimTask,
  slimList,
  mergeAndPost,
} from './common.js';
import type { ToolHandler } from './common.js';

// Server-managed / endpoint-rejected fields stripped from the merged update
// body. Vikunja's POST /tasks/{id} would otherwise either ignore these or
// reject with "Invalid model" — labels/assignees/attachments live on their own
// nested endpoints and reactions/related_tasks/created_by are read-only.
const TASK_UPDATE_STRIP_KEYS = [
  'created',
  'updated',
  'done_at',
  'created_by',
  'reactions',
  'related_tasks',
  'attachments',
  'cover_image_attachment_id',
  'index',
  'subscription',
] as const;
import { z } from 'zod';
import {
  DateTimeSchema,
  HexColorSchema,
  IdentifierSchema,
  User,
  RelationKindSchema,
  RelationKind,
} from './schema.js';

// Input schema for create/update — all fields optional except title (on create)
const TaskInputSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  done: z.boolean().optional(),
  due_date: DateTimeSchema,
  end_date: DateTimeSchema,
  start_date: DateTimeSchema,
  hex_color: HexColorSchema,
  identifier: IdentifierSchema.optional(),
  is_favorite: z.boolean().optional(),
  percent_done: z.number().min(0).max(100).optional(),
  priority: z.number().int().optional(),
  bucket_id: z.number().int().optional(),
  position: z.number().optional(),
  repeat_after: z.number().optional(),
  repeat_mode: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  assignees: z.array(z.object({ id: z.number() })).optional(),
  labels: z.array(z.object({ id: z.number() })).optional(),
  reminders: z.array(z.unknown()).optional(),
});

export type TaskInput = z.infer<typeof TaskInputSchema>;

export type Task = TaskInput & {
  id: number;
  project_id: number;
  index: number;
  identifier: string;
  bucket_id: number;
  cover_image_attachment_id: number;
  created: string;
  updated: string;
  done_at: string;
  created_by: User;
  related_tasks: Record<string, unknown>;
  attachments: Array<unknown>;
  reactions: Record<string, unknown> | null;
};

// Vikunja query params shared by /tasks and /projects/{id}/tasks.
// See https://vikunja.io/docs/filters for the filter DSL.
export type TaskListParams = {
  page?: number;
  per_page?: number;
  s?: string;
  filter?: string;
  sort_by?: string | string[];
  order_by?: 'asc' | 'desc' | Array<'asc' | 'desc'>;
  filter_include_nulls?: boolean;
  filter_timezone?: string;
  expand?: 'subtasks';
};

// Sensible defaults for LLM workflows: open tasks, most recently updated first.
// Caller can override by passing any of these keys explicitly (including `filter: ''`
// to disable the done filter). per_page is capped at 50 server-side.
const applyTaskListDefaults = (p: TaskListParams): Record<string, unknown> => {
  const params: Record<string, unknown> = {
    page: p.page ?? 1,
    per_page: Math.min(p.per_page ?? 50, 50),
  };
  // Only inject defaults when the caller did not pass the key at all. An
  // explicit empty string for filter means "no filter" and is respected.
  params.filter = p.filter !== undefined ? p.filter : 'done = false';
  params.sort_by = p.sort_by ?? 'updated';
  params.order_by = p.order_by ?? 'desc';
  if (p.s !== undefined) params.s = p.s;
  if (p.filter_include_nulls !== undefined)
    params.filter_include_nulls = p.filter_include_nulls;
  if (p.filter_timezone !== undefined)
    params.filter_timezone = p.filter_timezone;
  if (p.expand !== undefined) params.expand = p.expand;
  return params;
};

const listAllTasks = async (params: TaskListParams = {}) =>
  wrapRequest(
    serviceInstance.get<Array<Task>>('/tasks', {
      params: applyTaskListDefaults(params),
    }),
  );

const listProjectTasks = async (
  projectId: number,
  params: TaskListParams = {},
) =>
  wrapRequest(
    serviceInstance.get<Array<Task>>(`/projects/${projectId}/tasks`, {
      params: applyTaskListDefaults(params),
    }),
  );

const getTask = async (taskId: number) =>
  wrapRequest(serviceInstance.get<Task>(`/tasks/${taskId}`));

const createTask = async (projectId: number, task: TaskInput) =>
  wrapRequest(serviceInstance.put<Task>(`/projects/${projectId}/tasks`, task));

const updateTask = async (taskId: number, task: Partial<TaskInput>) =>
  mergeAndPost<Task>(
    `/tasks/${taskId}`,
    task as Record<string, unknown>,
    TASK_UPDATE_STRIP_KEYS,
  );

const deleteTask = async (taskId: number) =>
  wrapRequest(serviceInstance.delete(`/tasks/${taskId}`));

// Move a task to a different project. Vikunja moves a task by POSTing it with a
// changed project_id; we route through mergeAndPost so the rest of the task
// (title, labels, dates, etc.) survives the full-replace POST. Kept as a
// dedicated tool rather than a project_id field on update_task so the LLM can't
// relocate a task by accident while editing other fields.
const moveTask = async (taskId: number, projectId: number) =>
  mergeAndPost<Task>(
    `/tasks/${taskId}`,
    { project_id: projectId },
    TASK_UPDATE_STRIP_KEYS,
  );

const createRelation = async (
  taskId: number,
  otherTaskId: number,
  relationKind: RelationKind,
) =>
  wrapRequest(
    serviceInstance.put(`/tasks/${taskId}/relations`, {
      task_id: taskId,
      other_task_id: otherTaskId,
      relation_kind: relationKind,
    }),
  );

const deleteRelation = async (
  taskId: number,
  kind: RelationKind,
  otherTaskId: number,
) =>
  wrapRequest(
    serviceInstance.delete(`/tasks/${taskId}/relations/${kind}/${otherTaskId}`),
  );

const getTaskComments = async (taskId: number) =>
  wrapRequest(serviceInstance.get(`/tasks/${taskId}/comments`));

const createTaskComment = async (taskId: number, comment: string) =>
  wrapRequest(serviceInstance.put(`/tasks/${taskId}/comments`, { comment }));

const updateTaskComment = async (
  taskId: number,
  commentId: number,
  comment: string,
) =>
  wrapRequest(
    serviceInstance.post(`/tasks/${taskId}/comments/${commentId}`, { comment }),
  );

const deleteTaskComment = async (taskId: number, commentId: number) =>
  wrapRequest(serviceInstance.delete(`/tasks/${taskId}/comments/${commentId}`));

const listTaskAttachments = async (taskId: number) =>
  wrapRequest(serviceInstance.get(`/tasks/${taskId}/attachments`));

const getTaskAttachment = async (taskId: number, attachmentId: number) =>
  wrapRequest(
    serviceInstance.get(`/tasks/${taskId}/attachments/${attachmentId}`),
  );

const deleteTaskAttachment = async (taskId: number, attachmentId: number) =>
  wrapRequest(
    serviceInstance.delete(`/tasks/${taskId}/attachments/${attachmentId}`),
  );

// Assignees and labels each have dedicated attach/detach endpoints. Prefer
// these over update_task's full-replace `assignees`/`labels` arrays: adding one
// assignee shouldn't require re-sending (and risking clobbering) the rest.
// Vikunja's verb convention: PUT to add, DELETE to remove. Not full-replace, so
// no mergeAndPost needed.
const addTaskAssignee = async (taskId: number, userId: number) =>
  wrapRequest(
    serviceInstance.put(`/tasks/${taskId}/assignees`, { user_id: userId }),
  );

const removeTaskAssignee = async (taskId: number, userId: number) =>
  wrapRequest(serviceInstance.delete(`/tasks/${taskId}/assignees/${userId}`));

const addTaskLabel = async (taskId: number, labelId: number) =>
  wrapRequest(
    serviceInstance.put(`/tasks/${taskId}/labels`, { label_id: labelId }),
  );

const removeTaskLabel = async (taskId: number, labelId: number) =>
  wrapRequest(serviceInstance.delete(`/tasks/${taskId}/labels/${labelId}`));

export default {
  listAllTasks,
  listProjectTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  createRelation,
  deleteRelation,
  getTaskComments,
  createTaskComment,
  updateTaskComment,
  deleteTaskComment,
  listTaskAttachments,
  getTaskAttachment,
  deleteTaskAttachment,
  addTaskAssignee,
  removeTaskAssignee,
  addTaskLabel,
  removeTaskLabel,
};

export const toolDefinitions = [
  {
    name: 'list_all_tasks',
    description:
      'List tasks across all projects. Defaults to open tasks (done=false) sorted by most recently updated. Pass filter="" to disable the open-only default. Filter DSL: see https://vikunja.io/docs/filters — examples: "done = false", "due_date < now+7d", "priority >= 3", "labels in 1,2", "project = 20".',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Page number (default: 1)' },
        per_page: {
          type: 'integer',
          description: 'Results per page, max 50 (default: 50)',
        },
        s: {
          type: 'string',
          description: 'Free-text search across task title/description',
        },
        filter: {
          type: 'string',
          description:
            'Vikunja filter expression. Default: "done = false". Pass "" to remove the default and return all tasks.',
        },
        sort_by: {
          type: 'string',
          description:
            'Sort field. Default: "updated". Common values: id, title, done, done_at, due_date, created, updated, priority, position.',
        },
        order_by: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction (default: "desc")',
        },
        filter_include_nulls: {
          type: 'boolean',
          description: 'Include tasks where the filtered field is null',
        },
        filter_timezone: {
          type: 'string',
          description:
            'IANA timezone for date math in filter (e.g. "Europe/Berlin")',
        },
        expand: {
          type: 'string',
          enum: ['subtasks'],
          description:
            'If "subtasks", returns top-level tasks plus all their subtasks',
        },
        verbose: {
          type: 'boolean',
          description:
            'Return full task objects including reactions, attachments, created_by, related_tasks. Default false (slimmed payload).',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_project_tasks',
    description:
      'List tasks in a specific project. Same filter/sort/search semantics as list_all_tasks. Defaults to open tasks (done=false) sorted by most recently updated.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        page: { type: 'integer', description: 'Page number (default: 1)' },
        per_page: {
          type: 'integer',
          description: 'Results per page, max 50 (default: 50)',
        },
        s: { type: 'string', description: 'Free-text search' },
        filter: {
          type: 'string',
          description:
            'Vikunja filter expression. Default: "done = false". Pass "" to disable.',
        },
        sort_by: {
          type: 'string',
          description: 'Sort field. Default: "updated"',
        },
        order_by: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Default: "desc"',
        },
        filter_include_nulls: { type: 'boolean' },
        filter_timezone: { type: 'string' },
        expand: { type: 'string', enum: ['subtasks'] },
        verbose: {
          type: 'boolean',
          description: 'Return full task objects. Default false (slimmed).',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_task',
    description:
      'Get a specific task by ID. Returns slimmed payload by default; pass verbose=true for full object.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        verbose: {
          type: 'boolean',
          description: 'Return full task object. Default false.',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'create_task',
    description:
      'Create a new task in a project. Note: priority defaults to 0 (none) if not specified — set explicitly if you want low/medium/high/urgent (1–4).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: 'The ID of the project' },
        task: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            done: { type: 'boolean' },
            due_date: { type: 'string', format: 'date-time' },
            start_date: { type: 'string', format: 'date-time' },
            end_date: { type: 'string', format: 'date-time' },
            hex_color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
            is_favorite: { type: 'boolean' },
            percent_done: { type: 'integer', minimum: 0, maximum: 100 },
            priority: { type: 'integer' },
            bucket_id: { type: 'integer' },
            repeat_after: { type: 'integer' },
            repeat_mode: { type: 'integer', enum: [0, 1, 2] },
            assignees: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'integer' } },
                required: ['id'],
              },
              description: 'List of assignees by user ID',
            },
            labels: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'integer' } },
                required: ['id'],
              },
              description: 'List of labels by label ID',
            },
            reminders: { type: 'array', items: { type: 'object' } },
          },
          required: ['title'],
        },
      },
      required: ['projectId', 'task'],
    },
  },
  {
    name: 'update_task',
    description:
      'Update an existing task by ID. WARNING: this is a full REPLACE, not a PATCH — any field omitted from taskUpdates is reset to its zero value (priority → 0, done → false, description → empty). To preserve fields, either include them all in taskUpdates, or call get_task first and merge. Known quirk: done_at may also reset to 0001-01-01 on subsequent updates even when done:true is sent correctly (server-side timestamp bug, unrelated).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        taskUpdates: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            done: { type: 'boolean' },
            due_date: { type: 'string', format: 'date-time' },
            start_date: { type: 'string', format: 'date-time' },
            end_date: { type: 'string', format: 'date-time' },
            hex_color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
            is_favorite: { type: 'boolean' },
            percent_done: { type: 'integer', minimum: 0, maximum: 100 },
            priority: { type: 'integer' },
            bucket_id: { type: 'integer' },
            repeat_after: { type: 'integer' },
            repeat_mode: { type: 'integer', enum: [0, 1, 2] },
            assignees: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'integer' } },
                required: ['id'],
              },
            },
            labels: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'integer' } },
                required: ['id'],
              },
            },
            reminders: { type: 'array', items: { type: 'object' } },
          },
        },
      },
      required: ['taskId', 'taskUpdates'],
    },
  },
  {
    name: 'delete_task',
    description:
      'Delete a specific task by ID. This action cannot be undone, so use with caution.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'move_task',
    description:
      'Move a task to a different project. Preserves the task’s other fields. Use this for cross-project moves; for moving between kanban columns within a project, use move_task_to_bucket instead.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task to move' },
        projectId: {
          type: 'integer',
          description: 'The ID of the destination project',
        },
      },
      required: ['taskId', 'projectId'],
    },
  },
  {
    name: 'create_relation',
    description: 'Create a relation between two tasks',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        otherTaskId: {
          type: 'integer',
          description: 'The ID of the other task',
        },
        relationKind: {
          type: 'string',
          enum: [
            'unknown',
            'subtask',
            'parenttask',
            'related',
            'duplicateof',
            'duplicates',
            'blocking',
            'blocked',
            'precedes',
            'follows',
            'copiedfrom',
            'copiedto',
          ],
        },
      },
      required: ['taskId', 'otherTaskId', 'relationKind'],
    },
  },
  {
    name: 'delete_relation',
    description: 'Delete a relation between two tasks',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        kind: {
          type: 'string',
          enum: [
            'unknown',
            'subtask',
            'parenttask',
            'related',
            'duplicateof',
            'duplicates',
            'blocking',
            'blocked',
            'precedes',
            'follows',
            'copiedfrom',
            'copiedto',
          ],
        },
        otherTaskId: {
          type: 'integer',
          description: 'The ID of the other task',
        },
      },
      required: ['taskId', 'kind', 'otherTaskId'],
    },
  },
  {
    name: 'get_task_comments',
    description: 'Get the comments for a specific task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'create_task_comment',
    description: 'Create a comment for a specific task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        comment: { type: 'string', description: 'The comment to create' },
      },
      required: ['taskId', 'comment'],
    },
  },
  {
    name: 'update_task_comment',
    description: 'Update a comment for a specific task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        commentId: { type: 'integer', description: 'The ID of the comment' },
        comment: { type: 'string', description: 'The comment to update' },
      },
      required: ['taskId', 'commentId', 'comment'],
    },
  },
  {
    name: 'delete_task_comment',
    description: 'Delete a comment for a specific task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        commentId: { type: 'integer', description: 'The ID of the comment' },
      },
      required: ['taskId', 'commentId'],
    },
  },
  {
    name: 'list_task_attachments',
    description: 'List all attachments for a specific task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'get_task_attachment',
    description: 'Get a specific attachment for a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        attachmentId: {
          type: 'integer',
          description: 'The ID of the attachment',
        },
      },
      required: ['taskId', 'attachmentId'],
    },
  },
  {
    name: 'delete_task_attachment',
    description: 'Delete a specific attachment for a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        attachmentId: {
          type: 'integer',
          description: 'The ID of the attachment',
        },
      },
      required: ['taskId', 'attachmentId'],
    },
  },
  {
    name: 'add_task_assignee',
    description:
      'Assign a user to a task. Prefer this over update_task for adding an assignee — it touches only the assignee list and leaves the rest of the task untouched. Resolve the userId via search_users first.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        userId: {
          type: 'integer',
          description: 'The ID of the user to assign (from search_users)',
        },
      },
      required: ['taskId', 'userId'],
    },
  },
  {
    name: 'remove_task_assignee',
    description: 'Unassign a user from a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        userId: {
          type: 'integer',
          description: 'The ID of the user to unassign',
        },
      },
      required: ['taskId', 'userId'],
    },
  },
  {
    name: 'add_task_label',
    description:
      'Attach a label to a task. Prefer this over update_task for adding a label — it touches only the label list and leaves the rest of the task untouched. Resolve the labelId via list_labels first.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        labelId: {
          type: 'integer',
          description: 'The ID of the label to attach (from list_labels)',
        },
      },
      required: ['taskId', 'labelId'],
    },
  },
  {
    name: 'remove_task_label',
    description: 'Detach a label from a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: 'The ID of the task' },
        labelId: {
          type: 'integer',
          description: 'The ID of the label to detach',
        },
      },
      required: ['taskId', 'labelId'],
    },
  },
];

// Pluck the Vikunja list-query params from a tool-call args object. Drops
// projectId and verbose (handler-only concerns) and ignores wrong types.
const extractListParams = (args: Record<string, unknown>): TaskListParams => {
  const out: TaskListParams = {};
  if (typeof args.page === 'number') out.page = args.page;
  if (typeof args.per_page === 'number') out.per_page = args.per_page;
  if (typeof args.s === 'string') out.s = args.s;
  if (typeof args.filter === 'string') out.filter = args.filter;
  if (typeof args.sort_by === 'string' || Array.isArray(args.sort_by))
    out.sort_by = args.sort_by as string | string[];
  if (args.order_by === 'asc' || args.order_by === 'desc')
    out.order_by = args.order_by;
  if (typeof args.filter_include_nulls === 'boolean')
    out.filter_include_nulls = args.filter_include_nulls;
  if (typeof args.filter_timezone === 'string')
    out.filter_timezone = args.filter_timezone;
  if (args.expand === 'subtasks') out.expand = 'subtasks';
  return out;
};

export const handlers: Record<string, ToolHandler> = {
  list_all_tasks: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const verbose = args.verbose === true;
    const response = await listAllTasks(extractListParams(args));

    if (response.isError) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Error retrieving tasks: ${response.error}` },
        ],
      };
    }

    const tasks = response.data || [];
    if (tasks.length === 0) {
      return { content: [{ type: 'text', text: 'No tasks found' }] };
    }

    const out = slimList(
      tasks as unknown as Array<Record<string, unknown>>,
      'task',
      verbose,
    );
    return {
      content: [
        { type: 'text', text: `Found ${tasks.length} task(s)` },
        { type: 'text', text: JSON.stringify(out, null, 2) },
      ],
    };
  },

  list_project_tasks: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const projectId = args.projectId;
    const verbose = args.verbose === true;
    if (typeof projectId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid project ID' }],
      };
    }

    const response = await listProjectTasks(projectId, extractListParams(args));
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error retrieving tasks for project ID ${projectId}: ${response.error}`,
          },
        ],
      };
    }

    const tasks = response.data || [];
    if (tasks.length === 0) {
      return {
        content: [
          { type: 'text', text: `No tasks found for project ID ${projectId}` },
        ],
      };
    }

    const out = slimList(
      tasks as unknown as Array<Record<string, unknown>>,
      'task',
      verbose,
    );
    return {
      content: [
        {
          type: 'text',
          text: `Found ${tasks.length} task(s) for project ID ${projectId}`,
        },
        { type: 'text', text: JSON.stringify(out, null, 2) },
      ],
    };
  },

  get_task: async request => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const taskId = args.taskId;
    const verbose = args.verbose === true;
    if (typeof taskId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID' }],
      };
    }

    const response = await getTask(taskId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error retrieving task ID ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    const out = slimTask(
      (response.data ?? {}) as unknown as Record<string, unknown>,
      verbose,
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
    };
  },

  create_task: async request => {
    const { projectId, task: _task } = request.params.arguments || {};

    if (typeof projectId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid project ID' }],
      };
    }

    try {
      const validatedTask = TaskInputSchema.parse(_task);
      const response = await createTask(projectId, validatedTask);

      if (response.isError) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error creating task in project ID ${projectId}: ${response.error}`,
            },
          ],
        };
      }

      return {
        content: [
          { type: 'text', text: 'Task created successfully:' },
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

  update_task: async request => {
    const { taskId, taskUpdates } = request.params.arguments || {};

    if (typeof taskId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID' }],
      };
    }

    if (!taskUpdates || typeof taskUpdates !== 'object') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'No update data provided' }],
      };
    }

    try {
      const validatedUpdates = TaskInputSchema.partial().parse(taskUpdates);
      const response = await updateTask(taskId, validatedUpdates);

      if (response.isError) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error updating task ID ${taskId}: ${response.error}`,
            },
          ],
        };
      }

      return {
        content: [
          { type: 'text', text: 'Task updated successfully:' },
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

  delete_task: async request => {
    const taskId = request.params.arguments?.taskId;
    if (typeof taskId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID' }],
      };
    }

    const response = await deleteTask(taskId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error deleting task ID ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  move_task: async request => {
    const { taskId, projectId } = request.params.arguments || {};
    if (typeof taskId !== 'number' || typeof projectId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or project ID' }],
      };
    }

    const response = await moveTask(taskId, projectId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error moving task ID ${taskId} to project ID ${projectId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        { type: 'text', text: `Task ${taskId} moved to project ${projectId}:` },
        { type: 'text', text: JSON.stringify(response.data, null, 2) },
      ],
    };
  },

  create_relation: async request => {
    const { taskId, otherTaskId, relationKind } =
      request.params.arguments || {};

    if (typeof taskId !== 'number' || typeof otherTaskId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or other task ID' }],
      };
    }

    if (!RelationKindSchema.safeParse(relationKind).success) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid relation kind' }],
      };
    }

    const response = await createRelation(
      taskId,
      otherTaskId,
      relationKind as RelationKind,
    );
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error creating relation between task ID ${taskId} and other task ID ${otherTaskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  delete_relation: async request => {
    const { taskId, kind, otherTaskId } = request.params.arguments || {};

    if (typeof taskId !== 'number' || typeof otherTaskId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or other task ID' }],
      };
    }

    if (!RelationKindSchema.safeParse(kind).success) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid relation kind' }],
      };
    }

    const response = await deleteRelation(
      taskId,
      kind as RelationKind,
      otherTaskId,
    );
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error deleting relation between task ID ${taskId} and other task ID ${otherTaskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  get_task_comments: async request => {
    const taskId = request.params.arguments?.taskId;
    if (typeof taskId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID' }],
      };
    }

    const response = await getTaskComments(taskId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error retrieving comments for task ID ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  create_task_comment: async request => {
    const { taskId, comment } = request.params.arguments || {};
    if (typeof taskId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID' }],
      };
    }

    const response = await createTaskComment(taskId, comment as string);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error creating comment for task ID ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  update_task_comment: async request => {
    const { taskId, commentId, comment } = request.params.arguments || {};
    if (typeof taskId !== 'number' || typeof commentId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or comment ID' }],
      };
    }

    const response = await updateTaskComment(
      taskId,
      commentId,
      comment as string,
    );
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error updating comment for task ID ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  delete_task_comment: async request => {
    const { taskId, commentId } = request.params.arguments || {};
    if (typeof taskId !== 'number' || typeof commentId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or comment ID' }],
      };
    }

    const response = await deleteTaskComment(taskId, commentId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error deleting comment for task ID ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  list_task_attachments: async request => {
    const taskId = request.params.arguments?.taskId;
    if (typeof taskId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID' }],
      };
    }

    const response = await listTaskAttachments(taskId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error retrieving attachments for task ID ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  get_task_attachment: async request => {
    const { taskId, attachmentId } = request.params.arguments || {};
    if (typeof taskId !== 'number' || typeof attachmentId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or attachment ID' }],
      };
    }

    const response = await getTaskAttachment(taskId, attachmentId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error retrieving attachment for task ID ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  delete_task_attachment: async request => {
    const { taskId, attachmentId } = request.params.arguments || {};
    if (typeof taskId !== 'number' || typeof attachmentId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or attachment ID' }],
      };
    }

    const response = await deleteTaskAttachment(taskId, attachmentId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error deleting attachment for task ID ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
    };
  },

  add_task_assignee: async request => {
    const { taskId, userId } = request.params.arguments || {};
    if (typeof taskId !== 'number' || typeof userId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or user ID' }],
      };
    }

    const response = await addTaskAssignee(taskId, userId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error assigning user ${userId} to task ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        { type: 'text', text: `User ${userId} assigned to task ${taskId}` },
      ],
    };
  },

  remove_task_assignee: async request => {
    const { taskId, userId } = request.params.arguments || {};
    if (typeof taskId !== 'number' || typeof userId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or user ID' }],
      };
    }

    const response = await removeTaskAssignee(taskId, userId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error unassigning user ${userId} from task ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        { type: 'text', text: `User ${userId} unassigned from task ${taskId}` },
      ],
    };
  },

  add_task_label: async request => {
    const { taskId, labelId } = request.params.arguments || {};
    if (typeof taskId !== 'number' || typeof labelId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or label ID' }],
      };
    }

    const response = await addTaskLabel(taskId, labelId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error attaching label ${labelId} to task ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        { type: 'text', text: `Label ${labelId} attached to task ${taskId}` },
      ],
    };
  },

  remove_task_label: async request => {
    const { taskId, labelId } = request.params.arguments || {};
    if (typeof taskId !== 'number' || typeof labelId !== 'number') {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid task ID or label ID' }],
      };
    }

    const response = await removeTaskLabel(taskId, labelId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error detaching label ${labelId} from task ${taskId}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        { type: 'text', text: `Label ${labelId} detached from task ${taskId}` },
      ],
    };
  },
};
