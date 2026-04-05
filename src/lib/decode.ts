import sharp from "sharp";
import { execSync } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface DecodedImage {
  png: Buffer;
  rgba: Buffer;
  width: number;
  height: number;
}

/**
 * Decode any supported image format into PNG + raw RGBA buffers.
 * Falls back to macOS sips for formats sharp can't handle (HEIC).
 */
export async function decode(
  input: Buffer | string,
  maxWidth?: number,
  maxHeight?: number,
): Promise<DecodedImage> {
  try {
    return await decodeWithSharp(input, maxWidth, maxHeight);
  } catch {
    if (typeof input === "string" && process.platform === "darwin") {
      return await decodeWithSharp(convertViaSips(input), maxWidth, maxHeight);
    }
    throw new Error("Unsupported image format");
  }
}

async function decodeWithSharp(
  input: Buffer | string,
  maxWidth?: number,
  maxHeight?: number,
): Promise<DecodedImage> {
  let pipeline = sharp(input).rotate(); // auto-rotate based on EXIF orientation

  if (maxWidth || maxHeight) {
    pipeline = pipeline.resize(maxWidth, maxHeight, { fit: "inside" });
  }

  const pngPipeline = pipeline.clone().png();
  const rgbaPipeline = pipeline.clone().ensureAlpha().raw();

  const [png, { data: rgba, info }] = await Promise.all([
    pngPipeline.toBuffer(),
    rgbaPipeline.toBuffer({ resolveWithObject: true }),
  ]);

  return { png, rgba: Buffer.from(rgba), width: info.width, height: info.height };
}

/** Get image dimensions without fully decoding. */
export async function getImageInfo(
  input: Buffer | string,
): Promise<{ width: number; height: number; format: string }> {
  try {
    const meta = await sharp(input).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0, format: meta.format ?? "unknown" };
  } catch {
    if (typeof input === "string" && process.platform === "darwin") {
      const meta = await sharp(convertViaSips(input)).metadata();
      return { width: meta.width ?? 0, height: meta.height ?? 0, format: "heic" };
    }
    throw new Error("Unsupported image format");
  }
}

function convertViaSips(filePath: string): Buffer {
  const tmpPath = join(tmpdir(), `phosphor-${Date.now()}.png`);
  try {
    execSync(`sips -s format png '${filePath.replace(/'/g, "'\\''")}' --out '${tmpPath}'`, {
      stdio: "ignore",
      timeout: 10000,
    });
    return readFileSync(tmpPath);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}
