#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from '@bomb.sh/args';
import * as clack from '@clack/prompts';
import chalk from 'chalk';

const directory = dirname(fileURLToPath(import.meta.url));
const commands = {
	capture: {
		label: 'Renderer traversal',
		script: 'capture-performance.mjs',
		description: 'Measure renderer traversal with the no-op canvas harness',
		options: ['profile', 'size', 'output']
	},
	process: {
		label: 'Process measurements',
		script: 'measure-process.mjs',
		description: 'Measure complete CLI and MCP process latency with hyperfine',
		options: ['profile', 'all-profiles', 'size', 'all-sizes', 'warmups', 'samples', 'output', 'keep-temp']
	},
	browser: {
		label: 'Browser measurements',
		script: 'measure-browser.mjs',
		description: 'Measure production editor interactions and browser memory',
		options: [
			'profile',
			'all-profiles',
			'size',
			'all-sizes',
			'workload',
			'samples',
			'warmups',
			'output',
			'trace-dir',
			'traces',
			'memory',
			'port'
		]
	},
	profile: {
		label: 'Native profile',
		script: 'profile-native.mjs',
		description: 'Record one focused native Criterion benchmark with samply',
		options: ['filter', 'output']
	}
} as const;

type CommandName = keyof typeof commands;

function main(argv: string[]): void {
	const commandName = argv.find((argument) => !argument.startsWith('-'));
	if (!commandName) {
		printMainHelp();
		return;
	}
	if (!isCommandName(commandName)) throw new Error(`Unknown command: ${commandName}`);

	const commandIndex = argv.indexOf(commandName);
	const commandArguments = argv.slice(commandIndex + 1).filter((argument) => argument !== '--');
	const parsed = parse(commandArguments, { boolean: 'help', alias: { h: 'help' } });
	if (parsed.help) {
		printCommandHelp(commandName);
		return;
	}
	validateOptions(commandName, commandArguments);
	run(commands[commandName], commandArguments);
}

function isCommandName(value: string): value is CommandName {
	return value in commands;
}

function validateOptions(commandName: CommandName, argv: string[]): void {
	const allowed = new Set<string>([...commands[commandName].options, 'help']);
	for (const argument of argv) {
		if (!argument.startsWith('-')) continue;
		if (argument === '-h') continue;
		if (!argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`);
		const name = argument.slice(2).split('=', 1)[0].replace(/^no-/, '');
		if (!allowed.has(name)) throw new Error(`Unknown option: --${name}`);
	}
}

function run(command: (typeof commands)[CommandName], args: string[]): void {
	clack.intro(chalk.inverse(` Inkfinite performance · ${command.label} `));
	clack.log.info(chalk.dim(`node ${command.script} ${args.join(' ')}`));
	const result = spawnSync(process.execPath, [join(directory, command.script), ...args], { stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		clack.cancel(`${command.label} failed with exit code ${result.status ?? 'unknown'}.`);
		process.exitCode = result.status ?? 1;
		return;
	}
	clack.outro(chalk.green(`${command.label} complete.`));
}

function printMainHelp(): void {
	console.log(`${chalk.bold('inkfinite-perf')} ${chalk.dim('<command> [options]')}

Measure and profile Inkfinite performance.

${chalk.bold('Commands')}
${Object.entries(commands)
	.map(([name, command]) => `  ${chalk.cyan(name.padEnd(9))} ${command.description}`)
	.join('\n')}

Run ${chalk.cyan('inkfinite-perf <command> --help')} for command options.`);
}

function printCommandHelp(commandName: CommandName): void {
	const command = commands[commandName];
	console.log(`${chalk.bold(`inkfinite-perf ${commandName}`)} ${chalk.dim('[options]')}

${command.description}.

${chalk.bold('Options')}
${optionHelp[commandName].map(([flag, description]) => `  ${chalk.cyan(flag.padEnd(24))} ${description}`).join('\n')}
  ${chalk.cyan('-h, --help'.padEnd(24))} Show this help.`);
}

const optionHelp: Record<CommandName, ReadonlyArray<readonly [string, string]>> = {
	capture: [
		['--profile <id>', 'Corpus profile.'],
		['--size <count>', 'Shape count.'],
		['--output <path>', 'Summary JSON path.']
	],
	process: [
		['--profile <id>', 'Corpus profile; repeatable.'],
		['--all-profiles', 'Measure every corpus profile.'],
		['--size <count>', 'Shape count; repeatable.'],
		['--all-sizes', 'Measure every corpus size.'],
		['--warmups <count>', 'Warmup runs.'],
		['--samples <count>', 'Measured runs.'],
		['--output <path>', 'Summary JSON path.'],
		['--keep-temp', 'Keep generated benchmark files.']
	],
	browser: [
		['--profile <id>', 'Corpus profile; repeatable.'],
		['--all-profiles', 'Measure every corpus profile.'],
		['--size <count>', 'Shape count; repeatable.'],
		['--all-sizes', 'Measure every corpus size.'],
		['--workload <name>', 'Workload; repeatable or comma-separated.'],
		['--samples <count>', 'Measured samples per workload.'],
		['--warmups <count>', 'Warmup samples per workload.'],
		['--output <path>', 'Summary JSON path.'],
		['--trace-dir <path>', 'Diagnostic trace directory.'],
		['--no-traces', 'Disable diagnostic Chrome traces.'],
		['--memory', 'Run the 10,000-shape heap workload.'],
		['--port <port>', 'Vite server port.']
	],
	profile: [
		['--filter <pattern>', 'Criterion benchmark filter.'],
		['--output <path>', 'Samply profile path.']
	]
};

try {
	main(process.argv.slice(2));
} catch (error) {
	clack.log.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
