import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export async function appendNdjsonLine(
  path: string,
  line: unknown,
  lockPath = `${path}.lock`
): Promise<void> {
  await ensureDir(dirname(path));
  const release = await acquireLock(lockPath);
  try {
    const file = await open(path, "a");
    try {
      await file.write(`${JSON.stringify(line)}\n`);
    } finally {
      await file.close();
    }
  } finally {
    await release();
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readNdjsonFile<T>(path: string): Promise<T[]> {
  if (!(await fileExists(path))) {
    return [];
  }

  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  await ensureDir(dirname(lockPath));
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      return async () => {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export function joinHarnessPath(root: string, ...parts: string[]): string {
  return join(root, ".harness", ...parts);
}
