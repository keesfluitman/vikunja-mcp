import { z } from 'zod';
import { serviceInstance, wrapRequest } from './common.js';
// A saved filter wraps the same query params accepted by GET /tasks.
const FilterParamsSchema = z.object({
    s: z.string().optional(),
    filter: z.string().optional(),
    sort_by: z.array(z.string()).optional(),
    order_by: z.array(z.enum(['asc', 'desc'])).optional(),
    filter_include_nulls: z.boolean().optional(),
    filter_timezone: z.string().optional(),
});
const SavedFilterInputSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    is_favorite: z.boolean().optional(),
    filters: FilterParamsSchema.optional(),
});
// Vikunja surfaces saved filters as virtual projects with negative IDs.
// Filter id N appears as project id -(N+1). Project id -1 is the special
// "Favorites" pseudo-project, NOT a saved filter.
const projectIdToFilterId = (projectId) => projectId < -1 ? -projectId - 1 : null;
const listSavedFilters = async () => {
    const response = await wrapRequest(serviceInstance.get('/projects', { params: { per_page: 50 } }));
    if (response.isError)
        return response;
    const filters = (response.data ?? [])
        .map(p => ({ ...p, filter_id: projectIdToFilterId(p.id) }))
        .filter((p) => p.filter_id !== null);
    return { isError: false, data: filters };
};
const getSavedFilter = async (filterId) => wrapRequest(serviceInstance.get(`/filters/${filterId}`));
const createSavedFilter = async (data) => wrapRequest(serviceInstance.put('/filters', data));
const updateSavedFilter = async (filterId, data) => wrapRequest(serviceInstance.post(`/filters/${filterId}`, data));
const deleteSavedFilter = async (filterId) => wrapRequest(serviceInstance.delete(`/filters/${filterId}`));
export default {
    listSavedFilters,
    getSavedFilter,
    createSavedFilter,
    updateSavedFilter,
    deleteSavedFilter,
};
const FILTER_SHAPE_DESCRIPTION = 'Object containing query params: s (search), filter (DSL string, e.g. "done = false"), sort_by (array of field names), order_by (array of "asc"/"desc"), filter_include_nulls, filter_timezone.';
export const toolDefinitions = [
    {
        name: 'list_saved_filters',
        description: "List the user's saved filters. Vikunja exposes these as virtual projects with negative IDs; this tool unwraps them and returns the underlying filter_id you can pass to get_saved_filter.",
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'get_saved_filter',
        description: 'Get a saved filter by its filter_id (positive integer)',
        inputSchema: {
            type: 'object',
            properties: {
                filterId: {
                    type: 'integer',
                    description: 'The filter ID (positive integer, NOT the negative virtual-project ID)',
                },
            },
            required: ['filterId'],
        },
    },
    {
        name: 'create_saved_filter',
        description: 'Create a saved filter. Once created, tasks matching it appear under a virtual project with id -(filter_id + 1).',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                is_favorite: { type: 'boolean' },
                filters: {
                    type: 'object',
                    description: FILTER_SHAPE_DESCRIPTION,
                    properties: {
                        s: { type: 'string' },
                        filter: { type: 'string' },
                        sort_by: { type: 'array', items: { type: 'string' } },
                        order_by: {
                            type: 'array',
                            items: { type: 'string', enum: ['asc', 'desc'] },
                        },
                        filter_include_nulls: { type: 'boolean' },
                        filter_timezone: { type: 'string' },
                    },
                },
            },
            required: ['title'],
        },
    },
    {
        name: 'update_saved_filter',
        description: 'Update a saved filter by ID',
        inputSchema: {
            type: 'object',
            properties: {
                filterId: { type: 'integer', description: 'The filter ID' },
                title: { type: 'string' },
                description: { type: 'string' },
                is_favorite: { type: 'boolean' },
                filters: {
                    type: 'object',
                    description: FILTER_SHAPE_DESCRIPTION,
                    properties: {
                        s: { type: 'string' },
                        filter: { type: 'string' },
                        sort_by: { type: 'array', items: { type: 'string' } },
                        order_by: {
                            type: 'array',
                            items: { type: 'string', enum: ['asc', 'desc'] },
                        },
                        filter_include_nulls: { type: 'boolean' },
                        filter_timezone: { type: 'string' },
                    },
                },
            },
            required: ['filterId'],
        },
    },
    {
        name: 'delete_saved_filter',
        description: 'Delete a saved filter by ID. Cannot be undone.',
        inputSchema: {
            type: 'object',
            properties: {
                filterId: { type: 'integer', description: 'The filter ID' },
            },
            required: ['filterId'],
        },
    },
];
export const handlers = {
    list_saved_filters: async () => {
        const response = await listSavedFilters();
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error fetching saved filters: ${response.error}`,
                    },
                ],
            };
        }
        const filters = response.data ?? [];
        if (filters.length === 0) {
            return { content: [{ type: 'text', text: 'No saved filters found' }] };
        }
        return {
            content: [
                { type: 'text', text: `Found ${filters.length} saved filter(s)` },
                { type: 'text', text: JSON.stringify(filters, null, 2) },
            ],
        };
    },
    get_saved_filter: async (request) => {
        const filterId = request.params.arguments?.filterId;
        if (typeof filterId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid filter ID' }],
            };
        }
        const response = await getSavedFilter(filterId);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error retrieving filter ID ${filterId}: ${response.error}`,
                    },
                ],
            };
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
    },
    create_saved_filter: async (request) => {
        try {
            const validated = SavedFilterInputSchema.parse(request.params.arguments);
            if (!validated.title) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'title is required' }],
                };
            }
            const response = await createSavedFilter(validated);
            if (response.isError) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `Error creating saved filter: ${response.error}`,
                        },
                    ],
                };
            }
            return {
                content: [
                    { type: 'text', text: 'Saved filter created:' },
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
    update_saved_filter: async (request) => {
        const args = (request.params.arguments || {});
        const filterId = args.filterId;
        if (typeof filterId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid filter ID' }],
            };
        }
        const { filterId: _ignore, ...rest } = args;
        void _ignore;
        try {
            const validated = SavedFilterInputSchema.partial().parse(rest);
            const response = await updateSavedFilter(filterId, validated);
            if (response.isError) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `Error updating filter ID ${filterId}: ${response.error}`,
                        },
                    ],
                };
            }
            return {
                content: [
                    { type: 'text', text: 'Saved filter updated:' },
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
    delete_saved_filter: async (request) => {
        const filterId = request.params.arguments?.filterId;
        if (typeof filterId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid filter ID' }],
            };
        }
        const response = await deleteSavedFilter(filterId);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error deleting filter ID ${filterId}: ${response.error}`,
                    },
                ],
            };
        }
        return {
            content: [{ type: 'text', text: `Saved filter ${filterId} deleted` }],
        };
    },
};
