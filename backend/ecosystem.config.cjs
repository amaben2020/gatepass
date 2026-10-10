// pm2 process list: `npm run workers:start`, then `pm2 ls` / `pm2 logs`.
const shared = {
  interpreter: 'node',
  node_args: ['--env-file=.env', '--import', 'tsx'],
  autorestart: true,
  exp_backoff_restart_delay: 1000, // crash loop (e.g. Redis down): wait 1s, 1.5s, 2.25s... instead of hammering
  kill_timeout: 5000, // time to finish the current batch after SIGINT before pm2 force-kills
};

module.exports = {
  apps: [
    {
      ...shared,
      name: 'gatekeeper',
      script: 'src/features/jobs/worker/process.ts',
      env: { SERVICE_NAME: 'gatekeeper', FORCE_COLOR: '1' },
    },
    {
      ...shared,
      name: 'sqs-worker',
      script: 'src/worker.ts',
      env: { SERVICE_NAME: 'worker', FORCE_COLOR: '1' },
    },
  ],
};
