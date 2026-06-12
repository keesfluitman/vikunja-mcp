import { z } from 'zod';
import { serviceInstance, wrapRequest, mergeAndPost } from './common.js';
const VIEW_KEEP_KEYS = [
    'id',
    'title',
    'project_id',
    'view_kind',
    'position',
    'default_bucket_id',
    'done_bucket_id',
];
const slimView = (view) => {
    const out = {};
    for (const k of VIEW_KEEP_KEYS)
        if (k in view)
            out[k] = view[k];
    return out;
};
const BucketInputSchema = z.object({
    title: z.string().optional(),
    // Per-bucket WIP limit; 0 means no limit.
    limit: z.number().int().min(0).optional(),
    position: z.number().optional(),
});
const listProjectViews = async (projectId) => wrapRequest(serviceInstance.get(`/projects/${projectId}/views`));
const listBuckets = async (projectId, viewId) => wrapRequest(serviceInstance.get(`/projects/${projectId}/views/${viewId}/buckets`));
const createBucket = async (projectId, viewId, bucket) => wrapRequest(serviceInstance.put(`/projects/${projectId}/views/${viewId}/buckets`, bucket));
// POST /projects/{p}/views/{v}/buckets/{b} is full-replace like the other
// Vikunja update endpoints, and there is no GET-single-bucket route — so we
// list the view's buckets, find this one, overlay the caller's partial, and
// POST the merged object. Omitting `position` here would otherwise reset it to
// 0 and silently reorder the board.
const BUCKET_UPDATE_STRIP_KEYS = [
    'created',
    'updated',
    'created_by',
    'count',
    'tasks',
];
const updateBucket = async (projectId, viewId, bucketId, partial) => {
    const current = await listBuckets(projectId, viewId);
    if (current.isError || !current.data)
        return current;
    const existing = current.data.find(b => b.id === bucketId);
    if (!existing) {
        return {
            isError: true,
            error: `Bucket ${bucketId} not found in project ${projectId} view ${viewId}`,
        };
    }
    const merged = { ...existing, ...partial };
    for (const k of BUCKET_UPDATE_STRIP_KEYS)
        delete merged[k];
    return wrapRequest(serviceInstance.post(`/projects/${projectId}/views/${viewId}/buckets/${bucketId}`, merged));
};
const deleteBucket = async (projectId, viewId, bucketId) => wrapRequest(serviceInstance.delete(`/projects/${projectId}/views/${viewId}/buckets/${bucketId}`));
const moveTaskToBucket = async (projectId, viewId, bucketId, taskId) => wrapRequest(serviceInstance.post(`/projects/${projectId}/views/${viewId}/buckets/${bucketId}/tasks`, { task_id: taskId, bucket_id: bucketId, project_view_id: viewId }));
// View CRUD. v1 follows its usual convention here (create = PUT, update = POST)
// — NOT the inverted verbs the v2/Huma API uses. A single-view GET exists, so
// update routes through mergeAndPost to preserve the view's filter object and
// bucket config when the caller only changes one field. `filter` is a
// TaskCollection object ({ filter: "<DSL>", filter_include_nulls, ... }), and
// `bucket_configuration` an array — both passed through as-is.
const VIEW_UPDATE_STRIP_KEYS = ['created', 'updated'];
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
const createView = async (projectId, view) => wrapRequest(serviceInstance.put(`/projects/${projectId}/views`, view));
const updateView = async (projectId, viewId, partial) => mergeAndPost(`/projects/${projectId}/views/${viewId}`, partial, VIEW_UPDATE_STRIP_KEYS);
const deleteView = async (projectId, viewId) => wrapRequest(serviceInstance.delete(`/projects/${projectId}/views/${viewId}`));
export default {
    listProjectViews,
    listBuckets,
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
        description: "List a project's views (list/gantt/table/kanban). Use this to discover the kanban view's id plus its default_bucket_id (where new tasks land) and done_bucket_id (dropping a task here marks it done) before working with buckets.",
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
        description: 'List the kanban buckets (columns) of a project view, including each bucket’s task count and WIP limit. Get the viewId from list_project_views (the view_kind="kanban" entry).',
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
        description: 'Update a kanban bucket’s title, WIP limit, or position. Fetches the bucket first and merges, so fields you omit are preserved.',
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
        description: 'Delete a kanban bucket. Tasks in it are not deleted; they fall back to the view’s default bucket. Cannot be undone.',
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
        description: 'Move a task into a kanban bucket within a specific project view. This is the correct way to move a task between columns — do NOT use update_task with bucket_id, which is ambiguous across views. Moving a task into the view’s done_bucket_id marks it done.',
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
        description: 'Create a new view on a project. view_kind is one of list/gantt/table/kanban — only a kanban view owns buckets. For a kanban view you usually then create buckets and set default_bucket_id/done_bucket_id via update_view.',
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
                    description: 'Kanban bucket mode. "manual" = user-managed columns; "filter" = columns defined by bucket_configuration filters.',
                },
                filter: {
                    type: 'object',
                    description: 'TaskCollection filter object, e.g. { "filter": "done = false" }. Optional.',
                },
            },
            required: ['projectId', 'title', 'view_kind'],
        },
    },
    {
        name: 'update_view',
        description: 'Update a view (title, position, filter, or kanban bucket settings: bucket_configuration_mode, default_bucket_id, done_bucket_id). Fetches the view first and merges, so omitted fields — including the existing filter and bucket config — are preserved.',
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
        description: 'Delete a view from a project. Destructive — for a kanban view this drops its buckets. Cannot be undone.',
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
const requireInts = (args, keys) => {
    for (const k of keys) {
        if (typeof args[k] !== 'number')
            return `${k} must be a number`;
    }
    return null;
};
export const handlers = {
    list_project_views: async (request) => {
        const args = (request.params.arguments || {});
        const err = requireInts(args, ['projectId']);
        if (err)
            return { isError: true, content: [{ type: 'text', text: err }] };
        const response = await listProjectViews(args.projectId);
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
        const views = (response.data ?? []).map(v => slimView(v));
        return {
            content: [
                { type: 'text', text: `Found ${views.length} view(s)` },
                { type: 'text', text: JSON.stringify(views, null, 2) },
            ],
        };
    },
    list_buckets: async (request) => {
        const args = (request.params.arguments || {});
        const err = requireInts(args, ['projectId', 'viewId']);
        if (err)
            return { isError: true, content: [{ type: 'text', text: err }] };
        const response = await listBuckets(args.projectId, args.viewId);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    { type: 'text', text: `Error fetching buckets: ${response.error}` },
                ],
            };
        }
        const buckets = response.data ?? [];
        return {
            content: [
                { type: 'text', text: `Found ${buckets.length} bucket(s)` },
                { type: 'text', text: JSON.stringify(buckets, null, 2) },
            ],
        };
    },
    create_bucket: async (request) => {
        const args = (request.params.arguments || {});
        const err = requireInts(args, ['projectId', 'viewId']);
        if (err)
            return { isError: true, content: [{ type: 'text', text: err }] };
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
            const response = await createBucket(args.projectId, args.viewId, bucket);
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
    update_bucket: async (request) => {
        const args = (request.params.arguments || {});
        const err = requireInts(args, ['projectId', 'viewId', 'bucketId']);
        if (err)
            return { isError: true, content: [{ type: 'text', text: err }] };
        try {
            const partial = BucketInputSchema.parse({
                title: args.title,
                limit: args.limit,
                position: args.position,
            });
            const response = await updateBucket(args.projectId, args.viewId, args.bucketId, partial);
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
    delete_bucket: async (request) => {
        const args = (request.params.arguments || {});
        const err = requireInts(args, ['projectId', 'viewId', 'bucketId']);
        if (err)
            return { isError: true, content: [{ type: 'text', text: err }] };
        const response = await deleteBucket(args.projectId, args.viewId, args.bucketId);
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
    move_task_to_bucket: async (request) => {
        const args = (request.params.arguments || {});
        const err = requireInts(args, [
            'projectId',
            'viewId',
            'bucketId',
            'taskId',
        ]);
        if (err)
            return { isError: true, content: [{ type: 'text', text: err }] };
        const response = await moveTaskToBucket(args.projectId, args.viewId, args.bucketId, args.taskId);
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
    create_view: async (request) => {
        const args = (request.params.arguments || {});
        const err = requireInts(args, ['projectId']);
        if (err)
            return { isError: true, content: [{ type: 'text', text: err }] };
        try {
            const view = ViewInputSchema.parse(args);
            if (!view.title || !view.view_kind) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'title and view_kind are required' }],
                };
            }
            const response = await createView(args.projectId, view);
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
                        text: JSON.stringify(slimView(response.data), null, 2),
                    },
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
    update_view: async (request) => {
        const args = (request.params.arguments || {});
        const err = requireInts(args, ['projectId', 'viewId']);
        if (err)
            return { isError: true, content: [{ type: 'text', text: err }] };
        try {
            const partial = ViewInputSchema.parse(args);
            const response = await updateView(args.projectId, args.viewId, partial);
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
                        text: JSON.stringify(slimView(response.data), null, 2),
                    },
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
    delete_view: async (request) => {
        const args = (request.params.arguments || {});
        const err = requireInts(args, ['projectId', 'viewId']);
        if (err)
            return { isError: true, content: [{ type: 'text', text: err }] };
        const response = await deleteView(args.projectId, args.viewId);
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
