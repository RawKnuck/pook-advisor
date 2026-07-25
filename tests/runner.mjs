import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { pathToFileURL } from 'url';

// Load .env manually to retrieve DATABASE_URL
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      let value = parts.slice(1).join('=').trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Error: DATABASE_URL is not set in .env file or environment.');
  process.exit(1);
}

const mockGeminiPath = path.resolve(process.cwd(), 'tests/fixtures/mock-gemini.mjs');
const mockGeminiUrl = pathToFileURL(mockGeminiPath).href;
const nodeOptions = `--import ${mockGeminiUrl}`;

let serverProcess = null;

function killServer(proc) {
  if (!proc) return;
  console.log(`Killing Next.js server (PID: ${proc.pid})...`);
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${proc.pid} /T`, { stdio: 'ignore' });
    } catch {
      try {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    }
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

function cleanupAndExit(code) {
  if (serverProcess) {
    killServer(serverProcess);
    serverProcess = null;
  }
  process.exit(code);
}

process.on('SIGINT', () => {
  console.log('Received SIGINT, cleaning up...');
  cleanupAndExit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, cleaning up...');
  cleanupAndExit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  cleanupAndExit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  cleanupAndExit(1);
});

async function main() {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'npm.cmd' : 'npm';

  console.log('Starting Next.js server on port 3001...');
  serverProcess = spawn(cmd, ['run', 'dev'], {
    shell: true,
    env: {
      ...process.env,
      PORT: '3001',
      NEXTAUTH_URL: 'http://localhost:3001',
      DATABASE_URL: databaseUrl,
      NODE_OPTIONS: nodeOptions
    }
  });

  serverProcess.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      console.log(`[Next.js] ${line}`);
    }
  });

  serverProcess.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      console.error(`[Next.js Error] ${line}`);
    }
  });

  serverProcess.on('close', (code) => {
    if (code !== null && code !== 0) {
      console.error(`Next.js server exited early with code ${code}`);
      cleanupAndExit(code);
    }
  });

  const healthUrl = 'http://localhost:3001/api/auth/csrf';
  const startTime = Date.now();
  const timeoutMs = 20000;
  let healthy = false;

  console.log(`Waiting for Next.js server to become healthy at ${healthUrl}...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(healthUrl);
      if (res.status === 200) {
        healthy = true;
        break;
      }
    } catch {
      // Ignore connection errors during startup
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (!healthy) {
    console.error('Error: Next.js server failed to become healthy within 20 seconds.');
    cleanupAndExit(1);
  }

  console.log('Next.js server is healthy. Spawning test runner...');

  const testFiles = [
    'tests/e2e/tier1.test.mjs',
    'tests/e2e/tier2.test.mjs',
    'tests/e2e/tier3.test.mjs',
    'tests/e2e/tier4.test.mjs'
  ];

  let exitCode = 0;
  for (const file of testFiles) {
    console.log(`\n--- Running ${file} ---`);
    const code = await new Promise((resolve) => {
      const testRunner = spawn('node', ['--test', file], {
        stdio: 'inherit',
        env: process.env
      });

      testRunner.on('error', (err) => {
        console.error(`Failed to start test runner for ${file}:`, err);
        resolve(1);
      });

      testRunner.on('close', (code) => {
        resolve(code ?? 0);
      });
    });
    if (code !== 0) {
      exitCode = code;
    }
  }

  console.log(`\nAll tests completed. Combined exit code: ${exitCode}`);
  cleanupAndExit(exitCode);
}

main().catch((err) => {
  console.error('Runner main execution failed:', err);
  cleanupAndExit(1);
});
