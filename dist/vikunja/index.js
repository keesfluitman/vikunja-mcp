import projects, { toolDefinitions as projectToolDefinitions, handlers as projectHandlers, } from './projects.js';
import tasks, { toolDefinitions as taskToolDefinitions, handlers as taskHandlers, } from './tasks.js';
import labels, { toolDefinitions as labelToolDefinitions, handlers as labelHandlers, } from './labels.js';
import savedFilters, { toolDefinitions as filterToolDefinitions, handlers as filterHandlers, } from './filters.js';
import users, { toolDefinitions as userToolDefinitions, handlers as userHandlers, } from './users.js';
import kanban, { toolDefinitions as kanbanToolDefinitions, handlers as kanbanHandlers, } from './kanban.js';
import teams, { toolDefinitions as teamToolDefinitions, handlers as teamHandlers, } from './teams.js';
import sharing, { toolDefinitions as sharingToolDefinitions, handlers as sharingHandlers, } from './sharing.js';
export { projects, tasks, labels, savedFilters, users, kanban, teams, sharing };
export const tools = [
    ...projectToolDefinitions,
    ...taskToolDefinitions,
    ...labelToolDefinitions,
    ...filterToolDefinitions,
    ...userToolDefinitions,
    ...kanbanToolDefinitions,
    ...teamToolDefinitions,
    ...sharingToolDefinitions,
];
export const handlers = {
    ...projectHandlers,
    ...taskHandlers,
    ...labelHandlers,
    ...filterHandlers,
    ...userHandlers,
    ...kanbanHandlers,
    ...teamHandlers,
    ...sharingHandlers,
};
