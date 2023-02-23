import { diff_match_patch, DIFF_EQUAL, DIFF_INSERT, DIFF_DELETE } from 'diff-match-patch';
import * as fs from 'fs/promises';
import * as path from 'path';
import meow from 'meow';
import chalk from 'chalk';
import inquirer from 'inquirer';

const $0 = process.argv0;
const cli = meow(
  `
Usage
 $ ${$0} <pattern> <replace> -- <...files>

Options
 --include-dirname Replace occurrences in directory names as well

Examples
 $ ${$0} '\\b(\\d+)\\b' '_$1_' -- *
 foo 01.jpg -> foo _01_.jpg
`,
  {
    importMeta: import.meta,
    flags: {
      includeDirname: {
        type: 'boolean',
      },
      lastMatch: {
        type: 'boolean',
      },
      pattern: {
        type: 'string',
        alias: 'e',
      },
      replace: {
        type: 'string',
        alias: 'r',
      },
    },
  } as const,
);
const { lastMatch } = cli.flags;
const pattern = cli.flags.pattern ?? cli.input.shift();
if (pattern == null) {
  throw new Error('specify pattern');
}
const regex = new RegExp(pattern, 'g');
const replacement = cli.flags.replace ?? cli.input.shift();
if (replacement == null) {
  throw new Error('specify replace');
}
const targets = cli.input;
if (targets[0] === '--') {
  targets.shift();
}
const operations: (() => Promise<void>)[] = [];
for (const target of targets) {
  const { dir, base } = path.parse(target);
  let replaced: string;
  regex.lastIndex = 0;
  if (lastMatch) {
    const lastMatch = [...base.matchAll(regex)].at(-1);
    if (lastMatch) {
      if (lastMatch.index === undefined) {
        throw new Error('lastMatch.index === undefined');
      }
      regex.lastIndex = lastMatch.index;
      replaced = base.replace(regex, replacement);
    } else {
      replaced = base;
    }
  } else {
    replaced = base.replace(regex, replacement);
  }
  if (base !== replaced) {
    operations.push(() => fs.rename(target, path.resolve(dir, replaced)));
    const dmp = new diff_match_patch();
    dmp.Diff_Timeout = 1; // seconds

    const diffs = dmp.diff_main(base, replaced);
    dmp.diff_cleanupSemantic(diffs);
    let output = '';
    for (const [op, data] of diffs) {
      switch (op) {
        case DIFF_EQUAL:
          output += data;
          break;
        case DIFF_INSERT:
          output += chalk.green(`\{+${data}\}`);
          break;
        case DIFF_DELETE:
          output += chalk.red(`\{-${data}\}`);
          break;
      }
    }
    console.log(path.resolve(dir, output));
  }
}
if (operations.length === 0) {
  console.log('No replacement');
} else {
  interface Answer {
    ok: boolean;
  }

  const { ok } = await inquirer.prompt<Answer>({
    type: 'confirm',
    name: 'ok',
    default: false,
    message: 'Execute?',
  } as const);
  if (ok) {
    for (const operation of operations) {
      await operation();
    }
  }
}
