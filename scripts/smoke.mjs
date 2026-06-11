// Live integration smoke test for the kanban + move tools.
//
// Drives the *built* MCP handlers (dist/) against a real Vikunja instance,
// creating and then deleting a throwaway task so it leaves no residue. This is
// NOT wired into CI — it needs live credentials and mutates real data. Run it
// by hand after a build:
//
//   VIKUNJA_API_BASE=https://vikunja.example VIKUNJA_API_TOKEN=tk_... \
//   VIKUNJA_SMOKE_PROJECT=19 node scripts/smoke.mjs
//
// Exits non-zero on the first failed step.
import { handlers } from '../dist/vikunja/index.js';

const PROJECT = Number(process.env.VIKUNJA_SMOKE_PROJECT || 19);
const OTHER_PROJECT = Number(process.env.VIKUNJA_SMOKE_OTHER_PROJECT || 4);

if (!process.env.VIKUNJA_API_BASE || !process.env.VIKUNJA_API_TOKEN) {
  console.error('Set VIKUNJA_API_BASE and VIKUNJA_API_TOKEN');
  process.exit(2);
}

let passed = 0;
const call = async (name, args) => {
  const res = await handlers[name]({ params: { name, arguments: args } });
  const text = (res.content || []).map(c => c.text).join('\n');
  if (res.isError) throw new Error(`${name} failed: ${text}`);
  return text;
};
const step = async (label, fn) => {
  try {
    const out = await fn();
    console.log(`PASS  ${label}`);
    passed++;
    return out;
  } catch (e) {
    console.error(`FAIL  ${label}\n      ${e.message}`);
    process.exit(1);
  }
};
// Pull the last JSON blob out of a handler's text response.
const lastJson = text => {
  const start = text.indexOf('{', text.lastIndexOf('\n['));
  const m = text.match(/[[{][\s\S]*$/);
  return JSON.parse(m ? m[0] : text.slice(start));
};

let viewId, doneBucketId, taskId, newBucketId;

await step('list_project_views finds a kanban view', async () => {
  const text = await call('list_project_views', { projectId: PROJECT });
  const views = lastJson(text);
  const kanban = views.find(v => v.view_kind === 'kanban');
  if (!kanban) throw new Error('no kanban view on project');
  viewId = kanban.id;
  doneBucketId = kanban.done_bucket_id;
  return `viewId=${viewId} doneBucket=${doneBucketId}`;
});

await step('list_buckets returns columns', async () => {
  const buckets = lastJson(await call('list_buckets', { projectId: PROJECT, viewId }));
  if (!Array.isArray(buckets) || buckets.length === 0) throw new Error('no buckets');
  return `${buckets.length} bucket(s)`;
});

await step('create_task (throwaway)', async () => {
  const t = lastJson(
    await call('create_task', {
      projectId: PROJECT,
      task: { title: '__mcp_smoke_DELETEME' },
    }),
  );
  taskId = t.id;
  return `taskId=${taskId}`;
});

await step('create_bucket', async () => {
  const b = lastJson(
    await call('create_bucket', { projectId: PROJECT, viewId, title: '__smoke_col' }),
  );
  newBucketId = b.id;
  return `bucketId=${newBucketId}`;
});

await step('update_bucket (rename, preserve position)', async () => {
  const b = lastJson(
    await call('update_bucket', {
      projectId: PROJECT,
      viewId,
      bucketId: newBucketId,
      title: '__smoke_col_renamed',
    }),
  );
  if (b.title !== '__smoke_col_renamed') throw new Error('title not updated');
});

await step('move_task_to_bucket', async () =>
  call('move_task_to_bucket', {
    projectId: PROJECT,
    viewId,
    bucketId: newBucketId,
    taskId,
  }),
);

await step('move_task to another project', async () => {
  const t = lastJson(await call('move_task', { taskId, projectId: OTHER_PROJECT }));
  if (t.project_id !== OTHER_PROJECT) throw new Error(`project_id=${t.project_id}`);
  if (t.title !== '__mcp_smoke_DELETEME') throw new Error('title was clobbered');
});

await step('delete_bucket', async () =>
  call('delete_bucket', { projectId: PROJECT, viewId, bucketId: newBucketId }),
);

await step('cleanup: delete throwaway task', async () =>
  call('delete_task', { taskId }),
);

console.log(`\nAll ${passed} steps passed.`);
