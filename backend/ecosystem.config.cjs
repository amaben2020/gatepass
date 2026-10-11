// Background workers. `npm run workers:start` starts or restarts them; `npm run doctor` checks they're up.
const shared = {
  interpreter: 'node',
  node_args: ['--env-file=.env', '--import', 'tsx'],
  autorestart: true,
  exp_backoff_restart_delay: 1000, // crash loop (e.g. Redis down): wait 1s, 1.5s, 2.25s... instead of hammering
  kill_timeout: 5000, // time to finish the current batch after SIGINT before pm2 force-kills
  // Restart on code changes, like `npm run dev` does for the API.
  watch: ['src'],
  watch_delay: 1000,
};

module.exports = {
  apps: [
    {
      ...shared,
      name: 'gatekeeper',
      script: 'src/features/jobs/worker/gatekeeper.ts',
      env: { SERVICE_NAME: 'gatekeeper', FORCE_COLOR: '1' },
    },
    {
      ...shared,
      name: 'issue-ticket',
      script: 'src/features/jobs/worker/issue-ticket.ts',
      env: { SERVICE_NAME: 'issue-ticket', FORCE_COLOR: '1' },
    },
  ],
};
