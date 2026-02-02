/**
 * Calendar Widget Mock 数据
 */

import type { Web3Event } from './calendarTypes';

/**
 * 生成 mock 事件数据
 * @param targetYear 目标年份（默认为当前年）
 * @param targetMonth 目标月份（0-11，默认为当前月）
 */
export function generateMockEvents(targetYear?: number, targetMonth?: number): Web3Event[] {
  const now = new Date();
  const year = targetYear ?? now.getFullYear();
  const month = targetMonth ?? now.getMonth();

  const events: Web3Event[] = [];

  // 辅助函数：创建日期字符串
  const dateStr = (day: number, monthOffset = 0) => {
    const adjustedMonth = month + monthOffset;
    const adjustedYear = year + Math.floor(adjustedMonth / 12);
    const finalMonth = ((adjustedMonth % 12) + 12) % 12;
    return `${adjustedYear}-${String(finalMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const yearSuffix = year.toString();

  // === 多事件日期 ===

  // 1月5日 - 3个事件（混合有时间和无时间）
  events.push({
    id: `conf-${yearSuffix}-1`,
    date: dateStr(5),
    title: 'Consensus HK',
    type: 'conference',
    description: '香港共识大会',
  });
  events.push({
    id: `unlock-${yearSuffix}-0`,
    date: dateStr(5),
    time: '10:00 UTC',
    title: 'SUI 代币解锁',
    type: 'unlock',
    description: '解锁约 200 万枚 SUI 代币',
  });
  events.push({
    id: `airdrop-${yearSuffix}-0`,
    date: dateStr(5),
    title: 'LayerZero 空投',
    type: 'airdrop',
    description: 'LayerZero 第一季空投申领',
  });

  // 1月10日 - 2个事件（都无具体时间）
  events.push({
    id: `conf-${yearSuffix}-2`,
    date: dateStr(10),
    title: 'ETH Denver',
    type: 'conference',
    description: '丹佛以太坊开发者大会',
  });
  events.push({
    id: `conf-${yearSuffix}-3`,
    date: dateStr(10),
    title: 'Devcon 开发者大会',
    type: 'conference',
    description: '全球以太坊开发者聚会',
  });

  // 1月12日 - 4个事件（混合类型，都有时间）
  events.push({
    id: `upgrade-${yearSuffix}-1`,
    date: dateStr(12),
    time: '14:00 UTC',
    title: 'Arbitrum 升级',
    type: 'upgrade',
    description: 'Arbitrum Nitro 升级',
  });
  events.push({
    id: `unlock-${yearSuffix}-1`,
    date: dateStr(12),
    time: '16:00 UTC',
    title: 'OP 代币解锁',
    type: 'unlock',
    description: '解锁约 2500 万枚 OP 代币',
  });
  events.push({
    id: `airdrop-${yearSuffix}-1`,
    date: dateStr(12),
    time: '18:00 UTC',
    title: 'ZkSync 空投',
    type: 'airdrop',
    description: 'ZkSync Era 第一季空投申领开放',
  });
  events.push({
    id: `upgrade-${yearSuffix}-2`,
    date: dateStr(12),
    time: '20:00 UTC',
    title: 'Optimism Bedrock',
    type: 'upgrade',
    description: 'Optimism Bedrock 升级部署',
  });

  // 1月15日 - 2个事件（有时间）
  events.push({
    id: `unlock-${yearSuffix}-2`,
    date: dateStr(15),
    time: '08:00 UTC',
    title: 'APT 代币解锁',
    type: 'unlock',
    description: '解锁约 400 万枚 APT 代币',
  });
  events.push({
    id: `upgrade-${yearSuffix}-3`,
    date: dateStr(15),
    time: '12:00 UTC',
    title: 'Polygon zkEVM',
    type: 'upgrade',
    description: 'Polygon zkEVM 主网升级',
  });

  // 1月18日 - 3个事件（混合）
  events.push({
    id: `airdrop-${yearSuffix}-2`,
    date: dateStr(18),
    time: '09:00 UTC',
    title: 'Starknet 空投',
    type: 'airdrop',
    description: 'Starknet 第二季空投申领',
  });
  events.push({
    id: `conf-${yearSuffix}-4`,
    date: dateStr(18),
    title: '万向区块链大会',
    type: 'conference',
    description: '上海区块链峰会',
  });
  events.push({
    id: `unlock-${yearSuffix}-3`,
    date: dateStr(18),
    time: '15:00 UTC',
    title: 'IMX 代币解锁',
    type: 'unlock',
    description: '解锁约 1800 万枚 IMX 代币',
  });

  // 1月20日 - 2个事件
  events.push({
    id: `upgrade-${yearSuffix}-4`,
    date: dateStr(20),
    time: '10:00 UTC',
    title: 'Ethereum Cancun',
    type: 'upgrade',
    description: '以太坊 Cancun 升级激活',
  });
  events.push({
    id: `airdrop-${yearSuffix}-3`,
    date: dateStr(20),
    title: 'Scroll 空投',
    type: 'airdrop',
    description: 'Scroll zkRollup 空投申领',
  });

  // 1月22日 - 8个事件（测试滚动）
  events.push({
    id: `unlock-${yearSuffix}-4`,
    date: dateStr(22),
    time: '06:00 UTC',
    title: 'ARB 代币解锁',
    type: 'unlock',
    description: '解锁约 9000 万枚 ARB 代币',
  });
  events.push({
    id: `unlock-${yearSuffix}-5`,
    date: dateStr(22),
    time: '08:00 UTC',
    title: 'INJ 代币解锁',
    type: 'unlock',
    description: '解锁约 70 万枚 INJ 代币',
  });
  events.push({
    id: `airdrop-${yearSuffix}-4`,
    date: dateStr(22),
    time: '10:00 UTC',
    title: 'Base 空投',
    type: 'airdrop',
    description: 'Base 生态空投第二季',
  });
  events.push({
    id: `upgrade-${yearSuffix}-5`,
    date: dateStr(22),
    time: '12:00 UTC',
    title: 'Solana 升级',
    type: 'upgrade',
    description: 'Solana v1.16 升级',
  });
  events.push({
    id: `conf-${yearSuffix}-5`,
    date: dateStr(22),
    time: '14:00 UTC',
    title: '巴黎区块链周',
    type: 'conference',
    description: '欧洲最大区块链会议',
  });
  events.push({
    id: `upgrade-${yearSuffix}-8`,
    date: dateStr(22),
    time: '16:00 UTC',
    title: 'Cosmos 升级',
    type: 'upgrade',
    description: 'Cosmos SDK v0.47 升级',
  });
  events.push({
    id: `airdrop-${yearSuffix}-6`,
    date: dateStr(22),
    title: 'Lens Protocol 空投',
    type: 'airdrop',
    description: 'Lens 社交图谱空投',
  });
  events.push({
    id: `unlock-${yearSuffix}-7`,
    date: dateStr(22),
    time: '20:00 UTC',
    title: 'GLM 代币解锁',
    type: 'unlock',
    description: '解锁约 500 万枚 GLM 代币',
  });

  // 1月25日 - 2个事件
  events.push({
    id: `airdrop-${yearSuffix}-5`,
    date: dateStr(25),
    title: 'Cosmos 空投',
    type: 'airdrop',
    description: 'Cosmos 生态空投',
  });
  events.push({
    id: `upgrade-${yearSuffix}-6`,
    date: dateStr(25),
    time: '16:00 UTC',
    title: 'Avalanche Cortina',
    type: 'upgrade',
    description: 'Avalanche Cortina 升级',
  });

  // 1月28日 - 3个事件
  events.push({
    id: `unlock-${yearSuffix}-6`,
    date: dateStr(28),
    time: '08:00 UTC',
    title: 'AXS 代币解锁',
    type: 'unlock',
    description: '解锁约 450 万枚 AXS 代币',
  });
  events.push({
    id: `upgrade-${yearSuffix}-7`,
    date: dateStr(28),
    time: '12:00 UTC',
    title: 'BNB Chain升级',
    type: 'upgrade',
    description: 'BNB Chain 硬分叉升级',
  });
  events.push({
    id: `conf-${yearSuffix}-6`,
    date: dateStr(28),
    title: 'TOKEN2049',
    type: 'conference',
    description: '新加坡加密货币大会',
  });

  // === 今日事件（确保有数据）===
  const today = now.getDate();
  const todayStr = dateStr(today);

  // 检查今日是否已有事件，如果没有则添加
  const hasTodayEvent = events.some(e => e.date === todayStr);
  if (!hasTodayEvent) {
    // 今日添加2个事件
    events.push({
      id: 'today-1',
      date: todayStr,
      time: '10:00 UTC',
      title: '今日重要事件',
      type: 'upgrade',
      description: '这是一个今日事件示例',
    });
    events.push({
      id: 'today-2',
      date: todayStr,
      title: '今日空投',
      type: 'airdrop',
      description: '今日空投申领开放',
    });
  }

  return events;
}

/**
 * 获取按日期分组的事件
 */
export function getEventsByDate(events: Web3Event[]): Record<string, Web3Event[]> {
  const grouped: Record<string, Web3Event[]> = {};

  for (const event of events) {
    if (!grouped[event.date]) {
      grouped[event.date] = [];
    }
    grouped[event.date].push(event);
  }

  return grouped;
}

/**
 * 获取指定日期的事件
 */
export function getEventsForDate(date: string, eventsByDate: Record<string, Web3Event[]>): Web3Event[] {
  return eventsByDate[date] || [];
}

/**
 * 获取今日事件（按优先级排序）
 */
export function getTodayEvents(eventsByDate: Record<string, Web3Event[]>): Web3Event[] {
  const today = new Date().toISOString().split('T')[0];
  const events = getEventsForDate(today, eventsByDate);

  // 按优先级排序
  return events.sort((a, b) => {
    const priorityMap = { unlock: 1, airdrop: 2, upgrade: 3, conference: 4 };
    return priorityMap[a.type] - priorityMap[b.type];
  });
}
