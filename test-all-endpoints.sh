#!/bin/bash

BASE_URL="http://localhost:8787"
CHAINS=("btc" "eth" "sol" "bsc" "polygon")

echo "=========================================="
echo "区块链监控接口完整测试"
echo "=========================================="
echo ""

# 测试 Block Time Delay
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Block Time Delay 接口"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for chain in "${CHAINS[@]}"; do
  echo ""
  echo "[$chain]"
  echo "Request: GET ${BASE_URL}/api/blockchain-monitor/block-time-delay?chain=$chain"
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/block-time-delay?chain=$chain")
  echo "Response:"
  echo "$response" | jq '.' 2>/dev/null || echo "$response"
  echo "---"
done

echo ""
echo ""

# 测试 Gas Price
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. Gas Price 接口"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for chain in "${CHAINS[@]}"; do
  echo ""
  echo "[$chain]"
  echo "Request: GET ${BASE_URL}/api/blockchain-monitor/gas-price?chain=$chain"
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/gas-price?chain=$chain")
  echo "Response:"
  echo "$response" | jq '.' 2>/dev/null || echo "$response"
  echo "---"
done

echo ""
echo ""

# 测试 TPS
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. TPS 接口"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for chain in "${CHAINS[@]}"; do
  echo ""
  echo "[$chain]"
  echo "Request: GET ${BASE_URL}/api/blockchain-monitor/tps?chain=$chain"
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/tps?chain=$chain")
  echo "Response:"
  echo "$response" | jq '.' 2>/dev/null || echo "$response"
  echo "---"
done

echo ""
echo ""

# 测试 Active Addresses
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. Active Addresses 接口"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for chain in "${CHAINS[@]}"; do
  echo ""
  echo "[$chain]"
  echo "Request: GET ${BASE_URL}/api/blockchain-monitor/active-addresses?chain=$chain"
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/active-addresses?chain=$chain")
  echo "Response:"
  echo "$response" | jq '.' 2>/dev/null || echo "$response"
  echo "---"
done

echo ""
echo ""

# 测试 TVL
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5. TVL 接口"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for chain in "${CHAINS[@]}"; do
  echo ""
  echo "[$chain]"
  echo "Request: GET ${BASE_URL}/api/blockchain-monitor/tvl?chain=$chain"
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/tvl?chain=$chain")
  echo "Response:"
  echo "$response" | jq '.' 2>/dev/null || echo "$response"
  echo "---"
done

echo ""
echo ""

# 测试 All Metrics
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6. All Metrics 接口（一次性获取所有指标）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for chain in "${CHAINS[@]}"; do
  echo ""
  echo "[$chain]"
  echo "Request: GET ${BASE_URL}/api/blockchain-monitor/all-metrics?chain=$chain"
  response=$(curl -s "${BASE_URL}/api/blockchain-monitor/all-metrics?chain=$chain")
  echo "Response:"
  echo "$response" | jq '.' 2>/dev/null || echo "$response"
  echo "---"
done

echo ""
echo "=========================================="
echo "测试完成"
echo "=========================================="
