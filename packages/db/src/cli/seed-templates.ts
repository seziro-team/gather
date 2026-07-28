#!/usr/bin/env node
import { seedBuiltinTemplates } from '../seed.js';
import { connectFromEnv } from './env.js';

const { pool, db } = connectFromEnv();

try {
  const result = await seedBuiltinTemplates(db);
  const report = [
    result.installed.length > 0 ? `installed ${result.installed.join(', ')}` : null,
    result.updated.length > 0 ? `updated ${result.updated.join(', ')}` : null,
    result.unchanged.length > 0 ? `unchanged ${result.unchanged.join(', ')}` : null,
  ].filter(Boolean);
  process.stdout.write(`Built-in templates: ${report.join('; ')}.\n`);
} catch (error) {
  process.stderr.write(`Seeding built-in templates failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
