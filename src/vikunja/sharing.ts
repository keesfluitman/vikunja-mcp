import { serviceInstance, wrapRequest } from './common.js';
import type { ToolHandler, ErrorResponse } from './common.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Project sharing — three independent surfaces, all keyed off a project:
//   • users  (/projects/{id}/users)
//   • teams  (/projects/{id}/teams)
//   • link shares (/projects/{id}/shares)
// The access level field is `permission` (0 read-only, 1 read/write, 2 admin) —
// verified against our v2.3.0 instance's /api/v1/docs.json. NOT `right`. Add is
// PUT, update is POST, remove is DELETE (standard v1). These are dedicated
// share endpoints, not full-replace resources, so no mergeAndPost is needed.

const PERMISSION_DESC =
  'Access level: 0 = read-only, 1 = read/write, 2 = admin (default 0)';

// Small result helpers — 11 near-identical handlers would otherwise be ~400
// lines of boilerplate.
const err = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});
const ok = (text: string, data?: unknown): CallToolResult => ({
  content:
    data === undefined
      ? [{ type: 'text', text }]
      : [
          { type: 'text', text },
          { type: 'text', text: JSON.stringify(data, null, 2) },
        ],
});

const num = (v: unknown): v is number => typeof v === 'number';
const isErr = (r: { isError: boolean }): r is ErrorResponse => r.isError;
const validPermission = (v: unknown): v is number =>
  v === undefined || (num(v) && v >= 0 && v <= 2);

// --- project users ---------------------------------------------------------
const listProjectUsers = async (projectId: number) =>
  wrapRequest(serviceInstance.get(`/projects/${projectId}/users`));
const addProjectUser = async (
  projectId: number,
  username: string,
  permission = 0,
) =>
  wrapRequest(
    serviceInstance.put(`/projects/${projectId}/users`, {
      username,
      permission,
    }),
  );
const updateProjectUser = async (
  projectId: number,
  userId: number,
  permission: number,
) =>
  wrapRequest(
    serviceInstance.post(`/projects/${projectId}/users/${userId}`, {
      permission,
    }),
  );
const removeProjectUser = async (projectId: number, userId: number) =>
  wrapRequest(serviceInstance.delete(`/projects/${projectId}/users/${userId}`));

// --- project teams ---------------------------------------------------------
const listProjectTeams = async (projectId: number) =>
  wrapRequest(serviceInstance.get(`/projects/${projectId}/teams`));
const addProjectTeam = async (
  projectId: number,
  teamId: number,
  permission = 0,
) =>
  wrapRequest(
    serviceInstance.put(`/projects/${projectId}/teams`, {
      team_id: teamId,
      permission,
    }),
  );
const updateProjectTeam = async (
  projectId: number,
  teamId: number,
  permission: number,
) =>
  wrapRequest(
    serviceInstance.post(`/projects/${projectId}/teams/${teamId}`, {
      permission,
    }),
  );
const removeProjectTeam = async (projectId: number, teamId: number) =>
  wrapRequest(serviceInstance.delete(`/projects/${projectId}/teams/${teamId}`));

// --- link shares -----------------------------------------------------------
type LinkShareInput = {
  permission: number;
  sharing_type: number;
  password?: string;
  name?: string;
};
const listProjectShares = async (projectId: number) =>
  wrapRequest(serviceInstance.get(`/projects/${projectId}/shares`));
const createProjectShare = async (projectId: number, share: LinkShareInput) =>
  wrapRequest(serviceInstance.put(`/projects/${projectId}/shares`, share));
const deleteProjectShare = async (projectId: number, shareId: number) =>
  wrapRequest(
    serviceInstance.delete(`/projects/${projectId}/shares/${shareId}`),
  );

export default {
  listProjectUsers,
  addProjectUser,
  updateProjectUser,
  removeProjectUser,
  listProjectTeams,
  addProjectTeam,
  updateProjectTeam,
  removeProjectTeam,
  listProjectShares,
  createProjectShare,
  deleteProjectShare,
};

const projectIdProp = {
  projectId: { type: 'integer', description: 'The ID of the project' },
};

