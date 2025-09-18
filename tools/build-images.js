import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

/**
 * tools/build-images.js
 *
 * - Scans INPUT_DIR for source images
 * - Generates AVIF, WebP and JPEG variants at the widths in WIDTHS
 * - Skips variants that are already up-to-date (source mtime <= output mtime)
 * - Applies EXIF orientation via .rotate()
 * - Limits concurrent image processing to CONCURRENCY
 * - Emits a manifest.json with details about generated files
 *
 * Usage (from repo root):
 *   node tools/build-images.js
 *
 * Note: CI runners must have libvips installed for sharp to work.
 */

const INPUT_DIR = "assets/images/originals";
const OUT_DIR = "assets/images/responsive";
const WIDTHS = [480, 768, 1200, 1600];
// Tune concurrency to runner capacity (4 is a reasonable default)
const CONCURRENCY = 4;

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function baseNameNoExt(filePath) {
  const b = path.basename(filePath);
  const i = b.lastIndexOf(".");
  return i >= 0 ? b.slice(0, i) : b;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function mtimeMs(p) {
  try {
    const st = await fs.stat(p);
    return st.mtimeMs;
  } catch {
    return 0;
  }
}

async function buildOne(srcFile) {
  const rel = path.relative(INPUT_DIR, srcFile);
  const stem = baseNameNoExt(rel);
  const outSub = path.join(OUT_DIR, stem);
  await ensureDir(outSub);

  const srcMtime = await mtimeMs(srcFile);
  const buf = await fs.readFile(srcFile);
  const meta = await sharp(buf).metadata();
  const origW = meta.width || Math.max(...WIDTHS);
  const origH = meta.height || null;

  const generated = [];

  for (const w of WIDTHS) {
    const targetW = Math.min(w, origW);
    // filenames include the actual target width to avoid misleading names
    const avifPath = path.join(outSub, `${stem}-${targetW}w.avif`);
    const webpPath = path.join(outSub, `${stem}-${targetW}w.webp`);
    const jpgPath = path.join(outSub, `${stem}-${targetW}w.jpg`);

    const avifUpToDate =
      (await fileExists(avifPath)) && (await mtimeMs(avifPath)) >= srcMtime;
    const webpUpToDate =
      (await fileExists(webpPath)) && (await mtimeMs(webpPath)) >= srcMtime;
    const jpgUpToDate =
      (await fileExists(jpgPath)) && (await mtimeMs(jpgPath)) >= srcMtime;

    if (avifUpToDate && webpUpToDate && jpgUpToDate) {
      generated.push({
        width: targetW,
        avif: path.relative(".", avifPath),
        webp: path.relative(".", webpPath),
        jpg: path.relative(".", jpgPath),
        skipped: true,
      });
      continue;
    }

    try {
      // rotate() to apply EXIF orientation, withoutEnlargement to avoid upscaling
      const base = sharp(buf)
        .rotate()
        .resize({ width: targetW, withoutEnlargement: true });

      if (!avifUpToDate) {
        await base.clone().avif({ quality: 50 }).toFile(avifPath);
      }
      if (!webpUpToDate) {
        await base.clone().webp({ quality: 70 }).toFile(webpPath);
      }
      if (!jpgUpToDate) {
        await base.clone().jpeg({ quality: 78, mozjpeg: true }).toFile(jpgPath);
      }

      generated.push({
        width: targetW,
        avif: path.relative(".", avifPath),
        webp: path.relative(".", webpPath),
        jpg: path.relative(".", jpgPath),
        skipped: false,
      });
    } catch (err) {
      console.error(`Error processing ${srcFile} @ ${targetW}px:`, err);
      generated.push({
        width: targetW,
        error: String(err),
      });
    }
  }

  return {
    source: srcFile,
    stem,
    originalWidth: origW,
    originalHeight: origH,
    generated,
  };
}

/**
 * Simple concurrency runner: runs up to `limit` workers in parallel.
 */
async function runWithLimit(items, worker, limit = CONCURRENCY) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = (async () => worker(item))();
    results.push(p);
    executing.add(p);

    p.finally(() => executing.delete(p));

    if (executing.size >= limit) {
      // wait for one to finish before queuing another
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

async function run() {
  const pattern = `${INPUT_DIR}/**/*.{jpg,jpeg,png,tif,tiff,webp}`;
  const files = await fg(pattern, { onlyFiles: true, dot: false });

  if (files.length === 0) {
    console.log("No source images found. Nothing to do.");
    return;
  }

  await ensureDir(OUT_DIR);
  console.log(
    `Found ${files.length} source image(s). Processing with concurrency ${CONCURRENCY}...`,
  );

  const manifest = await runWithLimit(files, buildOne, CONCURRENCY);

  // Normalize manifest: make generated paths repo-relative and include summary info
  const normalized = manifest.map((m) => ({
    source: path.relative(".", m.source),
    stem: m.stem,
    originalWidth: m.originalWidth,
    originalHeight: m.originalHeight,
    generated: m.generated,
  }));

  const manifestPath = path.join(OUT_DIR, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(normalized, null, 2));
  console.log(
    `Built responsive images for ${manifest.length} source(s). Manifest written to ${manifestPath}`,
  );

  // Also write manifest into _data so Jekyll can read it during site build.
  // This makes the manifest available as site.data.images_manifest in Liquid.
  try {
    await ensureDir(path.join("_data"));
    await fs.writeFile(
      path.join("_data", "images_manifest.json"),
      JSON.stringify(normalized, null, 2),
    );
    console.log("Wrote _data/images_manifest.json for Jekyll consumption.");
  } catch (err) {
    console.warn(
      "Could not write _data/images_manifest.json:",
      err && err.message ? err.message : err,
    );
  }
}

run().catch((err) => {
  console.error("Fatal error during image build:", err);
  process.exit(1);
});
