import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../web/", import.meta.url));
const outputRoot = fileURLToPath(new URL("../.build/web/", import.meta.url));
const javascriptExtensions = new Set([".js", ".mjs", ".cjs"]);
const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });

async function emitFile(sourcePath: string): Promise<void> {
  const sourceRelativePath = relative(sourceRoot, sourcePath);
  const extension = extname(sourcePath);

  if (javascriptExtensions.has(extension)) {
    throw new Error(`JavaScript source is forbidden in web/: ${sourceRelativePath}`);
  }

  if (sourcePath.endsWith(".d.ts")) return;

  if (extension === ".ts") {
    const outputPath = join(outputRoot, sourceRelativePath.replace(/\.ts$/, ".js"));
    const source = await readFile(sourcePath, "utf8");
    const javascript = transpiler.transformSync(source);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, javascript, "utf8");
    return;
  }

  const outputPath = join(outputRoot, sourceRelativePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await copyFile(sourcePath, outputPath);
}

async function walk(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(sourcePath);
      continue;
    }
    if (entry.isFile()) await emitFile(sourcePath);
  }
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await walk(sourceRoot);

console.log("Transpiled TypeScript web source to .build/web");
