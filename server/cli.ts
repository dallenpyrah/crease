#!/usr/bin/env node

import { resolve } from 'node:path';

const help = `Usage: creasekit [--cwd <project-directory>]

Start the creasekit MCP server for a project using the creasekit Vite plugin.

Setup:
  1. Start the project's Vite dev server with the creasekit plugin.
  2. Configure your MCP client to run creasekit --cwd /path/to/project.

Options:
  --cwd <project-directory>  Run from a project directory.
  --help, -h                 Show this help.
`;

type Command =
  | { readonly kind: 'help' }
  | { readonly kind: 'start'; readonly cwd: string | undefined }
  | { readonly kind: 'error'; readonly message: string };

const parseArguments = (arguments_: ReadonlyArray<string>): Command => {
  let cwd: string | undefined;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help' || argument === '-h') {
      if (arguments_.length > 1) {
        return {
          kind: 'error',
          message: 'Help cannot be combined with other arguments',
        };
      }
      return { kind: 'help' };
    }

    if (argument === '--cwd') {
      if (cwd !== undefined) {
        return { kind: 'error', message: '--cwd may only be provided once' };
      }
      const directory = arguments_[index + 1];
      if (directory === undefined || directory === '' || directory.startsWith('-')) {
        return {
          kind: 'error',
          message: '--cwd requires a project directory',
        };
      }
      cwd = directory;
      index += 1;
      continue;
    }

    return { kind: 'error', message: 'Unsupported argument' };
  }

  return { kind: 'start', cwd };
};

const writeError = (message: string): void => {
  process.stderr.write(`creasekit: ${message}\nUse "creasekit --help" for usage.\n`);
};

const main = async (): Promise<void> => {
  const command = parseArguments(process.argv.slice(2));
  if (command.kind === 'help') {
    process.stdout.write(help);
    return;
  }
  if (command.kind === 'error') {
    writeError(command.message);
    process.exitCode = 1;
    return;
  }

  if (command.cwd !== undefined) {
    try {
      process.chdir(resolve(command.cwd));
    } catch {
      writeError('Unable to use the project directory');
      process.exitCode = 1;
      return;
    }
  }

  await import('./mcp');
};

await main();
