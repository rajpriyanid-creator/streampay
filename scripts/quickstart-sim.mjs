/**
 * Quickstart Script: StreamPay in Simulation Mode
 * Runs Access Service and Frontend in pure off-chain simulation mode.
 * No Anvil node, testnet funds, or wallet connection required.
 *
 * Usage: npm run quickstart:sim
 */
import { spawn } from 'child_process';

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('   🚀 STREAMPAY — QUICKSTART SIMULATION MODE');
console.log('   • Access Gateway: http://localhost:4001/health (Simulation Mode)');
console.log('   • Web Player UI:  http://localhost:3000');
console.log('   • Press Ctrl+C to terminate both services.');
console.log('═══════════════════════════════════════════════════════════════════════\n');

const access = spawn('node', ['access-service/dist/server.js'], {
  env: {
    ...process.env,
    SIMULATION_MODE: 'true',
    PORT: '4001',
    NETWORK: 'local',
  },
  stdio: 'inherit',
  shell: true,
});

const frontend = spawn('npm', ['run', 'dev', '--prefix', 'frontend'], {
  env: {
    ...process.env,
    NEXT_PUBLIC_STREAM_SIMULATION: 'true',
    NEXT_PUBLIC_ACCESS_SERVICE_URL: 'http://localhost:4001',
  },
  stdio: 'inherit',
  shell: true,
});

function cleanup() {
  console.log('\n🛑 Shutting down StreamPay services...');
  try { access.kill(); } catch {}
  try { frontend.kill(); } catch {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
