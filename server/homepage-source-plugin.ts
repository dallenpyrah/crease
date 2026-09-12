import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { Plugin } from 'vite';

import type { SourceEvidence, SourceSpan } from '../src/source-schema.js';
import {
  type AutomaticTransformResult,
  transformAutomaticContext,
} from './automatic-transform.js';
import { SourceEvidenceRegistry } from './source-evidence.js';

const HOMEPAGE_SOURCES = 'virtual:creasekit-homepage-sources';
const RESOLVED_HOMEPAGE_SOURCES = `\0${HOMEPAGE_SOURCES}`;
const AUTOMATIC_RUNTIME = 'virtual:creasekit-runtime';
const INSTRUMENTED_FILES = ['src/main.ts', 'src/entry.ts'] as const;
const STATIC_STYLE_FILES = [...INSTRUMENTED_FILES, 'src/styles.ts'] as const;
const MANIFEST_BATCH_SIZE = 8;

interface PreparedTransform {
  readonly original: string;
  readonly transformed: AutomaticTransformResult;
}

export const homepageSourceDemo = (): Plugin => {
  let projectRoot: string | undefined;
  let runtimePath: string | undefined;
  let prepared = new Map<string, PreparedTransform>();
  let sources: ReadonlyArray<SourceEvidence> = [];
  let preparedForBuild = false;

  return {
    name: 'creasekit-homepage-source-demo',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      projectRoot = realpathSync(config.root);
      runtimePath = resolve(projectRoot, 'src/homepage-source-runtime.ts');
    },
    async buildStart() {
      if (projectRoot === undefined || runtimePath === undefined) {
        this.error('homepage source demo did not receive a resolved Vite root');
      }

      const root = projectRoot;
      preparedForBuild = false;
      prepared = new Map();
      sources = [];
      const instrumentationPaths = new Map<string, string>();
      const staticStylePaths = new Set<string>();
      try {
        for (const file of INSTRUMENTED_FILES) {
          const path = canonicalProjectFile(root, file);
          instrumentationPaths.set(path, file);
          staticStylePaths.add(path);
        }
        for (const file of STATIC_STYLE_FILES) {
          staticStylePaths.add(canonicalProjectFile(root, file));
        }
        const canonicalRuntime = canonicalProjectFile(
          root,
          'src/homepage-source-runtime.ts',
        );
        runtimePath = canonicalRuntime;
      } catch (error) {
        this.error(
          error instanceof Error
            ? error.message
            : 'homepage source demo could not establish its source allowlist',
        );
      }

      const registry = new SourceEvidenceRegistry(root);
      registry.setResolver(async (specifier, importer) => {
        const canonicalImporter = canonicalAllowedPath(
          importer,
          root,
          staticStylePaths,
        );
        if (canonicalImporter === undefined) return undefined;

        const resolved = await this.resolve(specifier, canonicalImporter, {
          skipSelf: true,
        });
        if (resolved == null) return undefined;
        return canonicalAllowedPath(resolved.id, root, staticStylePaths);
      });

      const nextPrepared = new Map<string, PreparedTransform>();
      const references: Array<SourceSpan> = [];
      const seenReferences = new Set<string>();
      for (const [path, file] of instrumentationPaths) {
        let original: string;
        try {
          original = await readFile(path, 'utf8');
        } catch {
          this.error(`homepage source demo could not read ${file}`);
        }
        const transformed = transformAutomaticContext(original, path, root, {
          sourceEvidence: true,
        });
        if (transformed === null) {
          this.error(`homepage source demo could not instrument ${file}`);
        }
        registry.registerTransform(path, original, transformed.sourceReferences);
        nextPrepared.set(path, { original, transformed });

        for (const reference of transformed.sourceReferences) {
          if (reference.source.view === 'Model') continue;
          const key = sourceKey(reference.source);
          if (!seenReferences.has(key)) {
            seenReferences.add(key);
            references.push(reference.source);
          }
        }
      }

      const manifest = await manifestFromRegistry(registry, references, this.error);
      validateManifest(manifest, root, staticStylePaths, this.error);

      prepared = nextPrepared;
      sources = manifest;
      preparedForBuild = true;
    },
    resolveId(id) {
      if (id === HOMEPAGE_SOURCES) return RESOLVED_HOMEPAGE_SOURCES;
      if (id === AUTOMATIC_RUNTIME) return runtimePath;
    },
    load(id) {
      if (id !== RESOLVED_HOMEPAGE_SOURCES) return;
      if (!preparedForBuild) {
        this.error('homepage source manifest was requested before build preparation');
      }
      return `export const sources = ${JSON.stringify(sources)};\n`;
    },
    transform: {
      order: 'pre',
      handler(code, id) {
        if (projectRoot === undefined) {
          this.error('homepage source demo did not receive a resolved Vite root');
        }
        const path = canonicalAllowedPath(id, projectRoot, new Set(prepared.keys()));
        if (path === undefined) return;
        if (!preparedForBuild) {
          this.error('homepage source transform ran before build preparation');
        }
        const captured = prepared.get(path);
        if (captured === undefined) {
          this.error(
            'homepage source transform was not prepared for an allowlisted file',
          );
        }
        if (code !== captured.original) {
          this.error(
            `homepage source transform input for ${projectFile(projectRoot, path)} no longer matches its original source`,
          );
        }
        return captured.transformed;
      },
    },
  };
};

