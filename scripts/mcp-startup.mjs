#!/usr/bin/env node

import { spawn } from 'node:child_process';

const binary = process.argv[2];
if (!binary) {
	console.error('usage: mcp-startup.mjs PATH_TO_INKFINITE_MCP');
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
	if (!ready && output.includes('\n')) {
		ready = true;
		clearTimeout(timer);
		child.kill('SIGTERM');
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
