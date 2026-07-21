import { z } from 'zod';
import { serviceInstance, wrapRequest, getList, patch } from './common.js';
import type { ToolHandler } from './common.js';
import { UserSchema } from './schema.js';

// Caller-supplied fields dropped from a PATCH body: owner/views/background_* are
// read-only or nested and would trigger "Invalid model"; max_right is a
// computed access field. Everything else the caller passes is a genuine partial
// update — v2 PATCH leaves omitted fields untouched.
const PROJECT_UPDATE_STRIP_KEYS = [
  'owner',
  'views',
  'subscription',
  'background_blur_hash',
  'background_information',
  'max_right',
] as const;

const ProjectSchema = z.object({
  description: z.string().optional(),
  hex_color: z.string().max(7).startsWith('#').optional(),
  id: z.number().optional(),
  identifier: z.string().min(0).max(10).optional(),
  is_archived: z.boolean().optional(),
  is_favorite: z.boolean().optional(),
  max_right: z.number().int().min(0).max(2).optional(),
  owner: UserSchema.optional(),
  parent_project_id: z.number().optional(),
  position: z.number().optional(),
  title: z.string(),
});

export type Project = z.infer<typeof ProjectSchema> & {
  background_blur_hash: string;
  background_information: unknown;
  subscription: unknown;
  created: string;
  updated: string;
  views: Array<unknown>;
};

export type ProjectInput = z.infer<typeof ProjectSchema>;

const listProjects = async (page = 1, perPage = 50) =>
  getList<Project>('/projects', { params: { page, per_page: perPage } });

const getProject = async (projectId: number) =>
  wrapRequest(serviceInstance.get<Project>(`/projects/${projectId}`));

const createProject = async (projectData: ProjectInput) =>
  wrapRequest(serviceInstance.post<Project>('/projects', projectData));

const updateProject = async (
  projectId: number,
  projectData: Partial<ProjectInput>,
) =>
  patch<Project>(
    `/projects/${projectId}`,
    projectData as Record<string, unknown>,
    PROJECT_UPDATE_STRIP_KEYS,
  );

const deleteProject = async (projectId: number) =>
  wrapRequest(serviceInstance.delete<Project>(`/projects/${projectId}`));

const projects = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
};

export default projects;

export const toolDefinitions = [
  {
    name: 'list_projects',
    description: 'List all projects',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Page number (default: 1)' },
        per_page: {
          type: 'integer',
          description: 'Results per page, max 50 (default: 50)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_project',
    description: 'Get a specific project by ID',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'integer',
          description: 'The ID of the project to retrieve',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new project',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Project description',
        },
        hex_color: {
          type: 'string',
          description: 'Hex color code for the project (e.g. #FF0000)',
          pattern: '^#[0-9A-Fa-f]{6}$',
        },
        id: {
          type: 'integer',
          description: 'Project ID',
        },
        identifier: {
          type: 'string',
          description: 'Project identifier (0-10 characters)',
          minLength: 0,
          maxLength: 10,
        },
        is_archived: {
          type: 'boolean',
          description: 'Whether the project is archived',
        },
        is_favorite: {
          type: 'boolean',
          description: 'Whether the project is favorited',
        },
        max_right: {
          type: 'integer',
          description: 'Maximum rights level (0: RO, 1: RW, 2: Admin)',
          minimum: 0,
          maximum: 2,
        },
        parent_project_id: {
          type: 'integer',
          description: 'ID of the parent project',
        },
        position: {
          type: 'integer',
          description: 'Project position',
        },
        title: {
          type: 'string',
          description: 'Project title',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_project',
    description: 'Update an existing project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'integer',
          description: 'The ID of the project to update',
        },
        description: {
          type: 'string',
          description: 'Project description',
        },
        hex_color: {
          type: 'string',
          description: 'Hex color code for the project (e.g. #FF0000)',
          pattern: '^#[0-9A-Fa-f]{6}$',
        },
        identifier: {
          type: 'string',
          description: 'Project identifier (0-10 characters)',
          minLength: 0,
          maxLength: 10,
        },
        is_archived: {
          type: 'boolean',
          description: 'Whether the project is archived',
        },
        is_favorite: {
          type: 'boolean',
          description: 'Whether the project is favorited',
        },
        max_right: {
          type: 'integer',
          description: 'Maximum rights level (0: RO, 1: RW, 2: Admin)',
          minimum: 0,
          maximum: 2,
        },
        parent_project_id: {
          type: 'integer',
          description: 'ID of the parent project',
        },
        position: {
          type: 'integer',
          description: 'Project position',
        },
        title: {
          type: 'string',
          description: 'Project title',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project by ID',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'integer',
          description: 'The ID of the project to delete',
        },
      },
      required: ['projectId'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  list_projects: async request => {
    const { page, per_page } = request.params.arguments || {};
    const response = await listProjects(
      typeof page === 'number' ? page : 1,
      typeof per_page === 'number' ? Math.min(per_page, 50) : 50,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error fetching projects: ${response.error}`,
          },
        ],
      };
    }

    const projects = response.data || [];

    if (projects.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No projects found',
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Found ${projects.length} project(s):`,
        },
        {
          type: 'text',
          text: JSON.stringify(projects, null, 2),
        },
      ],
    };
  },
  get_project: async request => {
    const projectId = request.params.arguments?.projectId;

    if (typeof projectId !== 'number') {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Project ID must be a number',
          },
        ],
      };
    }

    const response = await getProject(projectId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error fetching project: ${response.error}`,
          },
        ],
      };
    }

    const project = response.data;

    if (!project) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Project with ID ${projectId} not found`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(project, null, 2),
        },
      ],
    };
  },
  create_project: async request => {
    const projectData = request.params.arguments;

    if (!projectData) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'No project data provided',
          },
        ],
      };
    }

    try {
      const validatedData = ProjectSchema.parse(projectData);
      const response = await createProject(validatedData);

      if (response.isError) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error creating project: ${response.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Project created successfully:',
          },
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
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
  update_project: async request => {
    const { projectId, ...projectData } = request.params.arguments || {};

    if (typeof projectId !== 'number') {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Project ID must be a number',
          },
        ],
      };
    }

    if (Object.keys(projectData).length === 0) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'No update data provided',
          },
        ],
      };
    }

    try {
      const UpdateProjectSchema = ProjectSchema.partial();
      const validatedData = UpdateProjectSchema.parse(projectData);
      const response = await updateProject(projectId, validatedData);

      if (response.isError) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error updating project: ${response.error}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Project updated successfully:',
          },
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
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
  delete_project: async request => {
    const projectId = request.params.arguments?.projectId;

    if (typeof projectId !== 'number') {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Project ID must be a number',
          },
        ],
      };
    }

    const response = await deleteProject(projectId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error deleting project: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Project ${projectId} deleted successfully`,
        },
      ],
    };
  },
};
