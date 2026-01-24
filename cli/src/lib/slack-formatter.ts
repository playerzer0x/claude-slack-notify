/**
 * Slack Message Formatter for Claude Tool Calls
 *
 * Replaces the 150-line jq TOOL_FORMATTER with TypeScript.
 * Formats tool call information into human-readable Slack messages.
 */

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

export type ToolPrefix = '\u231B' | '\u25CF' | '\u2753'; // hourglass, bullet, question mark

/**
 * Format a tool call for Slack notification display.
 *
 * @param tool - The tool name and input parameters
 * @param prefix - Icon prefix: hourglass (pending), bullet (completed), question mark
 * @returns Formatted string for display
 */
export function formatToolCall(tool: ToolUse, prefix: ToolPrefix = '\u231B'): string {
  const { name, input } = tool;

  switch (name) {
    case 'Bash':
      return formatBash(input, prefix);
    case 'Edit':
      return formatEdit(input, prefix);
    case 'Write':
      return `${prefix} Write: ${input.file_path || ''}`;
    case 'Read':
      return formatRead(input, prefix);
    case 'Glob':
    case 'Search':
      return formatGlobSearch(name, input, prefix);
    case 'Grep':
      return formatGrep(input, prefix);
    case 'AskUserQuestion':
      return formatQuestion(input);
    case 'Task':
      return formatTask(input, prefix);
    case 'WebFetch':
      return formatWebFetch(input, prefix);
    case 'WebSearch':
      return `${prefix} WebSearch: ${input.query || ''}`;
    case 'TodoWrite':
      return formatTodoWrite(input, prefix);
    case 'NotebookEdit':
      return formatNotebookEdit(input, prefix);
    case 'Skill':
      return formatSkill(input, prefix);
    case 'EnterPlanMode':
      return `${prefix} Entering plan mode`;
    case 'ExitPlanMode':
      return `${prefix} Exiting plan mode`;
    case 'TaskCreate':
      return `${prefix} TaskCreate: ${input.subject || 'new task'}`;
    case 'TaskUpdate':
      return `${prefix} TaskUpdate: ${input.taskId || ''}${input.status ? ` \u2192 ${input.status}` : ''}`;
    case 'TaskGet':
      return `${prefix} TaskGet: ${input.taskId || ''}`;
    case 'TaskList':
      return `${prefix} TaskList`;
    case 'TaskOutput':
      return `${prefix} TaskOutput: ${input.task_id || ''}`;
    case 'KillShell':
      return `${prefix} KillShell: ${input.shell_id || ''}`;
    default:
      return formatDefault(name, input, prefix);
  }
}

function formatBash(input: Record<string, unknown>, prefix: ToolPrefix): string {
  const command = String(input.command || '');
  const firstLine = command.split('\n')[0].slice(0, 80);
  const desc = input.description ? ` (${input.description})` : '';
  return `${prefix} Bash: ${firstLine}${desc}`;
}

function formatEdit(input: Record<string, unknown>, prefix: ToolPrefix): string {
  const filePath = input.file_path || '';
  const oldString = String(input.old_string || '');
  const replacing = oldString ? ` (replacing ${oldString.slice(0, 30)}...)` : '';
  return `${prefix} Edit: ${filePath}${replacing}`;
}

function formatRead(input: Record<string, unknown>, prefix: ToolPrefix): string {
  const filePath = input.file_path || '';
  const offset = Number(input.offset || 0);
  const fromLine = offset > 0 ? ` (from line ${offset})` : '';
  return `${prefix} Read: ${filePath}${fromLine}`;
}

function formatGlobSearch(name: string, input: Record<string, unknown>, prefix: ToolPrefix): string {
  const pattern = input.pattern || '';
  const inPath = input.path ? ` in ${input.path}` : '';
  return `${prefix} ${name}: ${pattern}${inPath}`;
}

function formatGrep(input: Record<string, unknown>, prefix: ToolPrefix): string {
  const pattern = input.pattern || '';
  const inPath = input.path ? ` in ${input.path}` : '';
  return `${prefix} Grep: ${pattern}${inPath}`;
}

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  options?: QuestionOption[];
}

function formatQuestion(input: Record<string, unknown>): string {
  const questions = input.questions as Question[] | undefined;
  if (!questions?.length) return '\u2753 Question';

  const results: string[] = [];
  for (const q of questions) {
    let result = `\u2753 ${q.question}\n`;
    if (q.options?.length) {
      q.options.forEach((opt, i) => {
        const desc = opt.description ? ` - ${opt.description}` : '';
        result += `   ${i + 1}. ${opt.label}${desc}\n`;
      });
    }
    results.push(result.trim());
  }
  return results.join('\n\n');
}

function formatTask(input: Record<string, unknown>, prefix: ToolPrefix): string {
  const subagentType = input.subagent_type || 'agent';
  let content = 'running subagent';
  if (input.description) {
    content = String(input.description);
  } else if (input.prompt) {
    content = String(input.prompt).slice(0, 100);
  }
  return `${prefix} Task (${subagentType}): ${content}`;
}

