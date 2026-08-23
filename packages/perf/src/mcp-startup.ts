#!/usr/bin/env node
// @ts-nocheck

import { spawn } from 'node:child_process';

const binary = process.argv[2];
if (!binary) {
	console.error('usage: mcp-startup.js PATH_TO_INKFINITE_MCP');
	process.exit(2);
}

const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
let ready = false;
let output = '';
const timer = setTimeout(() => {
	child.kill('SIGTERM');
	console.error('MCP server did not answer initialize within 10 seconds');
	process.exit(1);
}, 10_000);

child.stdout.on('data', (chunk) => {
	output += chunk.toString();
	const newline = output.indexOf('\n');
	if (ready || newline < 0) return;

	try {
		const response = JSON.parse(output.slice(0, newline));
		if (response.jsonrpc !== '2.0' || response.id !== 1 || !response.result) {
			throw new Error('invalid initialize response');
		}
		ready = true;
		clearTimeout(timer);
		child.kill('SIGTERM');
	} catch (error) {
		clearTimeout(timer);
		child.kill('SIGTERM');
		console.error(`MCP server returned an invalid initialize response: ${error.message}`);
		process.exit(1);
	}
});
child.on('error', (error) => {
	clearTimeout(timer);
	console.error(error.message);
	process.exit(1);
});
child.on('close', (code, signal) => {
	clearTimeout(timer);
	if (ready && (code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL')) {
		process.exit(0);
	}
	console.error(`MCP server exited before initialize (code=${code}, signal=${signal})`);
	process.exit(1);
});

child.stdin.end(
	`${JSON.stringify({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'inkfinite-performance', version: '1' }
		}
	})}\n`
);
