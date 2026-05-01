import { serviceInstance, wrapRequest } from './common.js';
// Vikunja's /users endpoint requires a non-empty `s` param and matches the
// FULL username only (not partial, not email). This is a server-side quirk;
// we pass the query through verbatim and surface a helpful message on null.
const searchUsers = async (search) => wrapRequest(serviceInstance.get('/users', {
    params: { s: search },
}));
const getCurrentUser = async () => wrapRequest(serviceInstance.get('/user'));
export default { searchUsers, getCurrentUser };
export const toolDefinitions = [
    {
        name: 'search_users',
        description: 'Search users by exact username (Vikunja does NOT do partial-match here, and email lookup does not work). Use to resolve a username to a user ID for assignees. Returns null if no exact match.',
        inputSchema: {
            type: 'object',
            properties: {
                s: { type: 'string', description: 'Exact username to look up' },
            },
            required: ['s'],
        },
    },
    {
        name: 'get_current_user',
        description: 'Get the user who owns the API token (useful for self-assignment).',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
];
export const handlers = {
    search_users: async (request) => {
        const search = request.params.arguments?.s;
        if (typeof search !== 'string' || search.length === 0) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: 'Search string `s` is required (exact username)',
                    },
                ],
            };
        }
        const response = await searchUsers(search);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    { type: 'text', text: `Error searching users: ${response.error}` },
                ],
            };
        }
        const users = response.data;
        if (!users || users.length === 0) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `No user matched "${search}". Note: Vikunja requires the exact username — partial matches and email lookups return null.`,
                    },
                ],
            };
        }
        return {
            content: [
                { type: 'text', text: `Found ${users.length} user(s)` },
                { type: 'text', text: JSON.stringify(users, null, 2) },
            ],
        };
    },
    get_current_user: async () => {
        const response = await getCurrentUser();
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error fetching current user: ${response.error}`,
                    },
                ],
            };
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
    },
};
