/** @type {import('@stryker-mutator/core').StrykerOptions} */
export default {
  // Mutate ONLY the Stage 0 tooling fixture — never product code.
  mutate: ['tests/mutation-fixture/range-validator.ts'],

  // Use the command runner to invoke Deno's test runner.
  testRunner: 'command',
  commandRunner: {
    command:
      'deno test --no-check --allow-env=__STRYKER_ACTIVE_MUTANT__,__STRYKER_MUTANT_COVERAGE__ tests/mutation-fixture/range-validator_test.ts',
  },

  // Prevent secrets, credentials, generated artifacts, and heavyweight
  // directories from being copied into mutation sandboxes.
  ignorePatterns: [
    '.env',
    '.env.*',
    '.env.*.local',
    'secrets/**',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    '.tools/**',
    'node_modules/**',
    'tooling/mutation/node_modules/**',
    'stryker-tmp/**',
    'sbom.cdx.json',
    'reports/**',
    'coverage/**',
    '.nyc_output/**',
    '*.lcov',
    'dist/**',
    '.git/**',
    '.deno/**',
    '.vscode/**',
    '.idea/**',
    '.DS_Store',
  ],

  buildCommand: undefined,

  // One worker, concurrency 1, bounded timeout.
  concurrency: 1,
  timeoutMS: 30_000,
  timeoutFactor: 1.5,

  // Always clean temp dir — including on failure/interrupt (since Stryker 7).
  tempDirName: 'stryker-tmp',
  cleanTempDir: 'always',

  // 100% break threshold for Stage 0 controlled fixture.
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },

  // Report to console only — no network.
  reporters: ['clear-text', 'progress'],

  // Do not open the dashboard.
  dashboard: { reportType: 'full' },

  // Disable incremental to get a clean full run.
  incremental: false,
};
