/**
 * Unit tests for slack-formatter.ts
 */

import { describe, expect, test } from 'bun:test';
import { formatToolCall, type ToolUse, type ToolPrefix } from './slack-formatter';

// The code uses U+231B (⌛) as the hourglass
const HOURGLASS = '⌛';
const BULLET = '●';
const QUESTION = '❓';

describe('formatToolCall', () => {
  describe('Bash tool', () => {
    test('formats simple command', () => {
      const tool: ToolUse = { name: 'Bash', input: { command: 'ls -la' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Bash: ls -la`);
    });

    test('formats command with description', () => {
      const tool: ToolUse = {
        name: 'Bash',
        input: { command: 'git status', description: 'Check git status' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Bash: git status (Check git status)`);
    });

    test('truncates multiline command to first line', () => {
      const tool: ToolUse = {
        name: 'Bash',
        input: { command: 'echo "line1"\necho "line2"\necho "line3"' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Bash: echo "line1"`);
    });

    test('uses custom prefix', () => {
      const tool: ToolUse = { name: 'Bash', input: { command: 'npm test' } };
      expect(formatToolCall(tool, BULLET)).toBe(`${BULLET} Bash: npm test`);
    });
  });

  describe('Edit tool', () => {
    test('formats file path', () => {
      const tool: ToolUse = { name: 'Edit', input: { file_path: '/src/index.ts' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Edit: /src/index.ts`);
    });

    test('shows truncated old_string', () => {
      const tool: ToolUse = {
        name: 'Edit',
        input: {
          file_path: '/src/index.ts',
          old_string: 'function longFunctionName() {\n  return something;\n}',
        },
      };
      // The code slices first 30 chars which includes the newline
      expect(formatToolCall(tool)).toContain(`${HOURGLASS} Edit: /src/index.ts (replacing function longFunctionName()`);
    });
  });

  describe('Write tool', () => {
    test('formats file path', () => {
      const tool: ToolUse = { name: 'Write', input: { file_path: '/new-file.ts' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Write: /new-file.ts`);
    });
  });

  describe('Read tool', () => {
    test('formats file path', () => {
      const tool: ToolUse = { name: 'Read', input: { file_path: '/config.json' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Read: /config.json`);
    });

    test('shows offset when present', () => {
      const tool: ToolUse = {
        name: 'Read',
        input: { file_path: '/large-file.ts', offset: 100 },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Read: /large-file.ts (from line 100)`);
    });
  });

  describe('Glob tool', () => {
    test('formats pattern', () => {
      const tool: ToolUse = { name: 'Glob', input: { pattern: '**/*.ts' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Glob: **/*.ts`);
    });

    test('shows path when present', () => {
      const tool: ToolUse = {
        name: 'Glob',
        input: { pattern: '*.json', path: '/src' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Glob: *.json in /src`);
    });
  });

  describe('Grep tool', () => {
    test('formats pattern', () => {
      const tool: ToolUse = { name: 'Grep', input: { pattern: 'TODO' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Grep: TODO`);
    });

    test('shows path when present', () => {
      const tool: ToolUse = {
        name: 'Grep',
        input: { pattern: 'FIXME', path: '/src/lib' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Grep: FIXME in /src/lib`);
    });
  });

  describe('AskUserQuestion tool', () => {
    test('formats single question', () => {
      const tool: ToolUse = {
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Which approach?',
              options: [
                { label: 'Option A', description: 'First approach' },
                { label: 'Option B', description: 'Second approach' },
              ],
            },
          ],
        },
      };
      const result = formatToolCall(tool);
      expect(result).toContain(`${QUESTION} Which approach?`);
      expect(result).toContain('1. Option A - First approach');
      expect(result).toContain('2. Option B - Second approach');
    });

    test('handles empty questions', () => {
      const tool: ToolUse = { name: 'AskUserQuestion', input: { questions: [] } };
      expect(formatToolCall(tool)).toBe(`${QUESTION} Question`);
    });

    test('handles missing questions', () => {
      const tool: ToolUse = { name: 'AskUserQuestion', input: {} };
      expect(formatToolCall(tool)).toBe(`${QUESTION} Question`);
    });
  });

  describe('Task tool', () => {
    test('formats with subagent type and description', () => {
      const tool: ToolUse = {
        name: 'Task',
        input: { subagent_type: 'Explore', description: 'Find config files' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Task (Explore): Find config files`);
    });

    test('uses prompt when no description', () => {
      const tool: ToolUse = {
        name: 'Task',
        input: { subagent_type: 'Plan', prompt: 'Create implementation plan for feature X' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Task (Plan): Create implementation plan for feature X`);
    });
  });

  describe('WebFetch tool', () => {
    test('formats URL', () => {
      const tool: ToolUse = { name: 'WebFetch', input: { url: 'https://example.com' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} WebFetch: https://example.com`);
    });

    test('shows prompt when present', () => {
      const tool: ToolUse = {
        name: 'WebFetch',
        input: { url: 'https://docs.example.com', prompt: 'Extract API reference' },
      };
      expect(formatToolCall(tool)).toContain(`${HOURGLASS} WebFetch: https://docs.example.com`);
      expect(formatToolCall(tool)).toContain('Prompt: Extract API reference');
    });
  });

  describe('WebSearch tool', () => {
    test('formats query', () => {
      const tool: ToolUse = { name: 'WebSearch', input: { query: 'typescript best practices' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} WebSearch: typescript best practices`);
    });
  });

  describe('TodoWrite tool', () => {
    test('formats in-progress task', () => {
      const tool: ToolUse = {
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Task 1', status: 'completed' },
            { content: 'Task 2', status: 'in_progress' },
          ],
        },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} TodoWrite: Working on: Task 2`);
    });

    test('shows count when no in-progress', () => {
      const tool: ToolUse = {
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Task 1', status: 'pending' },
            { content: 'Task 2', status: 'pending' },
          ],
        },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} TodoWrite: 2 tasks`);
    });
  });

  describe('NotebookEdit tool', () => {
    test('formats notebook path', () => {
      const tool: ToolUse = {
        name: 'NotebookEdit',
        input: { notebook_path: '/analysis.ipynb' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} NotebookEdit: /analysis.ipynb`);
    });

    test('shows edit mode', () => {
      const tool: ToolUse = {
        name: 'NotebookEdit',
        input: { notebook_path: '/analysis.ipynb', edit_mode: 'insert' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} NotebookEdit: /analysis.ipynb (insert)`);
    });
  });

  describe('Skill tool', () => {
    test('formats skill name', () => {
      const tool: ToolUse = { name: 'Skill', input: { skill: 'commit' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Skill: /commit`);
    });

    test('shows args', () => {
      const tool: ToolUse = { name: 'Skill', input: { skill: 'review-pr', args: '123' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Skill: /review-pr 123`);
    });
  });

  describe('Plan mode tools', () => {
    test('formats EnterPlanMode', () => {
      const tool: ToolUse = { name: 'EnterPlanMode', input: {} };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Entering plan mode`);
    });

    test('formats ExitPlanMode', () => {
      const tool: ToolUse = { name: 'ExitPlanMode', input: {} };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} Exiting plan mode`);
    });
  });

  describe('Task management tools', () => {
    test('formats TaskCreate', () => {
      const tool: ToolUse = { name: 'TaskCreate', input: { subject: 'Add tests' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} TaskCreate: Add tests`);
    });

    test('formats TaskUpdate', () => {
      const tool: ToolUse = {
        name: 'TaskUpdate',
        input: { taskId: '123', status: 'completed' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} TaskUpdate: 123 → completed`);
    });

    test('formats TaskGet', () => {
      const tool: ToolUse = { name: 'TaskGet', input: { taskId: '456' } };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} TaskGet: 456`);
    });

    test('formats TaskList', () => {
      const tool: ToolUse = { name: 'TaskList', input: {} };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} TaskList`);
    });
  });

  describe('Browser tools', () => {
    test('formats browser_navigate', () => {
      const tool: ToolUse = {
        name: 'mcp__browser__browser_navigate',
        input: { url: 'https://example.com' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} 🌐 Navigate: https://example.com`);
    });

    test('formats browser_click', () => {
      const tool: ToolUse = {
        name: 'mcp__browser__browser_click',
        input: { element: 'Submit button' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} 🖱️ Click: Submit button`);
    });

    test('formats browser_type', () => {
      const tool: ToolUse = {
        name: 'mcp__browser__browser_type',
        input: { text: 'Hello world', element: 'search input' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} ⌨️ Type: Hello world in search input`);
    });

    test('formats browser_snapshot', () => {
      const tool: ToolUse = { name: 'mcp__browser__browser_snapshot', input: {} };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} 📸 Browser snapshot`);
    });

    test('formats browser_take_screenshot', () => {
      const tool: ToolUse = {
        name: 'mcp__browser__browser_take_screenshot',
        input: { element: 'header' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} 📷 Screenshot: header`);
    });
  });

  describe('MCP tools', () => {
    test('formats generic MCP tool', () => {
      const tool: ToolUse = {
        name: 'mcp__custom-server__custom_tool',
        input: { param1: 'value1', param2: 'value2' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} MCP: custom-server/custom_tool (param1=value1, param2=value2)`);
    });
  });

  describe('Unknown tools', () => {
    test('formats unknown tool with description', () => {
      const tool: ToolUse = {
        name: 'CustomTool',
        input: { description: 'Do something' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} CustomTool: Do something`);
    });

    test('formats unknown tool with file_path', () => {
      const tool: ToolUse = {
        name: 'CustomTool',
        input: { file_path: '/path/to/file' },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} CustomTool: /path/to/file`);
    });

    test('formats unknown tool with generic params', () => {
      const tool: ToolUse = {
        name: 'CustomTool',
        input: { foo: 'bar', baz: 123 },
      };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} CustomTool: foo=bar, baz=123`);
    });

    test('formats unknown tool with no params', () => {
      const tool: ToolUse = { name: 'CustomTool', input: {} };
      expect(formatToolCall(tool)).toBe(`${HOURGLASS} CustomTool`);
    });
  });

  describe('Prefix variations', () => {
    const tool: ToolUse = { name: 'Read', input: { file_path: '/test.ts' } };

    test('uses hourglass prefix by default', () => {
      expect(formatToolCall(tool)).toMatch(/^⌛/);
    });

    test('uses bullet prefix', () => {
      expect(formatToolCall(tool, BULLET)).toMatch(/^●/);
    });

    test('uses question prefix', () => {
      expect(formatToolCall(tool, QUESTION)).toMatch(/^❓/);
    });
  });
});
