import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');

export async function cleanDist() {
  const resolvedRoot = projectRoot;
  const distPath = path.resolve(resolvedRoot, 'dist');
  if (path.dirname(distPath) !== resolvedRoot || path.basename(distPath) !== 'dist') {
    throw new Error(`refusing to clean unexpected build output: ${distPath}`);
  }
  await rm(distPath, { recursive: true, force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await cleanDist();
}
