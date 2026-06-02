// Pi-target implementation of the deploy interface.
//
// Same shape as wrangler.mjs's pagesDeploy(dir, branch, { onLog }):
//   - production branch → port 8080, service qrinfo-serve
//   - staging branch    → port 8081, service qrinfo-staging
//
// Mechanism: ssh + tar to push the code tree and the dist dir, then pm2
// restart the per-branch service with SERVE_DIST + SERVE_PORT in its env.
//
// Auth: relies on ssh-agent having the key authorised on the Pi as
// $PI_SSH_HOST (e.g. claudeuser@192.168.148.4). No password prompts.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC = resolve(__dirname, '../..');

const HOST = process.env.PI_SSH_HOST;
const REMOTE_ROOT = process.env.PI_REMOTE_ROOT || '/home/claudeuser/qrinfo';
const PORTS = {
  production: Number(process.env.PI_PROD_PORT || 8080),
  staging: Number(process.env.PI_STAGING_PORT || 8081),
};
const SERVICES = {
  production: process.env.PI_PROD_SERVICE || 'qrinfo-serve',
  staging: process.env.PI_STAGING_SERVICE || 'qrinfo-staging',
};

function requireHost() {
  if (!HOST) {
    throw Object.assign(
      new Error('PI_SSH_HOST not set (e.g. claudeuser@192.168.148.4)'),
      { status: 500 },
    );
  }
}

function hostnameOnly() {
  const h = HOST.includes('@') ? HOST.split('@')[1] : HOST;
  return h.split(':')[0];
}

function shortStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

export async function pagesDeploy(distDir, branch, { onLog = () => {} } = {}) {
  requireHost();
  if (!(branch in PORTS)) {
    throw new Error(`pi-deploy: unknown branch "${branch}" (expected production or staging)`);
  }

  const port = PORTS[branch];
  const service = SERVICES[branch];
  const remoteCodeDir = `${REMOTE_ROOT}/static`;
  const remoteDistDir = `${REMOTE_ROOT}/dist-${branch}`;
  const remoteServe = `${remoteCodeDir}/admin/lib/serve.mjs`;

  onLog(`[pi] host=${HOST} branch=${branch} port=${port} service=${service}`);
  onLog(`[pi] remote code=${remoteCodeDir} dist=${remoteDistDir}`);

  // 1. Sync code (admin/, package.json, etc.) — needed so serve.mjs picks up
  //    any local changes. Cheap; tar is small.
  await tarToRemote(STATIC, remoteCodeDir, {
    excludes: ['node_modules', 'dist', '.env', '.env.local', 'qr'],
    onLog,
  });

  // 2. Replace remote dist for this branch
  await replaceRemoteDir(remoteDistDir, distDir, onLog);

  // 3. Install deps on Pi if missing (idempotent)
  await runSsh(
    `[ -d "${remoteCodeDir}/node_modules" ] || ( cd "${remoteCodeDir}" && npm install --omit=dev )`,
    onLog,
  );

  // 4. pm2 ensure / restart with the right SERVE_DIST + SERVE_PORT
  await pm2Ensure(service, remoteServe, remoteCodeDir, port, remoteDistDir, branch, onLog);

  // 5. Persist pm2 dump so the service comes back after a reboot
  await runSsh('pm2 save', onLog);

  // 6. Smoke test
  const url = `http://${hostnameOnly()}:${port}`;
  await smokeTest(url, onLog);

  return {
    id: `pi-${branch}-${shortStamp()}`,
    url,
    stdout: '',
    stderr: '',
  };
}

async function replaceRemoteDir(remoteDir, localDir, onLog) {
  await runSsh(`rm -rf "${remoteDir}" && mkdir -p "${remoteDir}"`, onLog);
  await tarToRemote(localDir, remoteDir, { excludes: [], onLog });
}

function buildTarArgs(localDir, excludes) {
  const args = [];
  for (const ex of excludes) args.push('--exclude', ex);
  args.push('-cf', '-', '-C', localDir, '.');
  return args;
}

