/**
 * 测试单个链的Solana API
 */

const WORKER_URL = 'http://localhost:8787';

async function testSolana() {
  console.log('🔍 测试 Solana 相关接口...\n');

  const tests = [
    { name: 'blockTimeDelay', url: `${WORKER_URL}/api/blockchain-monitor/block-time-delay?chain=sol` },
    { name: 'gasPrice', url: `${WORKER_URL}/api/blockchain-monitor/gas-price?chain=sol` },
    { name: 'tps', url: `${WORKER_URL}/api/blockchain-monitor/tps?chain=sol` },
  ];

  for (const test of tests) {
    console.log(`测试: ${test.name}`);
    try {
      const response = await fetch(test.url);
      const data = await response.json();
      console.log(`  Status: ${response.status}`);
      console.log(`  Success: ${data.success}`);
      if (data.data) {
        console.log(`  Data: ${JSON.stringify(data.data).slice(0, 100)}...`);
      }
      if (data.error) {
        console.log(`  Error: ${data.error.message}`);
      }
    } catch (error) {
      console.log(`  Exception: ${error}`);
    }
    console.log('');
  }
}

testSolana();
