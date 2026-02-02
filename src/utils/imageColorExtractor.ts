/**
 * 图片颜色提取工具
 * 从图片中提取主要颜色（非黑非白的主色调）
 */

/**
 * 判断颜色是否为黑色或白色（或接近这些颜色）
 */
function isBlackOrWhite(r: number, g: number, b: number, threshold: number = 60): boolean {
  // 判断是否为黑色（RGB 值都很小）
  const isBlack = r < threshold && g < threshold && b < threshold;
  // 判断是否为白色（RGB 值都很大）
  const isWhite = r > 255 - threshold && g > 255 - threshold && b > 255 - threshold;
  // 判断是否为灰色（RGB 值接近）
  const isGray = Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30;
  return isBlack || isWhite || isGray;
}

/**
 * 计算两个颜色之间的欧几里得距离
 */
function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt(
    Math.pow(r1 - r2, 2) + Math.pow(g1 - g2, 2) + Math.pow(b1 - b2, 2)
  );
}

/**
 * 使用图片代理绕过 CORS
 */
function getProxiedImageUrl(imageUrl: string): string {
  // 使用 images.weserv.nl 作为代理（支持 CORS）
  return `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}`;
}

/**
 * RGB 转 HSL
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h * 360, s, l];
}

/**
 * 从图片 URL 提取主要颜色
 * @param imageUrl 图片 URL
 * @returns Promise<string> RGB 颜色字符串，格式为 "rgb(r, g, b)"
 */
