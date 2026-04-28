import { describe, it, expect } from 'vitest';
import { detectInputType, getSearchUrl, getSuggestionLabel } from './searchUtils';

describe('detectInputType — EVM', () => {
  it('lowercase EVM address', () => {
    expect(detectInputType('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe('evm-address');
  });

  it('uppercase EVM address (40 hex)', () => {
    expect(detectInputType('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')).toBe('evm-address');
  });

  it('EIP-55 mixed case address (vitalik.eth)', () => {
    expect(detectInputType('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe('evm-address');
  });

  it('41-hex returns search', () => {
    expect(detectInputType('0xABCDEF1234567890ABCDEF1234567890ABCDEF123')).toBe('search');
  });

  it('39-hex returns search', () => {
    expect(detectInputType('0xABCDEF1234567890ABCDEF1234567890ABCDEF1')).toBe('search');
  });

  it('64-hex tx hash', () => {
    expect(detectInputType('0x' + '1'.repeat(64))).toBe('tx');
  });

  it('trims whitespace before detection', () => {
    expect(detectInputType('   0xd8da6bf26964af9d7eed9e03e53415d37aa96045   ')).toBe('evm-address');
  });

  it('zero-width space currently treated as search (TODO)', () => {
    // 当前不剔除 zero-width 字符，行为与浏览器粘贴一致——保留以防误识别
    const addr = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    expect(detectInputType('​' + addr)).toBe('search');
  });
});

describe('detectInputType — ENS', () => {
  it('vitalik.eth → ens', () => {
    expect(detectInputType('vitalik.eth')).toBe('ens');
  });

  it('uppercase ENS preserved', () => {
    expect(detectInputType('VITALIK.eth')).toBe('ens');
  });

  it('ens with hyphen', () => {
    expect(detectInputType('hello-world.eth')).toBe('ens');
  });

  it('non-eth tld returns search', () => {
    expect(detectInputType('foo.crypto')).toBe('search');
  });

  it('bare .eth returns search', () => {
    expect(detectInputType('.eth')).toBe('search');
  });
});

describe('detectInputType — Solana', () => {
  it('typical 44-char base58 sol address', () => {
    expect(detectInputType('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1')).toBe('sol-address');
  });

  it('43-char base58 sol address', () => {
    expect(detectInputType('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j')).toBe('sol-address');
  });

  it('contains forbidden char 0 → search', () => {
    expect(detectInputType('0Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1')).toBe('search');
  });

  it('too short (under 32 chars) → search', () => {
    // 5 chars + 'A'.repeat(20) = 25 chars total — below SOL min and starts with non-1/3
    expect(detectInputType('5Q544' + 'A'.repeat(20))).toBe('search');
  });
});

describe('detectInputType — BTC', () => {
  it('bech32 mainnet (bc1...) → btc-address', () => {
    expect(detectInputType('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('btc-address');
  });

  it('bech32 with mixed case → search (bech32 is lowercase)', () => {
    expect(detectInputType('bc1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ')).toBe('search');
  });

  it('legacy P2PKH (1...) → btc-address', () => {
    expect(detectInputType('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('btc-address');
  });

  it('legacy P2SH (3...) → btc-address', () => {
    expect(detectInputType('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe('btc-address');
  });
});

describe('detectInputType — generic', () => {
  it('empty string returns search', () => {
    expect(detectInputType('')).toBe('search');
  });

  it('plain text returns search', () => {
    expect(detectInputType('hello world')).toBe('search');
  });
});

describe('getSearchUrl', () => {
  it('EVM address → etherscan address page', () => {
    const url = getSearchUrl('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    expect(url).toContain('etherscan.io/address');
  });

  it('tx hash → etherscan tx page', () => {
    const url = getSearchUrl('0x' + 'a'.repeat(64));
    expect(url).toContain('etherscan.io/tx');
  });

  it('ENS → app.ens.domains', () => {
    const url = getSearchUrl('vitalik.eth');
    expect(url).toContain('app.ens.domains');
  });

  it('Solana address → solscan account page', () => {
    const url = getSearchUrl('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');
    expect(url).toContain('solscan.io/account');
  });

  it('BTC bech32 → mempool.space', () => {
    const url = getSearchUrl('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    expect(url).toContain('mempool.space/address');
  });

  it('plain text → google by default', () => {
    expect(getSearchUrl('hello world')).toContain('google.com');
  });

  it('plain text with bing engine', () => {
    expect(getSearchUrl('hello', 'bing')).toContain('bing.com');
  });
});

describe('getSuggestionLabel', () => {
  it('EVM address label', () => {
    expect(getSuggestionLabel('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toContain('Etherscan');
  });

  it('ENS label', () => {
    expect(getSuggestionLabel('vitalik.eth')).toContain('ENS');
  });

  it('Solana label', () => {
    expect(getSuggestionLabel('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1')).toContain('Solscan');
  });

  it('BTC label', () => {
    expect(getSuggestionLabel('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toContain('mempool');
  });

  it('plain text → null', () => {
    expect(getSuggestionLabel('hello')).toBeNull();
  });
});