export const toolDefinitions = [
  {
    name: 'list_project_users',
    description:
      'List the users a project is directly shared with, and their permission level.',
    inputSchema: {
      type: 'object',
      properties: { ...projectIdProp },
      required: ['projectId'],
    },
  },
  {
    name: 'add_project_user',
    description:
      'Share a project with a user by USERNAME. Resolve the username via search_users if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        username: { type: 'string', description: 'Username to share with' },
        permission: {
          type: 'integer',
          enum: [0, 1, 2],
          description: PERMISSION_DESC,
        },
      },
      required: ['projectId', 'username'],
    },
  },
  {
    name: 'update_project_user',
    description: "Change a user's permission level on a shared project.",
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        userId: { type: 'integer', description: 'The numeric user ID' },
        permission: {
          type: 'integer',
          enum: [0, 1, 2],
          description: PERMISSION_DESC,
        },
      },
      required: ['projectId', 'userId', 'permission'],
    },
  },
  {
    name: 'remove_project_user',
    description: 'Stop sharing a project with a user (by numeric user ID).',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        userId: { type: 'integer', description: 'The numeric user ID' },
      },
      required: ['projectId', 'userId'],
    },
  },
  {
    name: 'list_project_teams',
    description:
      'List the teams a project is shared with, and their permission level.',
    inputSchema: {
      type: 'object',
      properties: { ...projectIdProp },
      required: ['projectId'],
    },
  },
  {
    name: 'add_project_team',
    description: 'Share a project with a team. Get the teamId from list_teams.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        teamId: { type: 'integer', description: 'The ID of the team' },
        permission: {
          type: 'integer',
          enum: [0, 1, 2],
          description: PERMISSION_DESC,
        },
      },
      required: ['projectId', 'teamId'],
    },
  },
  {
    name: 'update_project_team',
    description: "Change a team's permission level on a shared project.",
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        teamId: { type: 'integer', description: 'The ID of the team' },
        permission: {
          type: 'integer',
          enum: [0, 1, 2],
          description: PERMISSION_DESC,
        },
      },
      required: ['projectId', 'teamId', 'permission'],
    },
  },
  {
    name: 'remove_project_team',
    description: 'Stop sharing a project with a team.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        teamId: { type: 'integer', description: 'The ID of the team' },
      },
      required: ['projectId', 'teamId'],
    },
  },
  {
    name: 'list_project_shares',
    description:
      'List the public link shares for a project (shareable URLs), with their permission level and sharing type.',
    inputSchema: {
      type: 'object',
      properties: { ...projectIdProp },
      required: ['projectId'],
    },
  },
  {
    name: 'create_project_share',
    description:
      'Create a public link share for a project. sharing_type: 1 = no password, 2 = password-protected (then provide password).',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        permission: {
          type: 'integer',
          enum: [0, 1, 2],
          description: PERMISSION_DESC,
        },
        sharing_type: {
          type: 'integer',
          enum: [1, 2],
          description: '1 = no password, 2 = password-protected (default 1)',
        },
        password: {
          type: 'string',
          description: 'Required when sharing_type is 2',
        },
        name: { type: 'string', description: 'Optional label for the share' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'delete_project_share',
    description: 'Delete a project link share by its share ID.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        shareId: { type: 'integer', description: 'The ID of the link share' },
      },
      required: ['projectId', 'shareId'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  list_project_users: async request => {
    const { projectId } = request.params.arguments || {};
    if (!num(projectId)) return err('Invalid project ID');
    const r = await listProjectUsers(projectId);
    return isErr(r)
      ? err(`Error listing project users: ${r.error}`)
      : ok('Project users:', r.data);
  },

  add_project_user: async request => {
    const { projectId, username, permission } = request.params.arguments || {};
    if (!num(projectId) || typeof username !== 'string')
      return err('Invalid project ID or username');
    if (!validPermission(permission))
      return err('permission must be 0, 1, or 2');
    const r = await addProjectUser(projectId, username, permission as number);
    return isErr(r)
      ? err(`Error sharing project with ${username}: ${r.error}`)
      : ok(`Project ${projectId} shared with ${username}`, r.data);
  },

  update_project_user: async request => {
    const { projectId, userId, permission } = request.params.arguments || {};
    if (!num(projectId) || !num(userId))
      return err('Invalid project ID or user ID');
    if (!num(permission) || permission < 0 || permission > 2)
      return err('permission must be 0, 1, or 2');
    const r = await updateProjectUser(projectId, userId, permission);
    return isErr(r)
      ? err(`Error updating user ${userId} permission: ${r.error}`)
      : ok(`User ${userId} permission set to ${permission}`, r.data);
  },

  remove_project_user: async request => {
    const { projectId, userId } = request.params.arguments || {};
    if (!num(projectId) || !num(userId))
      return err('Invalid project ID or user ID');
    const r = await removeProjectUser(projectId, userId);
    return isErr(r)
      ? err(`Error unsharing project from user ${userId}: ${r.error}`)
      : ok(`Project ${projectId} unshared from user ${userId}`);
  },

  list_project_teams: async request => {
    const { projectId } = request.params.arguments || {};
    if (!num(projectId)) return err('Invalid project ID');
    const r = await listProjectTeams(projectId);
    return isErr(r)
      ? err(`Error listing project teams: ${r.error}`)
      : ok('Project teams:', r.data);
  },

  add_project_team: async request => {
    const { projectId, teamId, permission } = request.params.arguments || {};
    if (!num(projectId) || !num(teamId))
      return err('Invalid project ID or team ID');
    if (!validPermission(permission))
      return err('permission must be 0, 1, or 2');
    const r = await addProjectTeam(projectId, teamId, permission as number);
    return isErr(r)
      ? err(`Error sharing project with team ${teamId}: ${r.error}`)
      : ok(`Project ${projectId} shared with team ${teamId}`, r.data);
  },

  update_project_team: async request => {
    const { projectId, teamId, permission } = request.params.arguments || {};
    if (!num(projectId) || !num(teamId))
      return err('Invalid project ID or team ID');
    if (!num(permission) || permission < 0 || permission > 2)
      return err('permission must be 0, 1, or 2');
    const r = await updateProjectTeam(projectId, teamId, permission);
    return isErr(r)
      ? err(`Error updating team ${teamId} permission: ${r.error}`)
      : ok(`Team ${teamId} permission set to ${permission}`, r.data);
  },

  remove_project_team: async request => {
    const { projectId, teamId } = request.params.arguments || {};
    if (!num(projectId) || !num(teamId))
      return err('Invalid project ID or team ID');
    const r = await removeProjectTeam(projectId, teamId);
    return isErr(r)
      ? err(`Error unsharing project from team ${teamId}: ${r.error}`)
      : ok(`Project ${projectId} unshared from team ${teamId}`);
  },

  list_project_shares: async request => {
    const { projectId } = request.params.arguments || {};
    if (!num(projectId)) return err('Invalid project ID');
    const r = await listProjectShares(projectId);
    return isErr(r)
      ? err(`Error listing project shares: ${r.error}`)
      : ok('Project link shares:', r.data);
  },

  create_project_share: async request => {
    const { projectId, permission, sharing_type, password, name } =
      request.params.arguments || {};
    if (!num(projectId)) return err('Invalid project ID');
    if (!validPermission(permission))
      return err('permission must be 0, 1, or 2');
    const type = num(sharing_type) ? sharing_type : 1;
    if (type === 2 && typeof password !== 'string')
      return err('password is required when sharing_type is 2');
    const r = await createProjectShare(projectId, {
      permission: num(permission) ? permission : 0,
      sharing_type: type,
      ...(typeof password === 'string' ? { password } : {}),
      ...(typeof name === 'string' ? { name } : {}),
    });
    return isErr(r)
      ? err(`Error creating link share: ${r.error}`)
      : ok(`Link share created for project ${projectId}`, r.data);
  },

  delete_project_share: async request => {
    const { projectId, shareId } = request.params.arguments || {};
    if (!num(projectId) || !num(shareId))
      return err('Invalid project ID or share ID');
    const r = await deleteProjectShare(projectId, shareId);
    return isErr(r)
      ? err(`Error deleting link share ${shareId}: ${r.error}`)
      : ok(`Link share ${shareId} deleted`);
  },
};
