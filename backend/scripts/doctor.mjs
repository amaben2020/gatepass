// `npm run doctor`: is everything Gatepass needs actually running? Exits 1 if anything is down.
import { execSync } from 'node:child_process';
import { styleText } from 'node:util';

const ok = (name, detail = '') => console.log(`  ${styleText('green', '✓')} ${name.padEnd(22)} ${styleText('gray', detail)}`);
const bad = (name, detail, fix) => {
  failures++;
  console.log(`  ${styleText('red', '✗')} ${name.padEnd(22)} ${styleText('red', detail)}${fix ? styleText('yellow', `  → ${fix}`) : ''}`);
};
let failures = 0;

const sh = (cmd) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return null;
  }
};

const reachable = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
};

console.log(styleText('bold', '\nContainers'));
const running = (sh("docker ps --format '{{.Names}}'") ?? '').split('\n');
if (!running.some(Boolean)) bad('docker', 'not reachable', 'start Docker Desktop');
for (const [name, fix] of [
  ['my-postgres', 'docker start my-postgres'],
  ['redis', 'docker start redis'],
  ['localstack', 'npm run infra:up'],
  ['loki', 'npm run infra:up'],
  ['prometheus', 'npm run infra:up'],
  ['grafana', 'npm run infra:up'],
]) {
  running.some((c) => c === name || c.includes(`-${name}-`)) ? ok(name) : bad(name, 'not running', fix);
}

console.log(styleText('bold', '\nWorkers (pm2)'));
const pm2 = sh('pm2 jlist');
if (pm2 === null) {
  bad('pm2', 'not installed or not responding', 'npm i -g pm2');
} else {
  const apps = JSON.parse(pm2);
  for (const name of ['gatekeeper', 'issue-ticket']) {
    const app = apps.find((a) => a.name === name);
    if (!app) {
      bad(name, 'not started', 'npm run workers:start');
    } else if (app.pm2_env.status !== 'online') {
      bad(name, app.pm2_env.status, `npm run workers:start, then pm2 logs ${name} --err`);
    } else {
      const mins = Math.round((Date.now() - app.pm2_env.pm_uptime) / 60000);
      const restarts = app.pm2_env.restart_time;
      ok(name, `online ${mins}m, ${restarts} restart${restarts === 1 ? '' : 's'}`);
    }
  }
}

console.log(styleText('bold', '\nEndpoints'));
for (const [name, url, fix] of [
  ['api', 'http://localhost:4000/metrics', 'npm run dev'],
  ['gatekeeper metrics', 'http://localhost:9102/metrics', 'pm2 logs gatekeeper --err'],
  ['issue-ticket metrics', 'http://localhost:9101/metrics', 'pm2 logs issue-ticket --err'],
  ['localstack sqs', 'http://localhost:4566/_localstack/health', 'npm run infra:up'],
  ['loki', 'http://localhost:3100/ready', 'npm run infra:up'],
  ['prometheus', 'http://localhost:9090/-/ready', 'npm run infra:up'],
  ['grafana', 'http://localhost:3000/api/health', 'npm run infra:up'],
]) {
  (await reachable(url)) ? ok(name, url) : bad(name, `unreachable (${url})`, fix);
}

console.log(styleText('bold', '\nAlerts firing in Prometheus'));
try {
  const { data } = await (await fetch('http://localhost:9090/api/v1/alerts', { signal: AbortSignal.timeout(2000) })).json();
  const firing = data.alerts.filter((a) => a.state === 'firing');
  if (firing.length === 0) ok('none');
  for (const a of firing) bad(a.labels.alertname, a.annotations.summary);
} catch {
  console.log(styleText('gray', '  (Prometheus not reachable)'));
}

console.log(failures ? styleText(['bold', 'red'], `\n${failures} problem(s) found\n`) : styleText(['bold', 'green'], '\nAll good\n'));
process.exit(failures ? 1 : 0);
