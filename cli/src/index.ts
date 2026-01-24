#!/usr/bin/env bun
import { Command } from 'commander';

import {
  cleanCommand,
  launchCommand,
  notifyCommand,
  registerCommand,
  remoteCommand,
  statusCommand,
} from './commands/index.js';

const program = new Command();

program
  .name('claude-notify')
  .description('Slack notifications for Claude Code')
  .version('1.1.0');

program
  .command('register')
  .description('Register current session for Slack notifications')
  .option('-n, --name <name>', 'Custom instance name')
  .action(async (opts) => {
    await registerCommand({ name: opts.name });
  });

program
  .command('notify')
  .description('Send a Slack notification')
  .option('-m, --message <text>', 'Notification message')
  .option('-c, --context <text>', 'Additional context')
  .option('-s, --status <status>', 'Status: started, waiting, error, completed', 'waiting')
  .action(async (opts) => {
    await notifyCommand({
      message: opts.message,
      context: opts.context,
      status: opts.status,
    });
  });

program
  .command('launch')
  .description('Start Claude in a tmux session')
  .option('-n, --name <name>', 'Session name')
  .action(async (opts) => {
    await launchCommand({ name: opts.name });
  });

program
  .command('remote')
  .description('Connect to remote server with session linking')
  .argument('[hostname]', 'Remote hostname')
  .option('-s, --session <name>', 'Session name')
  .option('--new', 'Create new session')
  .action(async (hostname, opts) => {
    await remoteCommand({
      host: hostname || opts.host,
      session: opts.session,
      new: opts.new,
    });
  });

program
  .command('status')
  .description('Show system status')
  .action(async () => {
    await statusCommand();
  });

program
  .command('clean')
  .description('Clean up stale sessions')
  .option('--sessions', 'Only clean sessions')
  .option('--links', 'Only clean links')
  .action((opts) => {
    cleanCommand({
      sessions: opts.sessions,
      links: opts.links,
    });
  });

program.parse();