export async function extractDominantColor(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // 允许跨域加载图片

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('无法创建 Canvas 上下文'));
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        const width = canvas.width;
        const height = canvas.height;

        // 收集所有非黑非白的颜色及其权重
        const colorMap = new Map<string, { count: number; r: number; g: number; b: number; saturation: number; brightness: number; centerWeight: number }>();

        // 计算颜色饱和度（用于优先选择更鲜艳的颜色）
        const calculateSaturation = (r: number, g: number, b: number): number => {
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max === 0) return 0;
          return (max - min) / max;
        };

        // 计算颜色亮度
        const calculateBrightness = (r: number, g: number, b: number): number => {
          // 使用感知亮度公式
          return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        };

        // 计算像素到中心的距离权重（中心区域权重更高）
        const getCenterWeight = (x: number, y: number, centerX: number, centerY: number, maxDist: number): number => {
          const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
          return 1 - (dist / maxDist) * 0.5; // 中心区域权重 1.0，边缘区域权重 0.5
        };

        const centerX = width / 2;
        const centerY = height / 2;
        const maxDist = Math.sqrt(Math.pow(centerX, 2) + Math.pow(centerY, 2));

        // 采样：每 2 个像素采样一次以提高精度
        const sampleRate = 2;
        for (let i = 0; i < pixels.length; i += 4 * sampleRate) {
          const pixelIndex = i / 4;
          const x = pixelIndex % width;
          const y = Math.floor(pixelIndex / width);
          
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];

          // 跳过透明像素和黑白像素
          if (a < 200 || isBlackOrWhite(r, g, b)) {
            continue;
          }

          // 使用更细粒度的量化（每 8 个值一组）以提高精度
          const quantizedR = Math.floor(r / 8) * 8;
          const quantizedG = Math.floor(g / 8) * 8;
          const quantizedB = Math.floor(b / 8) * 8;
          const colorKey = `${quantizedR},${quantizedG},${quantizedB}`;

          const saturation = calculateSaturation(r, g, b);
          const brightness = calculateBrightness(r, g, b);
          const centerWeight = getCenterWeight(x, y, centerX, centerY, maxDist);
          
          // 过滤掉低饱和度的颜色（可能是背景或渐变）
          if (saturation < 0.2) {
            continue;
          }

          const existing = colorMap.get(colorKey);
          if (existing) {
            existing.count += 1;
            // 累积实际 RGB 值用于后续计算平均值
            existing.r += r;
            existing.g += g;
            existing.b += b;
            // 更新饱和度和亮度（取最大值）
            existing.saturation = Math.max(existing.saturation, saturation);
            existing.brightness = Math.max(existing.brightness, brightness);
            // 累积中心权重
            existing.centerWeight += centerWeight;
          } else {
            colorMap.set(colorKey, { count: 1, r, g, b, saturation, brightness, centerWeight });
          }
        }

        if (colorMap.size === 0) {
          // 如果没有找到有效颜色，返回默认蓝色
          resolve('rgb(33, 150, 243)');
          return;
        }

        // 提取多个候选颜色，计算它们的 HSL 值
        const candidates: Array<{
          r: number;
          g: number;
          b: number;
          h: number;
          s: number;
          l: number;
          brightness: number;
          score: number;
        }> = [];

        for (const [colorKey, data] of colorMap.entries()) {
          const avgR = Math.round(data.r / data.count);
          const avgG = Math.round(data.g / data.count);
          const avgB = Math.round(data.b / data.count);
          
          // 过滤掉全白全黑的颜色
          if (isBlackOrWhite(avgR, avgG, avgB, 80)) {
            continue;
          }

          const [h, s, l] = rgbToHsl(avgR, avgG, avgB);
          const brightness = calculateBrightness(avgR, avgG, avgB);
          const avgCenterWeight = data.centerWeight / data.count;
          
          // 计算分数：出现次数、饱和度、中心权重
          const score = data.count * (1 + data.saturation * 2) * (1 + avgCenterWeight);
          
          candidates.push({
            r: avgR,
            g: avgG,
            b: avgB,
            h,
            s,
            l,
            brightness,
            score,
          });
        }

        if (candidates.length === 0) {
          resolve('rgb(33, 150, 243)');
          return;
        }

        // 按照用户要求排序：
        // 1. Hue 最小（优先）
        // 2. Saturation 最大（次要）
        // 3. 亮度最大（最后）
        // 4. 非白非黑（已在前面过滤）
        candidates.sort((a, b) => {
          // 首先按 hue 排序（最小优先）
          if (Math.abs(a.h - b.h) > 1) {
            return a.h - b.h;
          }
          // 如果 hue 接近，按饱和度排序（最大优先）
          if (Math.abs(a.s - b.s) > 0.01) {
            return b.s - a.s;
          }
          // 如果饱和度也接近，按亮度排序（最大优先）
          if (Math.abs(a.brightness - b.brightness) > 0.01) {
            return b.brightness - a.brightness;
          }
          // 最后按分数排序
          return b.score - a.score;
        });

        const best = candidates[0];
        const dominantColor = `rgb(${best.r}, ${best.g}, ${best.b})`;
        resolve(dominantColor);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('图片加载失败'));
    };

    img.src = imageUrl;
  });
}

/**
 * 缓存已提取的颜色
 */
const colorCache = new Map<string, string>();

/**
 * 从图片 URL 提取主要颜色（带缓存）
 * @param imageUrl 图片 URL
 * @returns Promise<string> RGB 颜色字符串，格式为 "rgb(r, g, b)"
 */
export async function getDominantColor(imageUrl: string): Promise<string | null> {
  if (colorCache.has(imageUrl)) {
    const cached = colorCache.get(imageUrl)!;
    // 如果缓存的是默认蓝色，返回 null 让调用者使用回退颜色
    if (cached === 'rgb(33, 150, 243)') {
      return null;
    }
    return cached;
  }

  // 先尝试直接加载，如果失败则使用代理
  let color: string | null = null;
  let error: Error | null = null;

  try {
    color = await extractDominantColor(imageUrl);
    colorCache.set(imageUrl, color);
    return color;
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
    // 如果直接加载失败，尝试使用代理
    try {
      const proxiedUrl = getProxiedImageUrl(imageUrl);
      color = await extractDominantColor(proxiedUrl);
      colorCache.set(imageUrl, color);
      return color;
    } catch (proxyError) {
      console.warn('提取图片颜色失败（包括代理）:', error, proxyError);
      // 缓存失败标记，避免重复尝试
      colorCache.set(imageUrl, 'rgb(33, 150, 243)');
      return null; // 返回 null，让调用者使用回退颜色
    }
  }
}
