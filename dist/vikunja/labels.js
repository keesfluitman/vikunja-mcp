import { z } from 'zod';
import { serviceInstance, wrapRequest } from './common.js';
import { HexColorSchema } from './schema.js';
const LabelInputSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    hex_color: HexColorSchema,
});
const listLabels = async (page = 1, perPage = 50, search) => wrapRequest(serviceInstance.get('/labels', {
    params: { page, per_page: perPage, ...(search ? { s: search } : {}) },
}));
const getLabel = async (labelId) => wrapRequest(serviceInstance.get(`/labels/${labelId}`));
const createLabel = async (label) => wrapRequest(serviceInstance.put('/labels', label));
// Swagger lists PUT for /labels/{id} but the server returns 405; the actual
// update method is POST.
const updateLabel = async (labelId, label) => wrapRequest(serviceInstance.post(`/labels/${labelId}`, label));
const deleteLabel = async (labelId) => wrapRequest(serviceInstance.delete(`/labels/${labelId}`));
export default {
    listLabels,
    getLabel,
    createLabel,
    updateLabel,
    deleteLabel,
};
export const toolDefinitions = [
    {
        name: 'list_labels',
        description: 'List labels available to the current user. Use this to discover label IDs before attaching them to a task.',
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'integer', description: 'Page number (default: 1)' },
                per_page: {
                    type: 'integer',
                    description: 'Results per page, max 50 (default: 50)',
                },
                s: { type: 'string', description: 'Search labels by title' },
            },
            required: [],
        },
    },
    {
        name: 'get_label',
        description: 'Get a specific label by ID',
        inputSchema: {
            type: 'object',
            properties: {
                labelId: { type: 'integer', description: 'The ID of the label' },
            },
            required: ['labelId'],
        },
    },
    {
        name: 'create_label',
        description: 'Create a new label',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Label title' },
                description: { type: 'string' },
                hex_color: {
                    type: 'string',
                    description: 'Hex color WITHOUT leading # (Vikunja convention, e.g. "dc2626"). Schema permits "#RRGGBB" too.',
                },
            },
            required: ['title'],
        },
    },
    {
        name: 'update_label',
        description: 'Update a label by ID',
        inputSchema: {
            type: 'object',
            properties: {
                labelId: { type: 'integer', description: 'The ID of the label' },
                title: { type: 'string' },
                description: { type: 'string' },
                hex_color: { type: 'string' },
            },
            required: ['labelId'],
        },
    },
    {
        name: 'delete_label',
        description: 'Delete a label by ID. Removes it from all tasks. Cannot be undone.',
        inputSchema: {
            type: 'object',
            properties: {
                labelId: { type: 'integer', description: 'The ID of the label' },
            },
            required: ['labelId'],
        },
    },
];
export const handlers = {
    list_labels: async (request) => {
        const args = (request.params.arguments || {});
        const page = typeof args.page === 'number' ? args.page : 1;
        const perPage = typeof args.per_page === 'number' ? Math.min(args.per_page, 50) : 50;
        const search = typeof args.s === 'string' ? args.s : undefined;
        const response = await listLabels(page, perPage, search);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    { type: 'text', text: `Error fetching labels: ${response.error}` },
                ],
            };
        }
        const labels = response.data || [];
        if (labels.length === 0) {
            return { content: [{ type: 'text', text: 'No labels found' }] };
        }
        return {
            content: [
                { type: 'text', text: `Found ${labels.length} label(s)` },
                { type: 'text', text: JSON.stringify(labels, null, 2) },
            ],
        };
    },
    get_label: async (request) => {
        const labelId = request.params.arguments?.labelId;
        if (typeof labelId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid label ID' }],
            };
        }
        const response = await getLabel(labelId);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error retrieving label ID ${labelId}: ${response.error}`,
                    },
                ],
            };
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
    },
    create_label: async (request) => {
        try {
            const validated = LabelInputSchema.parse(request.params.arguments);
            if (!validated.title) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'title is required' }],
                };
            }
            const response = await createLabel(validated);
            if (response.isError) {
                return {
                    isError: true,
                    content: [
                        { type: 'text', text: `Error creating label: ${response.error}` },
                    ],
                };
            }
            return {
                content: [
                    { type: 'text', text: 'Label created successfully:' },
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
    update_label: async (request) => {
        const args = (request.params.arguments || {});
        const labelId = args.labelId;
        if (typeof labelId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid label ID' }],
            };
        }
        const { labelId: _ignore, ...rest } = args;
        void _ignore;
        try {
            const validated = LabelInputSchema.partial().parse(rest);
            const response = await updateLabel(labelId, validated);
            if (response.isError) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `Error updating label ID ${labelId}: ${response.error}`,
                        },
                    ],
                };
            }
            return {
                content: [
                    { type: 'text', text: 'Label updated successfully:' },
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
    delete_label: async (request) => {
        const labelId = request.params.arguments?.labelId;
        if (typeof labelId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid label ID' }],
            };
        }
        const response = await deleteLabel(labelId);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error deleting label ID ${labelId}: ${response.error}`,
                    },
                ],
            };
        }
        return {
            content: [{ type: 'text', text: `Label ${labelId} deleted` }],
        };
    },
};