const manifestFromRegistry = async (
  registry: SourceEvidenceRegistry,
  references: ReadonlyArray<SourceSpan>,
  fail: (error: Error | string) => never,
): Promise<ReadonlyArray<SourceEvidence>> => {
  const manifest: Array<SourceEvidence> = [];
  for (let start = 0; start < references.length; start += MANIFEST_BATCH_SIZE) {
    const batch = references.slice(start, start + MANIFEST_BATCH_SIZE);
    const evidence = await Promise.all(
      batch.map(async (reference) => {
        const [source] = await registry.sources([reference]);
        return source;
      }),
    );
    for (const [index, source] of evidence.entries()) {
      const expected = batch[index];
      if (
        expected === undefined ||
        source === undefined ||
        source.status !== 'current' ||
        source.snippet === undefined ||
        sourceKey(source) !== sourceKey(expected)
      ) {
        fail('homepage source manifest could not prove its original source evidence');
      }
      manifest.push(source);
    }
  }
  return manifest;
};

const validateManifest = (
  sources: ReadonlyArray<SourceEvidence>,
  projectRoot: string,
  allowedStaticStylePaths: ReadonlySet<string>,
  fail: (error: Error | string) => never,
): void => {
  const allowedFiles = new Set(
    Array.from(allowedStaticStylePaths, (path) => projectFile(projectRoot, path)),
  );
  for (const source of sources) {
    if (source.view === 'Model' || !allowedFiles.has(source.file)) {
      fail('homepage source manifest contains a disallowed source record');
    }
    for (const style of source.styles ?? []) {
      if (
        !allowedFiles.has(style.use.file) ||
        (style.definition !== undefined && !allowedFiles.has(style.definition.file))
      ) {
        fail('homepage source manifest contains a disallowed style record');
      }
    }
  }
  const serialized = JSON.stringify(sources);
  if (
    serialized.includes(projectRoot) ||
    serialized.includes(projectRoot.split(sep).join('/')) ||
    serialized.includes('/@fs/') ||
    serialized.includes('/__creasekit/')
  ) {
    fail('homepage source manifest contains private path or endpoint data');
  }
};

const canonicalProjectFile = (root: string, file: string): string => {
  const expected = resolve(root, file);
  const path = realpathSync(expected);
  if (!isWithin(root, path) || projectFile(root, path) !== file) {
    throw new Error(`homepage source allowlist rejected ${file}`);
  }
  return path;
};

const canonicalAllowedPath = (
  id: string,
  root: string,
  allowed: ReadonlySet<string>,
): string | undefined => {
  if (
    id.includes('\0') ||
    id.startsWith('virtual:') ||
    id.includes('?') ||
    id.includes('#')
  ) {
    return undefined;
  }
  let path: string;
  try {
    const requested = isAbsolute(id) ? id : resolve(root, id);
    path = realpathSync(requested);
  } catch {
    return undefined;
  }
  return isWithin(root, path) && allowed.has(path) ? path : undefined;
};

const isWithin = (root: string, path: string): boolean => {
  const pathRelative = relative(root, path);
  return (
    pathRelative !== '' &&
    pathRelative !== '..' &&
    !pathRelative.startsWith(`..${sep}`) &&
    !isAbsolute(pathRelative)
  );
};

const projectFile = (root: string, path: string): string =>
  relative(root, path).split(sep).join('/');

const sourceKey = (source: SourceSpan): string =>
  [
    source.file,
    source.view,
    source.line,
    source.column,
    source.endLine,
    source.endColumn,
    source.revision,
  ].join('\u0000');