async function tarToRemote(localDir, remoteDir, { excludes = [], onLog }) {
  onLog(`[pi] tar ${localDir} → ${HOST}:${remoteDir}`);
  // Ensure remote dir exists
  await runSsh(`mkdir -p "${remoteDir}"`, onLog);

  return new Promise((resolve, reject) => {
    const tar = spawn('tar', buildTarArgs(localDir, excludes), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ssh = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', HOST, `cd "${remoteDir}" && tar -xf -`],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    tar.stdout.pipe(ssh.stdin);

    let tarErr = '';
    let sshErr = '';
    tar.stderr.on('data', d => { tarErr += d.toString(); });
    ssh.stderr.on('data', d => { sshErr += d.toString(); });

    let tarDone = false;
    let sshDone = false;
    function checkDone() {
      if (!tarDone || !sshDone) return;
      if (tarErr.trim()) onLog(`  tar: ${tarErr.trim()}`);
      if (sshErr.trim()) onLog(`  ssh: ${sshErr.trim()}`);
      resolve();
    }
    tar.on('close', code => {
      tarDone = true;
      if (code !== 0) return reject(new Error(`tar exited ${code}: ${tarErr.trim()}`));
      checkDone();
    });
    ssh.on('close', code => {
      sshDone = true;
      if (code !== 0) return reject(new Error(`ssh tar-extract exited ${code}: ${sshErr.trim()}`));
      checkDone();
    });
    tar.on('error', reject);
    ssh.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error('ssh not installed locally; install openssh-client'));
      } else {
        reject(err);
      }
    });
  });
}

async function pm2Ensure(name, scriptPath, cwd, port, distPath, branch, onLog) {
  // pm2 jlist (json output) tells us whether the service already exists
  const list = await runSshCapture('pm2 jlist 2>/dev/null || echo "[]"', onLog);
  let services = [];
  try { services = JSON.parse(list); } catch { services = []; }
  const exists = services.some(s => s.name === name);

  // QRINFO_ENV = the branch (production/staging); pass through any analytics
  // vars set on the deploying machine so the pm2 service reports to Umami.
  const envPairs = [`SERVE_DIST=${distPath}`, `SERVE_PORT=${port}`, `QRINFO_ENV=${branch}`];
  for (const key of ['UMAMI_HOST', 'UMAMI_WEBSITE_ID', 'SERVE_TRUST_PROXY', 'UMAMI_DEBUG']) {
    if (process.env[key]) envPairs.push(`${key}=${process.env[key]}`);
  }
  const env = envPairs.join(' ');
  if (exists) {
    onLog(`[pi] pm2 restart ${name}`);
    await runSsh(`${env} pm2 restart ${name} --update-env`, onLog);
  } else {
    onLog(`[pi] pm2 start ${name}`);
    await runSsh(
      `${env} pm2 start "${scriptPath}" --name "${name}" --cwd "${cwd}"`,
      onLog,
    );
  }
}

function runSsh(remoteShellCommand, onLog) {
  return runSshInternal(remoteShellCommand, onLog, false);
}

function runSshCapture(remoteShellCommand, onLog) {
  return runSshInternal(remoteShellCommand, onLog, true);
}

function runSshInternal(remoteShellCommand, onLog, captureStdout) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', HOST, remoteShellCommand],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => {
      const text = d.toString();
      stdout += text;
      if (!captureStdout) {
        text.split('\n').filter(Boolean).forEach(l => onLog(`  ${l}`));
      }
    });
    child.stderr.on('data', d => {
      const text = d.toString();
      stderr += text;
      text.split('\n').filter(Boolean).forEach(l => onLog(`  err: ${l}`));
    });
    child.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error('ssh not installed locally; install openssh-client'));
      } else {
        reject(err);
      }
    });
    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`ssh exited ${code}: ${(stderr || stdout).trim().slice(-200)}`));
      }
      resolve(captureStdout ? stdout : undefined);
    });
  });
}

async function smokeTest(url, onLog) {
  onLog(`[pi] smoke ${url}/`);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(timer);
    onLog(`[pi] smoke ${url}/ → ${res.status}`);
  } catch (err) {
    onLog(`[pi] smoke failed: ${err.message}`);
  }
}
