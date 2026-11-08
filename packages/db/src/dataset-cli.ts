import { buildDataset } from './dataset.ts';

if (import.meta.main) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
  const version = flag('--version') ?? new Date().toISOString().slice(0, 10);
  const directory = flag('--dir') ?? process.env.DATASET_DIR ?? 'data/datasets';
  const notes = flag('--notes');
  const built = await buildDataset({ connectionString, directory, version, notes });
  console.log(`wrote ${built.version} (${built.rows.scholar ?? 0} scholars) to ${built.directory}`);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}
