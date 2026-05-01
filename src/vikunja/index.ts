import type { ToolHandler } from './common.js';
import projects, {
  toolDefinitions as projectToolDefinitions,
  handlers as projectHandlers,
} from './projects.js';
import tasks, {
  toolDefinitions as taskToolDefinitions,
  handlers as taskHandlers,
} from './tasks.js';
import labels, {
  toolDefinitions as labelToolDefinitions,
  handlers as labelHandlers,
} from './labels.js';
import savedFilters, {
  toolDefinitions as filterToolDefinitions,
  handlers as filterHandlers,
} from './filters.js';
import users, {
  toolDefinitions as userToolDefinitions,
  handlers as userHandlers,
} from './users.js';

export { projects, tasks, labels, savedFilters, users };
export const tools = [
  ...projectToolDefinitions,
  ...taskToolDefinitions,
  ...labelToolDefinitions,
  ...filterToolDefinitions,
  ...userToolDefinitions,
];
export const handlers: Record<string, ToolHandler> = {
  ...projectHandlers,
  ...taskHandlers,
  ...labelHandlers,
  ...filterHandlers,
  ...userHandlers,
};
