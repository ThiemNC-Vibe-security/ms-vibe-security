import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const absolutePath = path.resolve(filePath);
  const content = await readFile(absolutePath, 'utf-8');

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`Invalid JSON in file: ${absolutePath}`);
  }
}

export async function writeOutputFile(filePath: string, content: string): Promise<void> {
  const absolutePath = path.resolve(filePath);
  const dir = path.dirname(absolutePath);

  await mkdir(dir, { recursive: true });
  await writeFile(absolutePath, content, 'utf-8');
}
