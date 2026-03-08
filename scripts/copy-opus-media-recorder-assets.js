const fs = require('node:fs');
const path = require('node:path');

const projectRoot = process.cwd();
const publicDir = path.join(projectRoot, 'public', 'vendor', 'opus-media-recorder');
const assetNames = [
  'encoderWorker.umd.js',
  'OggOpusEncoder.wasm',
  'WebMOpusEncoder.wasm',
];

function findPackageRoot() {
  try {
    return path.dirname(require.resolve('opus-media-recorder/package.json', { paths: [projectRoot] }));
  } catch (error) {
    console.warn('[copy-opus-media-recorder-assets] opus-media-recorder is not installed yet');
    return null;
  }
}

function resolveAssetPath(packageRoot, assetName) {
  const candidates = [
    path.join(packageRoot, assetName),
    path.join(packageRoot, 'dist', assetName),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function main() {
  const packageRoot = findPackageRoot();
  if (!packageRoot) {
    return;
  }

  fs.mkdirSync(publicDir, { recursive: true });

  for (const assetName of assetNames) {
    const sourcePath = resolveAssetPath(packageRoot, assetName);
    if (!sourcePath) {
      console.warn(`[copy-opus-media-recorder-assets] missing asset: ${assetName}`);
      continue;
    }

    const destinationPath = path.join(publicDir, assetName);
    fs.copyFileSync(sourcePath, destinationPath);
    console.log(`[copy-opus-media-recorder-assets] copied ${assetName}`);
  }
}

main();
