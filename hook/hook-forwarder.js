#!/usr/bin/env node
// FlowLens hook forwarder. Claude Code runs this for each configured hook event.
// Contract: never print anything, never block, ALWAYS exit 0 — the agent must not notice us.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;

/** Must match src/capture/discovery.ts. */
function normalizeDir(p) {
  let s = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') s = s.toLowerCase();
  return s || '/';
}
function discoveryPath(dir) {
  const hash = crypto.createHash('sha256').update(normalizeDir(dir)).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'flowlens', hash + '.json');
}
/** Nearest ancestor of `dir` (inclusive) with a running FlowLens window. */
function findServer(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    try {
      return JSON.parse(fs.readFileSync(discoveryPath(d), 'utf8'));
    } catch {
      /* keep walking */
    }
    if (path.dirname(d) === d) return null;
  }
}

function main() {
  setTimeout(() => process.exit(0), 700).unref();
  const chunks = [];
  let size = 0;
  process.stdin.on('data', (c) => {
    size += c.length;
    if (size > MAX_BYTES) process.exit(0);
    chunks.push(c);
  });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    try {
      const body = Buffer.concat(chunks);
      const payload = JSON.parse(body.toString('utf8'));
      const server = findServer(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
      if (!server || !server.port || !server.token) process.exit(0);
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server.port,
          path: '/hook',
          method: 'POST',
          timeout: 400,
          headers: {
            'content-type': 'application/json',
            'content-length': body.length,
            'x-flowlens-token': server.token,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => process.exit(0));
        },
      );
      req.on('error', () => process.exit(0));
      req.on('timeout', () => process.exit(0));
      req.end(body);
    } catch {
      process.exit(0);
    }
  });
}

if (require.main === module) main();
module.exports = { normalizeDir, discoveryPath };
