// --import this to apply M1 (see hooks.mjs).
import { register } from 'node:module';
register(new URL('./hooks.mjs', import.meta.url));
