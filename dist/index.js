#!/usr/bin/env node
// `Server` is JSDoc-deprecated in @modelcontextprotocol/sdk in favor of
// `McpServer`, but the high-level API only accepts Zod schemas — our 66
// tool definitions are hand-rolled JSON Schemas. The SDK note explicitly
// permits `Server` "for advanced use cases" like ours. Revisit if/when
// the SDK exposes a JSON-Schema path on McpServer.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { tools, handlers } from './vikunja/index.js';
// Top-level guidance the MCP client injects into the model's context at
// connect time. This is where cross-tool conventions live so a fresh session
// understands the server without first having to call each tool and read its
// description. Keep it short — it is always-on context.
const INSTRUCTIONS = `Vikunja task manager over its REST API. Tools are grouped: tasks, projects, kanban (views/buckets), labels, saved filters, users.

Conventions:
- Discover before acting: use list_projects / list_labels to resolve names to IDs; for kanban, call list_project_views first to get the kanban view's id, default_bucket_id (where new tasks land) and done_bucket_id.
- Reads default to OPEN tasks (filter "done = false") sorted by most-recently-updated. Pass filter "" to include done tasks. Filter DSL: https://vikunja.io/docs/filters (e.g. "priority >= 3", "due_date < now+7d", "labels in 1,2"). Read tools accept verbose:true for the full object; default is a slimmed payload.
- Priority scale: 1 low, 2 medium, 3 high, 4 urgent. 0 means none. create_task defaults priority to 0.
- update_task is a full REPLACE, not a PATCH: this server fetches-then-merges so omitting a field is safe, but only fields you understand should be changed. To attach/detach a single label or assignee prefer add_task_label / add_task_assignee (and the remove_* variants) over rewriting the whole task.
- Reading a kanban board: use get_kanban_board (projectId + kanban viewId) to see which tasks are in which column — plain task lists report bucket_id: 0 because bucket membership is per-view. list_buckets gives column metadata + task counts only.
- Moving tasks: use move_task to change a task's PROJECT; use move_task_to_bucket to move between kanban columns (do NOT set bucket_id via update_task — it is ambiguous across views). Dropping a task into a view's done_bucket_id marks it done.
- Destructive tools (delete_*) cannot be undone.`;
const server = new Server({
    name: 'vikunja-mcp',
    version: '1.4.0',
}, {
    capabilities: {
        tools: {},
    },
    instructions: INSTRUCTIONS,
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!request.params.name) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: 'Tool name is required',
                },
            ],
        };
    }
    const handler = handlers[request.params.name];
    if (!handler) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Tool "${request.params.name}" not found`,
                },
            ],
        };
    }
    try {
        const result = await handler(request);
        return result;
    }
    catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Error handling tool "${request.params.name}": ${error}`,
                },
            ],
        };
    }
});
async function main() {
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
    catch {
        process.exit(1);
    }
}
main();
