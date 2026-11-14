// Validation only: no model call, persistence, state transitions or execution.
const TASK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_TASKS = 100;
const MAX_DEPENDENCIES = 50;

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function hasOnly(value, keys) { return Object.keys(value).every(key => keys.includes(key)); }

export function validatePlanProposal(proposal, { stored = false } = {}) {
  const invalid = path => ({ valid: false, issue: path });
  if (!record(proposal) || !hasOnly(proposal, ['project_version', 'tasks'])) return invalid('proposal');
  if (!Number.isSafeInteger(proposal.project_version) || proposal.project_version < 1 || proposal.project_version > 2147483647) return invalid('project_version');
  if (!Array.isArray(proposal.tasks) || proposal.tasks.length < 1 || proposal.tasks.length > MAX_TASKS) return invalid('tasks');
  const byId = new Map();
  for (let i = 0; i < proposal.tasks.length; i++) {
    const task = proposal.tasks[i], path = `tasks[${i}]`;
    if (!record(task) || !hasOnly(task, ['id', 'title', 'weight', 'depends_on'])) return invalid(path);
    if (typeof task.id !== 'string' || !TASK_ID.test(task.id) || byId.has(task.id)) return invalid(`${path}.id`);
    if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 200 ||
        !task.title.isWellFormed() || task.title.includes('\u0000')) return invalid(`${path}.title`);
    if (!Number.isSafeInteger(task.weight) || task.weight < 1 || task.weight > 1000) return invalid(`${path}.weight`);
    if (!Array.isArray(task.depends_on) || task.depends_on.length > MAX_DEPENDENCIES ||
        task.depends_on.some(id => typeof id !== 'string' || !TASK_ID.test(id)) ||
        new Set(task.depends_on).size !== task.depends_on.length) return invalid(`${path}.depends_on`);
    byId.set(task.id, task);
  }
  // Writes leave room for PostgreSQL JSONB formatting. Direct RPC callers can
  // store larger valid documents, so reads must accept the database limit.
  if (Buffer.byteLength(JSON.stringify(proposal.tasks), 'utf8') > (stored ? 64000 : 55000)) return invalid('tasks');
  for (let i = 0; i < proposal.tasks.length; i++) {
    const task = proposal.tasks[i];
    if (task.depends_on.some(id => id === task.id || !byId.has(id))) return invalid(`tasks[${i}].depends_on`);
  }
  // Stable Kahn topological order: input order breaks ties, never inventing tasks.
  const visited = new Set(), order = [];
  while (order.length < proposal.tasks.length) {
    const next = proposal.tasks.find(task => !visited.has(task.id) && task.depends_on.every(id => visited.has(id)));
    if (!next) return invalid('tasks.cycle');
    visited.add(next.id); order.push(next.id);
  }
  return { valid: true, project_version: proposal.project_version, task_count: proposal.tasks.length,
    total_weight: proposal.tasks.reduce((sum, task) => sum + task.weight, 0), topological_order: order };
}
