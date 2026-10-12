/**
 * Quickstart Script: StreamPay on Monad Testnet
 * Runs Access Service and Frontend connected directly to Monad Testnet (Chain ID 10143).
 *
 * Usage: npm run quickstart:testnet
 */
import { spawn } from 'child_process';

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('   🟣 STREAMPAY — QUICKSTART MONAD TESTNET');
console.log('   • Target Network: Monad Testnet (Chain ID 10143)');
console.log('   • RPC Endpoint:   https://testnet-rpc.monad.xyz');
console.log('   • Access Gateway: http://localhost:4001');
console.log('   • Web Player UI:  http://localhost:3000');
console.log('   • Press Ctrl+C to terminate both services.');
console.log('═══════════════════════════════════════════════════════════════════════\n');

const access = spawn('node', ['access-service/dist/server.js'], {
  env: {
    ...process.env,
    NETWORK: 'monad-testnet',
    RPC_URL: 'https://testnet-rpc.monad.xyz',
    PORT: '4001',
    SIMULATION_MODE: 'false',
  },
  stdio: 'inherit',
  shell: true,
});

const frontend = spawn('npm', ['run', 'dev', '--prefix', 'frontend'], {
  env: {
    ...process.env,
    NEXT_PUBLIC_NETWORK: 'testnet',
    NEXT_PUBLIC_ACCESS_SERVICE_URL: 'http://localhost:4001',
    NEXT_PUBLIC_MONAD_TESTNET_RPC: 'https://testnet-rpc.monad.xyz',
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
