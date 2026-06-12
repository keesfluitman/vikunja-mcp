# vikunja-mcp

Model Context Protocol server for [Vikunja](https://vikunja.io). Lets an LLM
read, search, create, and modify your tasks, projects, labels, and saved
filters via Vikunja's REST API.

This is a fork of [AnthonyUtt/vikunja-mcp](https://github.com/AnthonyUtt/vikunja-mcp)
extended with the filter DSL, slim payloads, and labels/saved-filters/users
modules.

## Tools

### Tasks
- `list_all_tasks` — list across all projects with full filter/sort/search
  support. Defaults to `done = false` sorted by most recently updated. Pass
  `verbose: true` for the full task object (otherwise reactions, attachments,
  created_by, related_tasks, etc. are stripped to keep context small).
- `list_project_tasks` — same but scoped to one project.
- `get_task`, `create_task`, `update_task`, `delete_task`
- `move_task` — move a task to a different project (preserves its other
  fields; for moving between kanban columns use `move_task_to_bucket`).
- Assignees/labels: `add_task_assignee`, `remove_task_assignee`,
  `add_task_label`, `remove_task_label` — dedicated attach/detach endpoints.
  Prefer these over `update_task` for relation edits: they touch only that
  relation and avoid the full-replace footgun.
- Relations: `create_relation`, `delete_relation`
- Comments: `get_task_comments`, `create_task_comment`, `update_task_comment`,
  `delete_task_comment`
- Attachments: `list_task_attachments`, `get_task_attachment`,
  `upload_task_attachment` (multipart — reads files from the MCP host by path),
  `delete_task_attachment`

### Projects
- `list_projects`, `get_project`, `create_project`, `update_project`,
  `delete_project`

### Kanban (views & buckets)
Kanban lives under project *views*, not the project directly — a project has
several views (list/gantt/table/kanban) and only the kanban view owns buckets.
- `list_project_views` — discover a project's views and, for the kanban view,
  its `default_bucket_id` (where new tasks land) and `done_bucket_id`.
- `create_view`, `update_view`, `delete_view` — manage the views themselves
  (list/gantt/table/kanban), including a kanban view's `default_bucket_id` /
  `done_bucket_id` and its filter.
- `list_buckets`, `create_bucket`, `update_bucket`, `delete_bucket` — manage
  the columns of a kanban view.
- `move_task_to_bucket` — move a task into a bucket within a given view. This
  is the correct way to move a task between columns; `update_task` with a
  `bucket_id` is ambiguous across views. Dropping a task into the view's
  `done_bucket_id` marks it done.

### Labels
- `list_labels`, `get_label`, `create_label`, `update_label`, `delete_label`

### Saved filters
- `list_saved_filters`, `get_saved_filter`, `create_saved_filter`,
  `update_saved_filter`, `delete_saved_filter`. Vikunja exposes saved filters
  as virtual projects with negative IDs; `list_saved_filters` unwraps them and
  returns the underlying `filter_id`.

### Teams
- `list_teams`, `get_team`, `create_team`, `update_team`, `delete_team`
- `add_team_member`, `remove_team_member` — both keyed by **username**, not user
  ID (Vikunja's team-member endpoints take usernames).

### Project sharing
Three independent surfaces, all keyed off a project. Access level is
`permission`: `0` read-only, `1` read/write, `2` admin.
- Users: `list_project_users`, `add_project_user` (by username),
  `update_project_user`, `remove_project_user`.
- Teams: `list_project_teams`, `add_project_team`, `update_project_team`,
  `remove_project_team`.
- Link shares: `list_project_shares`, `create_project_share`,
  `delete_project_share`.

### Users
- `search_users` — exact-username lookup (Vikunja's `/users` endpoint does
  NOT match partials or emails).
- `get_current_user` — the user owning the API token.

## Filter DSL

Both list-task tools accept a `filter` query string in Vikunja's filter DSL.
A few examples:

| What you want                  | `filter`                                    |
| ------------------------------ | ------------------------------------------- |
| Open tasks (default)           | `done = false`                              |
| Overdue                        | `due_date < now && done = false`            |
| Due in next 7 days             | `due_date < now+7d && done = false`         |
| High priority                  | `priority >= 3`                             |
| Tasks in a specific project    | `project = 20`                              |
| Tasks with a label             | `labels in 1,2`                             |
| Combined                       | `done = false && (priority >= 3 \|\| due_date < now+3d)` |

Full reference: <https://vikunja.io/docs/filters>

## Installation

### Via npx

```json
{
  "mcpServers": {
    "vikunja": {
      "command": "npx",
      "args": ["-y", "@simpelekees/vikunja-mcp"],
      "env": {
        "VIKUNJA_API_BASE": "https://your.vikunja.host",
        "VIKUNJA_API_TOKEN": "tk_..."
      }
    }
  }
}
```

### Local build

```bash
git clone https://github.com/keesfluitman/vikunja-mcp && cd vikunja-mcp
pnpm install
pnpm build
```

```json
{
  "mcpServers": {
    "vikunja": {
      "command": "node",
      "args": ["/path/to/vikunja-mcp/dist/index.js"],
      "env": {
        "VIKUNJA_API_BASE": "https://your.vikunja.host",
        "VIKUNJA_API_TOKEN": "tk_..."
      }
    }
  }
}
```

`VIKUNJA_API_TOKEN` is read at process start, so rotating the token requires
restarting the MCP server (i.e. starting a new MCP client session).

## Development

```bash
pnpm typecheck
pnpm lint
pnpm build       # writes dist/
```
