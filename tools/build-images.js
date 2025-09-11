import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

const INPUT_DIR = "assets/images/originals";
const OUT_DIR = "assets/images/responsive";
const WIDTHS = [480, 768, 1200, 1600];

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function baseNameNoExt(p) {
  const b = path.basename(p);
  const i = b.lastIndexOf(".");
  return i >= 0 ? b.slice(0, i) : b;
}

async function buildOne(file) {
  const rel = path.relative(INPUT_DIR, file);
  const stem = baseNameNoExt(rel);
  const outSub = path.join(OUT_DIR, stem);
  await ensureDir(outSub);

  const buf = await fs.readFile(file);
  const meta = await sharp(buf).metadata();
  const origW = meta.width || Math.max(...WIDTHS);

  for (const w of WIDTHS) {
    const targetW = Math.min(w, origW);

    // AVIF
    await sharp(buf)
      .resize({ width: targetW })
      .avif({ quality: 50 })
      .toFile(path.join(outSub, `${stem}-${w}w.avif`));

    // WebP
    await sharp(buf)
      .resize({ width: targetW })
      .webp({ quality: 70 })
      .toFile(path.join(outSub, `${stem}-${w}w.webp`));

    // JPEG (fallback)
    await sharp(buf)
      .resize({ width: targetW })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(path.join(outSub, `${stem}-${w}w.jpg`));
  }

  // Return a little manifest line we can use in includes if desired
  return { stem, widths: WIDTHS, width: meta.width, height: meta.height };
}

async function run() {
  const files = await fg(`${INPUT_DIR}/**/*.{jpg,jpeg,png,tif,tiff,webp}`, {
    dot: false,
  });
  const manifest = [];
  for (const file of files) {
    const item = await buildOne(file);
    manifest.push(item);
  }
  await fs.writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`Built responsive images for ${manifest.length} source(s).`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
