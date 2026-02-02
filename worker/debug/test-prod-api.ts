/**
 * 测试线上 Worker API
 * 与本地测试相同的逻辑，但使用生产环境的 Worker URL
 */

const PROD_WORKER_URL = 'https://desktop-for-web3-api-proxy.gradients-tech.workers.dev';

// 支持的链
const CHAINS = ['btc', 'eth', 'sol', 'bsc', 'polygon'] as const;

// 指标列表
const METRICS = ['blockTimeDelay', 'gasPrice', 'tps', 'activeAddresses', 'tvl'] as const;

type Chain = typeof CHAINS[number];
type Metric = typeof METRICS[number];

interface TestResult {
  chain: Chain;
  metric: Metric;
  status: 'success' | 'error';
  statuscode: number;
  data?: any;
  error?: string;
  duration: number;
}

interface MetricResponse {
  success: boolean;
  data?: any;
  error?: { code: string; message: string };
  cached?: boolean;
  timestamp?: number;
}

/**
 * 调用单个指标API
 */
async function testMetric(chain: Chain, metric: Metric): Promise<TestResult> {
  const startTime = Date.now();

  // 转换指标名称为API端点格式（使用连字符）
  const endpointMap: Record<Metric, string> = {
    blockTimeDelay: 'block-time-delay',
    gasPrice: 'gas-price',
    tps: 'tps',
    activeAddresses: 'active-addresses',
    tvl: 'tvl',
  };

  const url = `${PROD_WORKER_URL}/api/blockchain-monitor/${endpointMap[metric]}?chain=${chain}`;

  try {
    const response = await fetch(url);
    const duration = Date.now() - startTime;
    const data: MetricResponse = await response.json();

    if (response.ok && data.success) {
      return {
        chain,
        metric,
        status: 'success',
        statuscode: response.status,
        data: data.data,
        duration,
      };
    } else {
      return {
        chain,
        metric,
        status: 'error',
        statuscode: response.status,
        error: data.error?.message || `HTTP ${response.status}`,
        duration,
      };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      chain,
      metric,
      status: 'error',
      statuscode: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration,
    };
  }
}

/**
 * 打印测试结果
 */
function printResult(result: TestResult) {
  const statusIcon = result.status === 'success' ? '✅' : '❌';
  const statusColor = result.status === 'success' ? '\x1b[32m' : '\x1b[31m';
  const resetColor = '\x1b[0m';

  console.log(
    `${statusIcon} [${result.chain.toUpperCase()}] ${result.metric}: ` +
    `${statusColor}${result.status.toUpperCase()} (${result.statuscode})${resetColor} ` +
    `(${result.duration}ms)`
  );

  if (result.status === 'success' && result.data) {
    // 简化数据显示
    const data = result.data;
    const preview = JSON.stringify(data, null, 0).slice(0, 100);
    console.log(`   Data: ${preview}${preview.length >= 100 ? '...' : ''}`);
  } else if (result.status === 'error') {
    console.log(`   Error: ${result.error}`);
  }
}

/**
 * 打印汇总表格
 */
function printSummary(results: TestResult[]) {
  console.log('\n========================================');
  console.log('           测试结果汇总');
  console.log('========================================\n');

  // 按链分组
  for (const chain of CHAINS) {
    console.log(`【${chain.toUpperCase()}】`);
    const chainResults = results.filter(r => r.chain === chain);

    for (const metric of METRICS) {
      const result = chainResults.find(r => r.metric === metric);
      if (!result) {
        console.log(`  ${metric}: ⚪ 未测试`);
        continue;
      }

      const icon = result.status === 'success' ? '✅' : '❌';
      console.log(`  ${metric}: ${icon} ${result.statuscode} (${result.duration}ms)`);
    }
    console.log('');
  }

  // 统计
  const total = results.length;
  const success = results.filter(r => r.status === 'success').length;
  const error = total - success;

  console.log('----------------------------------------');
  console.log(`总计: ${total} | 成功: ${success} | 失败: ${error}`);
  console.log('========================================\n');

  // 列出失败的项目
  const failures = results.filter(r => r.status === 'error');
  if (failures.length > 0) {
    console.log('🔴 失败项目详情:\n');
    for (const f of failures) {
      console.log(`  [${f.chain.toUpperCase()}] ${f.metric}: ${f.error}`);
    }
    console.log('');
  }

  // 性能分析
  console.log('⏱️  性能分析 (平均响应时间):\n');
  for (const chain of CHAINS) {
    const chainResults = results.filter(r => r.chain === chain);
    const avgDuration = chainResults.reduce((sum, r) => sum + r.duration, 0) / chainResults.length;
    console.log(`  ${chain.toUpperCase()}: ${avgDuration.toFixed(0)}ms`);
  }
}

/**
 * 主测试函数
 */
async function testAll() {
  console.log('🚀 开始测试生产环境 Chain Monitor API');
  console.log(`Worker URL: ${PROD_WORKER_URL}\n`);

  const results: TestResult[] = [];

  // 逐个测试
  for (const chain of CHAINS) {
    console.log(`\n📊 测试链: ${chain.toUpperCase()}`);
    console.log('----------------------------------------');

    for (const metric of METRICS) {
      const result = await testMetric(chain, metric);
      results.push(result);
      printResult(result);

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  printSummary(results);

  // 退出码
  const hasError = results.some(r => r.status === 'error');
  process.exit(hasError ? 1 : 0);
}

// 运行测试
testAll().catch(error => {
  console.error('测试执行出错:', error);
  process.exit(1);
});