function formatWebFetch(input: Record<string, unknown>, prefix: ToolPrefix): string {
  const url = input.url || '';
  const prompt = input.prompt ? `\n  Prompt: ${String(input.prompt).slice(0, 80)}` : '';
  return `${prefix} WebFetch: ${url}${prompt}`;
}

interface TodoItem {
  content?: string;
  status?: string;
}

function formatTodoWrite(input: Record<string, unknown>, prefix: ToolPrefix): string {
  const todos = (input.todos as TodoItem[] | undefined) || [];
  const inProgress = todos.filter((t) => t.status === 'in_progress');

  if (inProgress.length > 0) {
    return `${prefix} TodoWrite: Working on: ${inProgress[0].content || ''}`;
  }
  return `${prefix} TodoWrite: ${todos.length} tasks`;
}

function formatNotebookEdit(input: Record<string, unknown>, prefix: ToolPrefix): string {
  const notebookPath = input.notebook_path || '';
  const editMode = input.edit_mode ? ` (${input.edit_mode})` : '';
  return `${prefix} NotebookEdit: ${notebookPath}${editMode}`;
}

function formatSkill(input: Record<string, unknown>, prefix: ToolPrefix): string {
  const skill = input.skill || '';
  const args = input.args ? ` ${input.args}` : '';
  return `${prefix} Skill: /${skill}${args}`;
}

function formatDefault(name: string, input: Record<string, unknown>, prefix: ToolPrefix): string {
  // Browser tools
  if (name.includes('browser_navigate')) {
    return `${prefix} \uD83C\uDF10 Navigate: ${input.url || ''}`;
  }
  if (name.includes('browser_click')) {
    return `${prefix} \uD83D\uDDB1\uFE0F Click: ${input.element || 'element'}`;
  }
  if (name.includes('browser_type')) {
    const text = String(input.text || '').slice(0, 40);
    const inElement = input.element ? ` in ${input.element}` : '';
    return `${prefix} \u2328\uFE0F Type: ${text}${inElement}`;
  }
  if (name.includes('browser_snapshot')) {
    return `${prefix} \uD83D\uDCF8 Browser snapshot`;
  }
  if (name.includes('browser_take_screenshot')) {
    const element = input.element ? `: ${input.element}` : '';
    return `${prefix} \uD83D\uDCF7 Screenshot${element}`;
  }
  if (name.includes('browser_fill_form')) {
    const fields = (input.fields as unknown[]) || [];
    return `${prefix} \uD83D\uDCDD Fill form: ${fields.length} fields`;
  }
  if (name.includes('browser_select_option')) {
    const values = (input.values as string[]) || [];
    return `${prefix} \uD83D\uDCCB Select: ${values.join(', ')}`;
  }
  if (name.includes('browser_hover')) {
    return `${prefix} \uD83D\uDC46 Hover: ${input.element || 'element'}`;
  }
  if (name.includes('browser_press_key')) {
    return `${prefix} \u2328\uFE0F Press: ${input.key || 'key'}`;
  }
  if (name.includes('browser_wait_for')) {
    if (input.text) return `${prefix} \u231B Wait: "${input.text}"`;
    if (input.time) return `${prefix} \u231B Wait: ${input.time}s`;
    return `${prefix} \u231B Wait: condition`;
  }

  // MCP tools: mcp__server__tool format
  if (name.startsWith('mcp__')) {
    const parts = name.split('__').slice(1);
    const mcpName = parts.join('/');
    const params = formatMcpParams(input);
    return `${prefix} MCP: ${mcpName}${params}`;
  }

  // Generic fallback
  return formatGenericTool(name, input, prefix);
}

function formatMcpParams(input: Record<string, unknown>): string {
  const entries = Object.entries(input)
    .filter(([, v]) => v != null && v !== '')
    .slice(0, 3)
    .map(([k, v]) => `${k}=${String(v).slice(0, 20)}`);

  return entries.length > 0 ? ` (${entries.join(', ')})` : '';
}

function formatGenericTool(name: string, input: Record<string, unknown>, prefix: ToolPrefix): string {
  // Try common field patterns
  if (input.description) return `${prefix} ${name}: ${input.description}`;
  if (input.file_path) return `${prefix} ${name}: ${input.file_path}`;
  if (input.pattern) {
    const inPath = input.path ? ` in ${input.path}` : '';
    return `${prefix} ${name}: ${input.pattern}${inPath}`;
  }
  if (input.prompt) return `${prefix} ${name}: ${String(input.prompt).slice(0, 80)}`;

  // Show first few params if any
  const entries = Object.entries(input)
    .filter(([, v]) => v != null && v !== '')
    .slice(0, 2)
    .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`);

  return entries.length > 0 ? `${prefix} ${name}: ${entries.join(', ')}` : `${prefix} ${name}`;
}
