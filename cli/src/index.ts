#!/usr/bin/env bun
import { Command } from 'commander';

const program = new Command();

program
  .name('claude-notify')
  .description('Slack notifications for Claude Code')
  .version('2.0.0');

program
  .command('register')
  .description('Register current session for Slack notifications')
  .option('-n, --name <name>', 'Custom instance name')
  .action((opts) => {
    console.log('TODO: implement register', opts);
  });

program
  .command('notify')
  .description('Send a Slack notification')
  .option('-m, --message <text>', 'Notification message')
  .option('-c, --context <text>', 'Additional context')
  .action((opts) => {
    console.log('TODO: implement notify', opts);
  });

program
  .command('launch')
  .description('Start Claude in a tmux session')
  .option('-n, --name <name>', 'Session name')
  .action((opts) => {
    console.log('TODO: implement launch', opts);
  });

program
  .command('remote')
  .description('Connect to remote server with session linking')
  .option('-h, --host <hostname>', 'Remote hostname')
  .option('-s, --session <name>', 'Session name')
  .option('--new', 'Create new session')
  .action((opts) => {
    console.log('TODO: implement remote', opts);
  });

program
  .command('status')
  .description('Show system status')
  .action(() => {
    console.log('TODO: implement status');
  });

program
  .command('clean')
  .description('Clean up stale sessions')
  .action(() => {
    console.log('TODO: implement clean');
  });

program.parse();
