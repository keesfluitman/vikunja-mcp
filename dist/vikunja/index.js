import projects, { toolDefinitions as projectToolDefinitions, handlers as projectHandlers, } from './projects.js';
import tasks, { toolDefinitions as taskToolDefinitions, handlers as taskHandlers, } from './tasks.js';
import labels, { toolDefinitions as labelToolDefinitions, handlers as labelHandlers, } from './labels.js';
import savedFilters, { toolDefinitions as filterToolDefinitions, handlers as filterHandlers, } from './filters.js';
import users, { toolDefinitions as userToolDefinitions, handlers as userHandlers, } from './users.js';
import kanban, { toolDefinitions as kanbanToolDefinitions, handlers as kanbanHandlers, } from './kanban.js';
export { projects, tasks, labels, savedFilters, users, kanban };
export const tools = [
    ...projectToolDefinitions,
    ...taskToolDefinitions,
    ...labelToolDefinitions,
    ...filterToolDefinitions,
    ...userToolDefinitions,
    ...kanbanToolDefinitions,
];
export const handlers = {
    ...projectHandlers,
    ...taskHandlers,
    ...labelHandlers,
    ...filterHandlers,
    ...userHandlers,
    ...kanbanHandlers,
};
