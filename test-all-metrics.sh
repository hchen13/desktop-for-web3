#!/bin/bash

# 测试所有链上监控指标
# 确保 Worker 开发服务器正在运行（端口 8787）

BASE_URL="http://localhost:8787"
CHAINS=("eth" "bsc" "polygon" "btc" "sol")

echo "=========================================="
echo "测试所有链上监控指标"
echo "=========================================="
echo ""

# 1. Block Time Delay
echo "=== 1. Block Time Delay ==="
for chain in "${CHAINS[@]}"; do
  echo -n "[$chain]: "
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/block-time-delay?chain=$chain")
  success=$(echo "$response" | jq -r '.success')
  if [ "$success" = "true" ]; then
    blockNumber=$(echo "$response" | jq -r '.data.blockNumber')
    delaySeconds=$(echo "$response" | jq -r '.data.delaySeconds')
    echo "✅ Block: $blockNumber, Delay: ${delaySeconds}s"
  else
    error=$(echo "$response" | jq -r '.error.message')
    echo "❌ Error: $error"
  fi
done
echo ""

# 2. Gas Price
echo "=== 2. Gas Price ==="
for chain in "${CHAINS[@]}"; do
  echo -n "[$chain]: "
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/gas-price?chain=$chain")
  success=$(echo "$response" | jq -r '.success')
  if [ "$success" = "true" ]; then
    avgGas=$(echo "$response" | jq -r '.data.avgGasGwei')
    unit=$(echo "$response" | jq -r '.data.unit // "gwei"')
    echo "✅ Avg: $avgGas $unit"
  else
    error=$(echo "$response" | jq -r '.error.message')
    echo "❌ Error: $error"
  fi
done
echo ""

# 3. TPS
echo "=== 3. TPS ==="
for chain in "${CHAINS[@]}"; do
  echo -n "[$chain]: "
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/tps?chain=$chain")
  success=$(echo "$response" | jq -r '.success')
  if [ "$success" = "true" ]; then
    tps=$(echo "$response" | jq -r '.data.tps')
    echo "✅ TPS: $tps"
  else
    error=$(echo "$response" | jq -r '.error.message')
    echo "❌ Error: $error"
  fi
done
echo ""

# 4. Active Addresses
echo "=== 4. Active Addresses ==="
for chain in "${CHAINS[@]}"; do
  echo -n "[$chain]: "
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/active-addresses?chain=$chain")
  success=$(echo "$response" | jq -r '.success')
  if [ "$success" = "true" ]; then
    addresses=$(echo "$response" | jq -r '.data.activeAddresses')
    echo "✅ Addresses: $addresses"
  else
    error=$(echo "$response" | jq -r '.error.message')
    echo "❌ Error: $error"
  fi
done
echo ""

# 5. TVL (BTC 忽略)
echo "=== 5. TVL ==="
for chain in "${CHAINS[@]}"; do
  echo -n "[$chain]: "
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/tvl?chain=$chain")
  success=$(echo "$response" | jq -r '.success')
  if [ "$success" = "true" ]; then
    tvl=$(echo "$response" | jq -r '.data.tvlUSD // .data.tvl')
    if [ "$chain" = "btc" ]; then
      echo "⚠️  BTC: TVL not applicable (expected)"
    else
      echo "✅ TVL: \$$(printf "%.2f" $tvl)"
    fi
  else
    error=$(echo "$response" | jq -r '.error.message')
    echo "❌ Error: $error"
  fi
done
echo ""

# 6. Nakamoto Coefficient
echo "=== 6. Nakamoto Coefficient ==="
for chain in "${CHAINS[@]}"; do
  echo -n "[$chain]: "
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/nakamoto-coefficient?chain=$chain")
  success=$(echo "$response" | jq -r '.success')
  if [ "$success" = "true" ]; then
    coeff=$(echo "$response" | jq -r '.data.nakamotoCoefficient')
    echo "✅ Coefficient: $coeff"
  else
    error=$(echo "$response" | jq -r '.error.message')
    echo "❌ Error: $error"
  fi
done
echo ""

echo "=========================================="
echo "测试完成"
echo "=========================================="
