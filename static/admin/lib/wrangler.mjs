import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const MOCK = process.env.MOCK_WRANGLER === '1' || process.env.OFFLINE === '1';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw Object.assign(new Error(`${name} env var not set`), { status: 500 });
  return v;
}

export async function pagesDeploy(dir, branch, { onLog = () => {} } = {}) {
  const project = requireEnv('CF_PAGES_PROJECT');
  if (MOCK) return mockDeploy(dir, branch, project, onLog);
  return runWrangler(
    ['pages', 'deploy', dir, `--project-name=${project}`, `--branch=${branch}`],
    onLog,
  );
}

async function runWrangler(args, onLog) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('wrangler', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
      });
    } catch (err) {
      return reject(err);
    }
    let stdout = '';
    let stderr = '';

    function pump(buf, sink) {
      const text = buf.toString();
      sink.value += text;
      for (const line of text.split(/\r?\n/)) {
        if (line) onLog(line);
      }
    }
    const stdoutSink = { get value() { return stdout; }, set value(v) { stdout = v; } };
    const stderrSink = { get value() { return stderr; }, set value(v) { stderr = v; } };
    child.stdout.on('data', d => pump(d, stdoutSink));
    child.stderr.on('data', d => pump(d, stderrSink));
    child.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          'wrangler not installed — install with `npm install -g wrangler`, or set MOCK_WRANGLER=1 for local testing'
        ));
      } else {
        reject(err);
      }
    });
    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`wrangler exited with code ${code}: ${stderr.trim() || 'no stderr'}`));
      }
      const urlMatch = stdout.match(/https:\/\/[\w-]+\.[\w.-]+\.pages\.dev[^\s]*/);
      const url = urlMatch?.[0] ?? null;
      const idMatch = url?.match(/https:\/\/([\w-]+)\./);
      const id = idMatch?.[1] ?? null;
      resolve({ id, url, stdout, stderr });
    });
  });
}

async function mockDeploy(dir, branch, project, onLog) {
  onLog(`[MOCK] wrangler pages deploy ${dir} --project-name=${project} --branch=${branch}`);
  await sleep(150);
  onLog('[MOCK] uploading files…');
  await sleep(150);
  const id = randomBytes(4).toString('hex');
  const url = `https://${id}.${project}.pages.dev`;
  onLog(`[MOCK] deployment ready: ${url}`);
  return { id, url, stdout: '', stderr: '' };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
