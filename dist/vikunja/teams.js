import { z } from 'zod';
import { serviceInstance, wrapRequest, mergeAndPost } from './common.js';
// Teams follow Vikunja's standard v1 verbs: create = PUT /teams, update = POST
// /teams/{id} (full-replace → mergeAndPost). Members live on a nested endpoint:
// add = PUT /teams/{id}/members { username, admin }, and remove is keyed by
// USERNAME in the path (DELETE /teams/{id}/members/{username}), not user id.
const TEAM_UPDATE_STRIP_KEYS = [
    'created',
    'updated',
    'created_by',
    'members',
];
const TeamInputSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    is_public: z.boolean().optional(),
});
const listTeams = async (page = 1, perPage = 50, search) => wrapRequest(serviceInstance.get('/teams', {
    params: { page, per_page: perPage, ...(search ? { s: search } : {}) },
}));
const getTeam = async (teamId) => wrapRequest(serviceInstance.get(`/teams/${teamId}`));
const createTeam = async (team) => wrapRequest(serviceInstance.put('/teams', team));
const updateTeam = async (teamId, partial) => mergeAndPost(`/teams/${teamId}`, partial, TEAM_UPDATE_STRIP_KEYS);
const deleteTeam = async (teamId) => wrapRequest(serviceInstance.delete(`/teams/${teamId}`));
const addTeamMember = async (teamId, username, admin = false) => wrapRequest(serviceInstance.put(`/teams/${teamId}/members`, { username, admin }));
const removeTeamMember = async (teamId, username) => wrapRequest(serviceInstance.delete(`/teams/${teamId}/members/${username}`));
export default {
    listTeams,
    getTeam,
    createTeam,
    updateTeam,
    deleteTeam,
    addTeamMember,
    removeTeamMember,
};
export const toolDefinitions = [
    {
        name: 'list_teams',
        description: 'List teams the current user belongs to. Use this to discover team IDs before sharing a project with a team or managing members.',
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'integer', description: 'Page number (default: 1)' },
                per_page: {
                    type: 'integer',
                    description: 'Results per page, max 50 (default: 50)',
                },
                s: { type: 'string', description: 'Search teams by name' },
            },
            required: [],
        },
    },
    {
        name: 'get_team',
        description: 'Get a specific team by ID, including its members.',
        inputSchema: {
            type: 'object',
            properties: {
                teamId: { type: 'integer', description: 'The ID of the team' },
            },
            required: ['teamId'],
        },
    },
    {
        name: 'create_team',
        description: 'Create a new team. The creating user becomes its admin.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Team name' },
                description: { type: 'string' },
                is_public: {
                    type: 'boolean',
                    description: 'Whether the team is discoverable by other users',
                },
            },
            required: ['name'],
        },
    },
    {
        name: 'update_team',
        description: 'Update a team’s name, description, or visibility. Fetches the team first and merges, so omitted fields are preserved.',
        inputSchema: {
            type: 'object',
            properties: {
                teamId: { type: 'integer', description: 'The ID of the team' },
                name: { type: 'string' },
                description: { type: 'string' },
                is_public: { type: 'boolean' },
            },
            required: ['teamId'],
        },
    },
    {
        name: 'delete_team',
        description: 'Delete a team by ID. Removes its access to all shared projects. Cannot be undone.',
        inputSchema: {
            type: 'object',
            properties: {
                teamId: { type: 'integer', description: 'The ID of the team' },
            },
            required: ['teamId'],
        },
    },
    {
        name: 'add_team_member',
        description: 'Add a user to a team by USERNAME (not user ID). Resolve the username via search_users if needed.',
        inputSchema: {
            type: 'object',
            properties: {
                teamId: { type: 'integer', description: 'The ID of the team' },
                username: {
                    type: 'string',
                    description: 'The username of the user to add',
                },
                admin: {
                    type: 'boolean',
                    description: 'Whether the new member is a team admin (default false)',
                },
            },
            required: ['teamId', 'username'],
        },
    },
    {
        name: 'remove_team_member',
        description: 'Remove a user from a team by USERNAME (the remove endpoint is keyed by username, not user ID).',
        inputSchema: {
            type: 'object',
            properties: {
                teamId: { type: 'integer', description: 'The ID of the team' },
                username: {
                    type: 'string',
                    description: 'The username of the member to remove',
                },
            },
            required: ['teamId', 'username'],
        },
    },
];
export const handlers = {
    list_teams: async (request) => {
        const args = (request.params.arguments || {});
        const page = typeof args.page === 'number' ? args.page : 1;
        const perPage = typeof args.per_page === 'number' ? Math.min(args.per_page, 50) : 50;
        const search = typeof args.s === 'string' ? args.s : undefined;
        const response = await listTeams(page, perPage, search);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    { type: 'text', text: `Error fetching teams: ${response.error}` },
                ],
            };
        }
        const teams = response.data || [];
        if (teams.length === 0) {
            return { content: [{ type: 'text', text: 'No teams found' }] };
        }
        return {
            content: [
                { type: 'text', text: `Found ${teams.length} team(s)` },
                { type: 'text', text: JSON.stringify(teams, null, 2) },
            ],
        };
    },
    get_team: async (request) => {
        const teamId = request.params.arguments?.teamId;
        if (typeof teamId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid team ID' }],
            };
        }
        const response = await getTeam(teamId);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error retrieving team ID ${teamId}: ${response.error}`,
                    },
                ],
            };
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
        };
    },
    create_team: async (request) => {
        try {
            const validated = TeamInputSchema.parse(request.params.arguments);
            if (!validated.name) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'name is required' }],
                };
            }
            const response = await createTeam(validated);
            if (response.isError) {
                return {
                    isError: true,
                    content: [
                        { type: 'text', text: `Error creating team: ${response.error}` },
                    ],
                };
            }
            return {
                content: [
                    { type: 'text', text: 'Team created:' },
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
    update_team: async (request) => {
        const args = (request.params.arguments || {});
        const teamId = args.teamId;
        if (typeof teamId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid team ID' }],
            };
        }
        const { teamId: _ignore, ...rest } = args;
        void _ignore;
        try {
            const validated = TeamInputSchema.partial().parse(rest);
            const response = await updateTeam(teamId, validated);
            if (response.isError) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `Error updating team ID ${teamId}: ${response.error}`,
                        },
                    ],
                };
            }
            return {
                content: [
                    { type: 'text', text: 'Team updated:' },
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
    delete_team: async (request) => {
        const teamId = request.params.arguments?.teamId;
        if (typeof teamId !== 'number') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid team ID' }],
            };
        }
        const response = await deleteTeam(teamId);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error deleting team ID ${teamId}: ${response.error}`,
                    },
                ],
            };
        }
        return { content: [{ type: 'text', text: `Team ${teamId} deleted` }] };
    },
    add_team_member: async (request) => {
        const args = (request.params.arguments || {});
        const teamId = args.teamId;
        const username = args.username;
        if (typeof teamId !== 'number' || typeof username !== 'string') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid team ID or username' }],
            };
        }
        const admin = args.admin === true;
        const response = await addTeamMember(teamId, username, admin);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error adding ${username} to team ${teamId}: ${response.error}`,
                    },
                ],
            };
        }
        return {
            content: [{ type: 'text', text: `${username} added to team ${teamId}` }],
        };
    },
    remove_team_member: async (request) => {
        const args = (request.params.arguments || {});
        const teamId = args.teamId;
        const username = args.username;
        if (typeof teamId !== 'number' || typeof username !== 'string') {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Invalid team ID or username' }],
            };
        }
        const response = await removeTeamMember(teamId, username);
        if (response.isError) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error removing ${username} from team ${teamId}: ${response.error}`,
                    },
                ],
            };
        }
        return {
            content: [
                { type: 'text', text: `${username} removed from team ${teamId}` },
            ],
        };
    },
};
