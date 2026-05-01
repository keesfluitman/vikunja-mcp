import { serviceInstance, wrapRequest, slimTask, slimList } from './common.js';
import { z } from 'zod';
import { DateTimeSchema, HexColorSchema, IdentifierSchema, RelationKindSchema, } from './schema.js';
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
// Sensible defaults for LLM workflows: open tasks, most recently updated first.
// Caller can override by passing any of these keys explicitly (including `filter: ''`
// to disable the done filter). per_page is capped at 50 server-side.
const applyTaskListDefaults = (p) => {
    const params = {
        page: p.page ?? 1,
        per_page: Math.min(p.per_page ?? 50, 50),
    };
    // Only inject defaults when the caller did not pass the key at all. An
    // explicit empty string for filter means "no filter" and is respected.
    params.filter = p.filter !== undefined ? p.filter : 'done = false';
    params.sort_by = p.sort_by ?? 'updated';
    params.order_by = p.order_by ?? 'desc';
    if (p.s !== undefined)
        params.s = p.s;
    if (p.filter_include_nulls !== undefined)
        params.filter_include_nulls = p.filter_include_nulls;
    if (p.filter_timezone !== undefined)
        params.filter_timezone = p.filter_timezone;
    if (p.expand !== undefined)
        params.expand = p.expand;
    return params;
};
const listAllTasks = async (params = {}) => wrapRequest(serviceInstance.get('/tasks', {
    params: applyTaskListDefaults(params),
}));
const listProjectTasks = async (projectId, params = {}) => wrapRequest(serviceInstance.get(`/projects/${projectId}/tasks`, {
    params: applyTaskListDefaults(params),
}));
const getTask = async (taskId) => wrapRequest(serviceInstance.get(`/tasks/${taskId}`));
const createTask = async (projectId, task) => wrapRequest(serviceInstance.put(`/projects/${projectId}/tasks`, task));
const updateTask = async (taskId, task) => wrapRequest(serviceInstance.post(`/tasks/${taskId}`, task));
const deleteTask = async (taskId) => wrapRequest(serviceInstance.delete(`/tasks/${taskId}`));
const createRelation = async (taskId, otherTaskId, relationKind) => wrapRequest(serviceInstance.put(`/tasks/${taskId}/relations`, {
    task_id: taskId,
    other_task_id: otherTaskId,
    relation_kind: relationKind,
}));
const deleteRelation = async (taskId, kind, otherTaskId) => wrapRequest(serviceInstance.delete(`/tasks/${taskId}/relations/${kind}/${otherTaskId}`));
const getTaskComments = async (taskId) => wrapRequest(serviceInstance.get(`/tasks/${taskId}/comments`));
const createTaskComment = async (taskId, comment) => wrapRequest(serviceInstance.put(`/tasks/${taskId}/comments`, { comment }));
const updateTaskComment = async (taskId, commentId, comment) => wrapRequest(serviceInstance.post(`/tasks/${taskId}/comments/${commentId}`, { comment }));
const deleteTaskComment = async (taskId, commentId) => wrapRequest(serviceInstance.delete(`/tasks/${taskId}/comments/${commentId}`));
const listTaskAttachments = async (taskId) => wrapRequest(serviceInstance.get(`/tasks/${taskId}/attachments`));
const getTaskAttachment = async (taskId, attachmentId) => wrapRequest(serviceInstance.get(`/tasks/${taskId}/attachments/${attachmentId}`));
const deleteTaskAttachment = async (taskId, attachmentId) => wrapRequest(serviceInstance.delete(`/tasks/${taskId}/attachments/${attachmentId}`));
export default {
    listAllTasks,
    listProjectTasks,
    getTask,
    createTask,
    updateTask,
    deleteTask,
    createRelation,
    deleteRelation,
    getTaskComments,
    createTaskComment,
    updateTaskComment,
    deleteTaskComment,
    listTaskAttachments,
    getTaskAttachment,
    deleteTaskAttachment,
};
export const toolDefinitions = [
    {
        name: 'list_all_tasks',
        description: 'List tasks across all projects. Defaults to open tasks (done=false) sorted by most recently updated. Pass filter="" to disable the open-only default. Filter DSL: see https://vikunja.io/docs/filters — examples: "done = false", "due_date < now+7d", "priority >= 3", "labels in 1,2", "project = 20".',
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'integer', description: 'Page number (default: 1)' },
                per_page: {
                    type: 'integer',
                    description: 'Results per page, max 50 (default: 50)',
                },
                s: { type: 'string', description: 'Free-text search across task title/description' },
                filter: {
                    type: 'string',
                    description: 'Vikunja filter expression. Default: "done = false". Pass "" to remove the default and return all tasks.',
                },
                sort_by: {
                    type: 'string',
                    description: 'Sort field. Default: "updated". Common values: id, title, done, done_at, due_date, created, updated, priority, position.',
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
                    description: 'IANA timezone for date math in filter (e.g. "Europe/Berlin")',
                },
                expand: {
                    type: 'string',
                    enum: ['subtasks'],
                    description: 'If "subtasks", returns top-level tasks plus all their subtasks',
                },
                verbose: {
                    type: 'boolean',
                    description: 'Return full task objects including reactions, attachments, created_by, related_tasks. Default false (slimmed payload).',
                },
            },
            required: [],
        },
    },
    {
        name: 'list_project_tasks',
        description: 'List tasks in a specific project. Same filter/sort/search semantics as list_all_tasks. Defaults to open tasks (done=false) sorted by most recently updated.',
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
                    description: 'Vikunja filter expression. Default: "done = false". Pass "" to disable.',
                },
                sort_by: { type: 'string', description: 'Sort field. Default: "updated"' },
                order_by: { type: 'string', enum: ['asc', 'desc'], description: 'Default: "desc"' },
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
        description: 'Get a specific task by ID. Returns slimmed payload by default; pass verbose=true for full object.',
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
        description: 'Create a new task in a project',
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
        description: 'Update an existing task by ID',
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
        description: 'Delete a specific task by ID. This action cannot be undone, so use with caution.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'integer', description: 'The ID of the task' },
            },
            required: ['taskId'],
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
];
// Pluck the Vikunja list-query params from a tool-call args object. Drops
// projectId and verbose (handler-only concerns) and ignores wrong types.
const extractListParams = (args) => {
    const out = {};
    if (typeof args.page === 'number')
        out.page = args.page;
    if (typeof args.per_page === 'number')
        out.per_page = args.per_page;
    if (typeof args.s === 'string')
        out.s = args.s;
    if (typeof args.filter === 'string')
        out.filter = args.filter;
    if (typeof args.sort_by === 'string' || Array.isArray(args.sort_by))
        out.sort_by = args.sort_by;
    if (args.order_by === 'asc' || args.order_by === 'desc')
        out.order_by = args.order_by;
    if (typeof args.filter_include_nulls === 'boolean')
        out.filter_include_nulls = args.filter_include_nulls;
    if (typeof args.filter_timezone === 'string')
        out.filter_timezone = args.filter_timezone;
    if (args.expand === 'subtasks')
        out.expand = 'subtasks';
    return out;
};
export const handlers = {
    list_all_tasks: async (request) => {
        const args = (request.params.arguments || {});
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
        const out = slimList(tasks, 'task', verbose);
        return {
            content: [
                { type: 'text', text: `Found ${tasks.length} task(s)` },
                { type: 'text', text: JSON.stringify(out, null, 2) },
            ],
        };
    },
    list_project_tasks: async (request) => {
        const args = (request.params.arguments || {});
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
        const out = slimList(tasks, 'task', verbose);
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
    get_task: async (request) => {
        const args = (request.params.arguments || {});
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
        const out = slimTask((response.data ?? {}), verbose);
        return {
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        };
    },
    create_task: async (request) => {
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
        }
        catch (error) {
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
    update_task: async (request) => {
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
        }
        catch (error) {
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
    delete_task: async (request) => {
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
    create_relation: async (request) => {
        const { taskId, otherTaskId, relationKind } = request.params.arguments || {};
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
        const response = await createRelation(taskId, otherTaskId, relationKind);
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
    delete_relation: async (request) => {
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
        const response = await deleteRelation(taskId, kind, otherTaskId);
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
    get_task_comments: async (request) => {
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
    create_task_comment: async (request) => {
        const { taskId, comment } = request.params.arguments || {};
        if (typeof taskId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid task ID' }],
            };
        }
        const response = await createTaskComment(taskId, comment);
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
    update_task_comment: async (request) => {
        const { taskId, commentId, comment } = request.params.arguments || {};
        if (typeof taskId !== 'number' || typeof commentId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid task ID or comment ID' }],
            };
        }
        const response = await updateTaskComment(taskId, commentId, comment);
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
    delete_task_comment: async (request) => {
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
    list_task_attachments: async (request) => {
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
    get_task_attachment: async (request) => {
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
    delete_task_attachment: async (request) => {
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
};
