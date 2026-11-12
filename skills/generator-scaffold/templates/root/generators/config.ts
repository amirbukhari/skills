import { fileURLToPath } from 'node:url';

/** Where generation writes, relative to the project root, and how generated headers name the commands. */
export const config = {
  apiDir: '__API_DIR__',
  sharedDir: '__SHARED_DIR__',
  run: '__PM_RUN__',
} as const;

/** The project root: the folder that holds generators/. */
export const projectRoot = fileURLToPath(new URL('..', import.meta.url));
