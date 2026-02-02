// 测试 Alchemy API Key 获取
const fs = require('fs');
const path = require('path');

// 读取 .dev.vars
const devVarsPath = path.join(__dirname, '.dev.vars');
if (fs.existsSync(devVarsPath)) {
  const content = fs.readFileSync(devVarsPath, 'utf-8');
  const lines = content.split('\n');
  lines.forEach(line => {
    if (line.startsWith('ALCHEMY_API_KEY=')) {
      const key = line.split('=')[1];
      console.log('✅ Alchemy API Key found:', key ? `${key.substring(0, 10)}...` : 'empty');
    }
  });
} else {
  console.log('❌ .dev.vars file not found');
}
