import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Type } from '@fastify/type-provider-typebox';
import { DATASET_FILES, isDatasetVersion, type DatasetFileName } from '@msapi/db';
import type { FastifyInstance } from 'fastify';
import { buildCatalog } from '../catalog.ts';
import { problem } from '../http.ts';

interface ReleaseRow {
  version: string;
  notes: string | null;
  created_at: Date | string;
}

const FILE_TYPE: Record<DatasetFileName, string> = {
  [DATASET_FILES.sqlite]: 'application/vnd.sqlite3',
  [DATASET_FILES.json]: 'application/json',
  [DATASET_FILES.csv]: 'application/zip',
};

export async function registerDatasets(app: FastifyInstance, datasetDir: string): Promise<void> {
  const root = resolve(datasetDir);
  let catalog: string | null = null;

  app.get('/datasets/catalog', {
    schema: {
      tags: ['meta'],
      summary: 'Scholars and teacher–student links for the dashboard',
      security: [],
    },
  }, async (_request, reply) => {
    catalog ??= JSON.stringify(await buildCatalog(app.db));
    return reply.header('cache-control', 'public, max-age=3600').type('application/json').send(catalog);
  });

  app.get('/datasets', {
    schema: { tags: ['meta'], summary: 'Published dataset versions', security: [] },
  }, async () => {
    const releases = await app.db.selectFrom('dataset_release')
      .select(['version', 'notes', 'created_at'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return { data: await Promise.all(releases.map(release => describeRelease(root, release))) };
  });

  app.get('/datasets/:version', {
    schema: {
      tags: ['meta'],
      summary: 'One published dataset version',
      security: [],
      params: Type.Object({ version: Type.String() }),
    },
  }, async (request) => {
    const version = (request.params as { version: string }).version;
    const release = await loadRelease(app, version);
    return describeRelease(root, release);
  });

  for (const name of Object.values(DATASET_FILES)) {
    app.get(`/datasets/:version/${name}`, {
      schema: {
        tags: ['meta'],
        summary: `Download ${name}`,
        security: [],
        params: Type.Object({ version: Type.String() }),
      },
    }, async (request, reply) => {
      const version = (request.params as { version: string }).version;
      await loadRelease(app, version);
      const path = resolve(root, version, name);
      if (!path.startsWith(root + sep)) throw problem(404, 'Dataset was not found');
      try {
        await stat(path);
      } catch {
        throw problem(404, 'Dataset file was not found');
      }
      return reply
        .header('cache-control', 'public, max-age=86400')
        .header('content-disposition', `attachment; filename="${name}"`)
        .type(FILE_TYPE[name])
        .send(createReadStream(path));
    });
  }
}

async function loadRelease(app: FastifyInstance, version: string): Promise<ReleaseRow> {
  if (!isDatasetVersion(version)) throw problem(404, 'Dataset was not found');
  const release = await app.db.selectFrom('dataset_release')
    .select(['version', 'notes', 'created_at'])
    .where('version', '=', version)
    .executeTakeFirst();
  if (!release) throw problem(404, 'Dataset was not found');
  return release;
}

async function describeRelease(root: string, release: ReleaseRow) {
  const directory = join(root, release.version);
  const files = [];
  for (const name of Object.values(DATASET_FILES)) {
    try {
      const info = await stat(join(directory, name));
      files.push({
        name,
        bytes: info.size,
        href: `/datasets/${release.version}/${name}`,
      });
    } catch {
      // A version row can exist before its files are copied onto this machine.
    }
  }
  let rows: Record<string, number> | null = null;
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as { rows?: Record<string, number> };
    rows = manifest.rows ?? null;
  } catch {
    // This machine may not have the version's files.
  }
  return {
    version: release.version,
    notes: release.notes,
    created_at: release.created_at instanceof Date ? release.created_at.toISOString() : release.created_at,
    rows,
    files,
  };
}
