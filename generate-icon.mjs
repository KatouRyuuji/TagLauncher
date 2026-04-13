import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import pngToIco from 'png-to-ico';

const iconDir = './src-tauri/icons';

// 创建一个简单的蓝色渐变图标
async function generateIcon() {
  const size = 1024;

  // 创建 SVG 图标
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="200" fill="url(#grad)"/>
      <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="500" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">T</text>
    </svg>
  `;

  const baseImage = sharp(Buffer.from(svg));

  // 生成不同尺寸的 PNG
  const sizes = [32, 128, 256, 512];

  if (!fs.existsSync(iconDir)) {
    fs.mkdirSync(iconDir, { recursive: true });
  }

  // 生成 PNG 文件
  for (const s of sizes) {
    await baseImage.clone().resize(s, s).png().toFile(path.join(iconDir, `${s}x${s}.png`));
  }

  // 生成 icon.png (512x512)
  await baseImage.clone().resize(512, 512).png().toFile(path.join(iconDir, 'icon.png'));

  // 生成真正的 ICO 文件
  const icoBuffer = await pngToIco([path.join(iconDir, '256x256.png')]);
  fs.writeFileSync(path.join(iconDir, 'icon.ico'), icoBuffer);

  // 生成 Square*Logo.png for Windows Store
  await baseImage.clone().resize(30, 30).png().toFile(path.join(iconDir, 'Square30x30Logo.png'));
  await baseImage.clone().resize(44, 44).png().toFile(path.join(iconDir, 'Square44x44Logo.png'));
  await baseImage.clone().resize(71, 71).png().toFile(path.join(iconDir, 'Square71x71Logo.png'));
  await baseImage.clone().resize(89, 89).png().toFile(path.join(iconDir, 'Square89x89Logo.png'));
  await baseImage.clone().resize(107, 107).png().toFile(path.join(iconDir, 'Square107x107Logo.png'));
  await baseImage.clone().resize(142, 142).png().toFile(path.join(iconDir, 'Square142x142Logo.png'));
  await baseImage.clone().resize(150, 150).png().toFile(path.join(iconDir, 'Square150x150Logo.png'));
  await baseImage.clone().resize(284, 284).png().toFile(path.join(iconDir, 'Square284x284Logo.png'));
  await baseImage.clone().resize(310, 310).png().toFile(path.join(iconDir, 'Square310x310Logo.png'));

  // StoreLogo
  await baseImage.clone().resize(50, 50).png().toFile(path.join(iconDir, 'StoreLogo.png'));

  console.log('图标生成完成！');
}

generateIcon().catch(console.error);
