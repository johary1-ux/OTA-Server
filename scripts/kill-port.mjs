#!/usr/bin/env node
import { execSync } from 'node:child_process';

const port = process.argv[2] || process.env.PORT || '3000';

function killUnix() {
  let pids;
  try {
    pids = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    pids = [];
  }
  for (const pid of pids) {
    try {
      execSync(`kill -9 ${pid}`);
    } catch {
      // ignore — process may have already exited
    }
  }
  return pids.length;
}

function killWindows() {
  let out;
  try {
    out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
  } catch {
    return 0;
  }
  const pids = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/\s+(\d+)\s*$/);
    if (m && m[1] !== '0') pids.add(m[1]);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }
  return pids.size;
}

const killed = process.platform === 'win32' ? killWindows() : killUnix();

if (killed === 0) {
  console.log(`Port ${port} is free.`);
} else {
  console.log(`Killed ${killed} process(es) listening on port ${port}.`);
}
