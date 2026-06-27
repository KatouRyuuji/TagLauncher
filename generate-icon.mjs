// 备用图标生成脚本（手动运行：node generate-icon.mjs）。
// 推荐优先使用官方命令：`npm run tauri icon src/assets/icon.png`
// 它会从同一源图生成全部平台图标（含 icon.icns / @2x / Square / android / ios）。
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import pngToIco from 'png-to-ico';

const iconDir = './src-tauri/icons';
// 应用图标唯一源（以此为准）
const sourceIcon = './src/assets/icon.png';

async function generateIcon() {
  const baseImage = sharp(sourceIcon);
  const sizes = [32, 64, 128, 256, 512];

  if (!fs.existsSync(iconDir)) {
    fs.mkdirSync(iconDir, { recursive: true });
  }

  for (const s of sizes) {
    await baseImage.clone().resize(s, s).png().toFile(path.join(iconDir, `${s}x${s}.png`));
  }

  await baseImage.clone().resize(512, 512).png().toFile(path.join(iconDir, 'icon.png'));
  // tauri.conf.json 引用的高分屏图标（256x256 内容，按 @2x 命名）
  await baseImage.clone().resize(256, 256).png().toFile(path.join(iconDir, '128x128@2x.png'));

  const icoBuffer = await pngToIco([
    path.join(iconDir, '32x32.png'),
    path.join(iconDir, '64x64.png'),
    path.join(iconDir, '128x128.png'),
    path.join(iconDir, '256x256.png')
  ]);
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
