import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { performance } from "node:perf_hooks";
import { createChunkedDocument, renderChunk, setTheme } from "../src/lib/md.ts";

const path = process.argv[2]!;
const source = readFileSync(path, "utf-8");
const basePath = dirname(resolve(path));
setTheme("dark");

const doc = createChunkedDocument(source, basePath, 900);
console.log(`chunks=${doc.chunks.length}`);
for (let i = 0; i < doc.chunks.length; i++) {
  const c = doc.chunks[i]!;
  const types = c.tokens.map(t => t.type === "code" ? `code(${(t as any).text.split("\n").length})` : t.type).join(",");
  process.stdout.write(`chunk ${i+1}/${doc.chunks.length} estH=${c.estimatedHeight} types=${types.slice(0,80)} ... `);
  const t0 = performance.now();
  await Promise.race([
    renderChunk(doc, i),
    new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT 15s")), 15000)),
  ]).catch(e => { console.log(`FAIL: ${e.message}`); throw e; });
  console.log(`${(performance.now() - t0).toFixed(0)}ms`);
}
