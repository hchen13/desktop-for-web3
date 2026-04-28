/**
 * 搜索栏工具函数
 *
 * 输入识别：EVM 地址 / EVM tx hash / ENS / Solana / BTC（bech32 + 仿统）
 */

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const ENS_REGEX = /^[a-z0-9-]+\.eth$/i;
// Solana base58: 32–44 字符（base58 字母表排除 0/O/I/l）
const SOL_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// BTC bech32 segwit / taproot
const BTC_BECH32_REGEX = /^bc1[a-z0-9]{8,87}$/;
// BTC 旧版 P2PKH (1) / P2SH (3)
const BTC_LEGACY_REGEX = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;

export type InputType = 'evm-address' | 'sol-address' | 'btc-address' | 'ens' | 'tx' | 'search';

/**
 * 检测输入类型
 *
 * 顺序：EVM/tx（带 0x 前缀，最具体） → ENS → BTC bech32 → Solana → BTC 旧版 → search
 * SOL 与 BTC 旧版的 32–35 字符段存在理论重叠，按现实概率把 SOL 放前面（典型 SOL 地址 43–44 字符）
 */
export const detectInputType = (input: string): InputType => {
  const trimmed = input.trim();

  if (EVM_ADDRESS_REGEX.test(trimmed)) return 'evm-address';
  if (TX_HASH_REGEX.test(trimmed)) return 'tx';
  if (ENS_REGEX.test(trimmed)) return 'ens';
  if (BTC_BECH32_REGEX.test(trimmed)) return 'btc-address';
  // BTC 旧版地址固定以 1/3 开头且长度 26-35，比 Solana 更具体——优先匹配
  if (BTC_LEGACY_REGEX.test(trimmed)) return 'btc-address';
  if (SOL_ADDRESS_REGEX.test(trimmed)) return 'sol-address';

  return 'search';
};

/**
 * 根据输入类型获取跳转 URL
 */
export const getSearchUrl = (input: string, engine: 'google' | 'bing' = 'google'): string => {
  const trimmed = input.trim();
  const type = detectInputType(trimmed);

  switch (type) {
    case 'evm-address':
      return `https://etherscan.io/address/${trimmed}`;
    case 'tx':
      return `https://etherscan.io/tx/${trimmed}`;
    case 'ens':
      return `https://app.ens.domains/${trimmed}`;
    case 'sol-address':
      return `https://solscan.io/account/${trimmed}`;
    case 'btc-address':
      return `https://mempool.space/address/${trimmed}`;
    default: {
      const engines = {
        google: 'https://www.google.com/search?q=',
        bing: 'https://www.bing.com/search?q=',
      };
      return `${engines[engine]}${encodeURIComponent(trimmed)}`;
    }
  }
};

/**
 * 获取搜索建议标签
 */
export const getSuggestionLabel = (input: string): string | null => {
  const type = detectInputType(input);

  switch (type) {
    case 'evm-address':
      return '在 Etherscan 查看地址';
    case 'tx':
      return '在 Etherscan 查看交易';
    case 'ens':
      return '在 ENS 查看域名';
    case 'sol-address':
      return '在 Solscan 查看地址';
    case 'btc-address':
      return '在 mempool.space 查看地址';
    default:
      return null;
  }
};
