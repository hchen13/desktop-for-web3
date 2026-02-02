/**
 * 搜索栏工具函数
 */

// 以太坊地址正则: 0x + 40位十六进制
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// 交易哈希正则: 0x + 64位十六进制
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

export type InputType = 'address' | 'tx' | 'search';

/**
 * 检测输入类型
 */
export const detectInputType = (input: string): InputType => {
  const trimmed = input.trim();

  if (ETH_ADDRESS_REGEX.test(trimmed)) {
    return 'address';
  }

  if (TX_HASH_REGEX.test(trimmed)) {
    return 'tx';
  }

  return 'search';
};

/**
 * 根据输入类型获取跳转 URL
 */
export const getSearchUrl = (input: string, engine: 'google' | 'bing' = 'google'): string => {
  const trimmed = input.trim();
  const type = detectInputType(trimmed);

  if (type === 'address') {
    return `https://etherscan.io/address/${trimmed}`;
  }

  if (type === 'tx') {
    return `https://etherscan.io/tx/${trimmed}`;
  }

  const engines = {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
  };

  return `${engines[engine]}${encodeURIComponent(trimmed)}`;
};

/**
 * 获取搜索建议标签
 */
export const getSuggestionLabel = (input: string): string | null => {
  const type = detectInputType(input);

  if (type === 'address') {
    return '在 Etherscan 查看地址';
  }

  if (type === 'tx') {
    return '在 Etherscan 查看交易';
  }

  return null;
};
