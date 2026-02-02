/**
 * 测试 PublicNode Solana RPC 端点
 * 测试：BLOCK TIME DELAY, GAS, TPS
 */

const RPC_ENDPOINT = 'https://solana-rpc.publicnode.com';

/**
 * JSON-RPC 请求
 */
async function jsonRPC(method, params = []) {
  const response = await fetch(RPC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data.result;
}

/**
 * 延迟函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 测试 Block Time Delay
 */
async function testBlockTimeDelay() {
  console.log('\n=== 测试 Block Time Delay ===');
  try {
    // 1. 获取最新 slot
    const slot = await jsonRPC('getSlot');
    console.log(`✓ Slot: ${slot}`);

    // 2. 获取区块时间
    const blockTime = await jsonRPC('getBlockTime', [slot]);
    const now = Math.floor(Date.now() / 1000);
    const delaySeconds = now - (blockTime || now);

    console.log(`✓ Block Time: ${blockTime ? new Date(blockTime * 1000).toISOString() : 'null'}`);
    console.log(`✓ Delay: ${delaySeconds} seconds`);
    console.log(`✓ Status: ${blockTime ? 'SUCCESS' : 'WARNING (blockTime is null)'}`);

    return { success: true, slot, blockTime, delaySeconds };
  } catch (error) {
    console.error(`✗ Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 测试 Gas Price
 */
async function testGasPrice() {
  console.log('\n=== 测试 Gas Price ===');
  try {
    const fees = await jsonRPC('getRecentPrioritizationFees', [[]]);
    
    if (!fees || fees.length === 0) {
      console.log('⚠ No fees returned, using default');
      return { success: true, avgFee: 5000, unit: 'lamports' };
    }

    const feeValues = fees.map(f => f.prioritizationFee || 0).filter(f => f > 0);
    const avgFee = feeValues.length > 0 
      ? feeValues.reduce((a, b) => a + b, 0) / feeValues.length 
      : 5000;
    const medianFee = feeValues.length > 0
      ? [...feeValues].sort((a, b) => a - b)[Math.floor(feeValues.length / 2)]
      : 5000;

    const totalFee = 5000 + avgFee; // 基础费用 + 优先费

    console.log(`✓ Fee samples: ${feeValues.length}`);
    console.log(`✓ Base fee: 5000 lamports`);
    console.log(`✓ Priority fee (avg): ${avgFee.toFixed(0)} lamports`);
    console.log(`✓ Total fee: ${totalFee.toFixed(0)} lamports (${(totalFee / 1e9).toFixed(9)} SOL)`);
    console.log(`✓ Status: SUCCESS`);

    return { success: true, avgFee: totalFee, unit: 'lamports' };
  } catch (error) {
    console.error(`✗ Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 测试 TPS
 */
async function testTPS() {
  console.log('\n=== 测试 TPS ===');
  try {
    const samples = await jsonRPC('getRecentPerformanceSamples', [60]);
    
    if (!samples || samples.length === 0) {
      throw new Error('No samples returned');
    }

    let totalTPS = 0;
    let validSamples = 0;

    for (const sample of samples) {
      if (sample.numNonVoteTransactions !== undefined && sample.samplePeriodSecs > 0) {
        const tps = sample.numNonVoteTransactions / sample.samplePeriodSecs;
        totalTPS += tps;
        validSamples++;
      }
    }

    const avgTPS = validSamples > 0 ? totalTPS / validSamples : 0;

    console.log(`✓ Samples: ${samples.length} (valid: ${validSamples})`);
    console.log(`✓ Average TPS: ${avgTPS.toFixed(2)}`);
    console.log(`✓ Status: SUCCESS`);

    return { success: true, tps: avgTPS, sampleCount: validSamples };
  } catch (error) {
    console.error(`✗ Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 主测试函数
 */
async function runTests() {
  console.log('========================================');
  console.log('PublicNode Solana RPC 端点测试');
  console.log(`Endpoint: ${RPC_ENDPOINT}`);
  console.log('========================================');

  const results = {
    blockTimeDelay: null,
    gasPrice: null,
    tps: null,
  };

  // 测试 1: Block Time Delay
  results.blockTimeDelay = await testBlockTimeDelay();
  await sleep(2000); // 等待 2 秒

  // 测试 2: Gas Price
  results.gasPrice = await testGasPrice();
  await sleep(2000); // 等待 2 秒

  // 测试 3: TPS
  results.tps = await testTPS();

  // 总结
  console.log('\n========================================');
  console.log('测试总结');
  console.log('========================================');
  console.log(`Block Time Delay: ${results.blockTimeDelay.success ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Gas Price:        ${results.gasPrice.success ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`TPS:              ${results.tps.success ? '✓ PASS' : '✗ FAIL'}`);
  
  const allPassed = results.blockTimeDelay.success && 
                    results.gasPrice.success && 
                    results.tps.success;
  
  console.log(`\n总体结果: ${allPassed ? '✓ 所有测试通过' : '✗ 部分测试失败'}`);
  console.log('========================================\n');
}

// 运行测试
runTests().catch(console.error);
