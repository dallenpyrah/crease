import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

test(
  'the published artifact works in a separate FoldKit app and MCP launcher',
  { timeout: 180_000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'creasekit-package-'));
    const app = join(temporary, 'app');
    const launcher = join(temporary, 'launcher');
    let server;
    try {
      const packed = await run(
        'npm',
        ['pack', '--json', '--pack-destination', temporary],
        { cwd: root, maxBuffer: 4 * 1024 * 1024 },
      );
      const [tarball] = JSON.parse(packed.stdout);
      const artifact = join(temporary, tarball.filename);

      await t.test(
        'ships only the runtime, declarations, and public package metadata',
        async () => {
          const paths = tarball.files.map((file) => file.path);
          for (const path of paths) {
            assert(
              /^(package\.json|README\.md|LICENSE|dist\/THIRD_PARTY_NOTICES\.txt|dist\/(index|vite|cli|automatic)\.js|dist\/chunks\/[\w-]+\.js|dist\/types\/.+\.d\.ts)$/.test(
                path,
              ),
              `Unexpected package file: ${path}`,
            );
          }
          for (const path of [
            'dist/index.js',
            'dist/vite.js',
            'dist/cli.js',
            'dist/automatic.js',
            'dist/THIRD_PARTY_NOTICES.txt',
            'dist/types/src/index.d.ts',
            'dist/types/server/vite-plugin.d.ts',
          ])
            assert(paths.includes(path), `Missing ${path}`);
          assert.equal(
            tarball.files.find((file) => file.path === 'dist/cli.js').mode & 0o111,
            0o111,
          );
          const notices = await readFile(
            join(root, 'dist/THIRD_PARTY_NOTICES.txt'),
            'utf8',
          );
          for (const dependency of [
            'effect',
            '@effect/platform-node',
            '@effect/platform-node-shared',
            'detect-libc',
            'msgpackr',
            'msgpackr-extract',
            'node-gyp-build-optional-packages',
          ]) {
            assert(notices.includes(`${dependency}@`));
            assert(
              notices.includes(
                await readFile(
                  join(root, 'node_modules', dependency, 'LICENSE'),
                  'utf8',
                ),
              ),
            );
          }
          const browser = (
            await Promise.all(
              paths
                .filter(
                  (path) => path === 'dist/index.js' || path.startsWith('dist/chunks/'),
                )
                .map((path) => readFile(join(root, path), 'utf8')),
            )
          ).join('\n');
          assert.match(browser, /data:image\/svg\+xml/);
          assert.doesNotMatch(
            browser,
            /from ["']node:|from ["']@effect\/platform-node|\/src\/assets\//,
          );
        },
      );

      await cp(new URL('./fixtures/foldkit-app/', import.meta.url), app, {
        recursive: true,
      });
      const base = {
        private: true,
        type: 'module',
        dependencies: { creasekit: `file:${artifact}` },
      };
      await writeFile(
        join(app, 'package.json'),
        JSON.stringify({
          ...base,
          dependencies: {
            creasekit: base.dependencies.creasekit,
            effect: metadata.dependencies.effect,
            foldkit: metadata.devDependencies.foldkit,
            '@effect/platform-browser':
              metadata.devDependencies['@effect/platform-browser'],
            '@foldkit/vite-plugin': metadata.devDependencies['@foldkit/vite-plugin'],
            vite: metadata.devDependencies.vite,
            typescript: metadata.devDependencies.typescript,
          },
        }),
      );
      await cp(app, launcher, { recursive: true });
      await writeFile(join(launcher, 'package.json'), JSON.stringify(base));
      await Promise.all(
        [app, launcher].map((cwd) =>
          run('npm', ['install', '--no-audit', '--no-fund'], {
            cwd,
            maxBuffer: 4 * 1024 * 1024,
          }),
        ),
      );

      await t.test(
        'has usable TypeScript exports without depending on repository source',
        async () => {
          await run(join(app, 'node_modules/.bin/tsc'), ['--noEmit'], { cwd: app });
          await writeFile(
            join(app, 'types.mts'),
            `import { mountCreasekit, createAgentConnection, createFoldkitInspector, type CreasekitOptions } from 'creasekit';\nimport { creasekit } from 'creasekit/vite';\ntype IsAny<T> = 0 extends (1 & T) ? true : false;\nexport const checked: IsAny<CreasekitOptions> = false;\nexport const options: CreasekitOptions = { agent: createAgentConnection(), startOpen: true };\nexport const mount = () => mountCreasekit(options);\nexport const inspector = createFoldkitInspector({ initialModel: { count: 0 }, registrations: [] });\nexport const plugin = creasekit();\n`,
          );
          await run(
            join(app, 'node_modules/.bin/tsc'),
            [
              '--ignoreConfig',
              '--noEmit',
              '--strict',
              '--skipLibCheck',
              '--target',
              'es2022',
              '--module',
              'nodenext',
              '--moduleResolution',
              'nodenext',
              'types.mts',
            ],
            { cwd: app },
          );
        },
      );

      await t.test(
        'runs the binary through npm and bun without Vite, FoldKit, or tsx installed',
        async () => {
          for (const dependency of [
            'vite',
            'foldkit',
            'tsx',
            '@stylexjs',
            '@effect/platform-node',
          ])
            await assert.rejects(stat(join(launcher, 'node_modules', dependency)), {
              code: 'ENOENT',
            });
          for (const [command, args] of [
            ['npm', ['exec', '--no', '--', 'creasekit', '--help']],
            ['bun', ['x', '--no-install', 'creasekit', '--help']],
          ]) {
            const result = await run(command, args, { cwd: launcher });
            assert.match(result.stdout, /Usage: creasekit/);
            assert.match(result.stdout, /--cwd/);
          }
        },
      );

      const require = createRequire(join(app, 'package.json'));
      const vite = await import(require.resolve('vite'));
      server = await vite.createServer({
        root: app,
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      });
      await server.listen();
      const address = server.httpServer.address();
      const origin = `http://127.0.0.1:${address.port}`;
      await t.test(
        'serves the automatic entry and instruments consumer source',
        async () => {
          const html = await (await fetch(origin)).text();
          const proxies = [...html.matchAll(/src="([^"]*html-proxy[^"]*)"/g)].map(
            (match) => match[1],
          );
          const modules = await Promise.all(
            proxies.map((path) =>
              fetch(new URL(path.replaceAll('&amp;', '&'), origin)).then((response) =>
                response.text(),
              ),
            ),
          );
          assert.match([html, ...modules].join('\n'), /creasekit-runtime/);
          const main = await server.transformRequest('/src/main.ts');
          assert(main);
          assert.match(main.code, /virtual:creasekit-runtime/);
          assert.match(main.code, /captureCall/);
          await writeFile(
            join(app, 'src/automatic-entry.ts'),
            `import { Runtime } from 'foldkit';\nimport { Model, init, update, view } from './main';\nRuntime.run(Runtime.makeApplication({ Model, init, update, view, container: document.getElementById('root') }));\n`,
          );
          const entry = await server.transformRequest('/src/automatic-entry.ts');
          assert(entry);
          assert.match(entry.code, /observeRuntime/);
          const runtime = await server.transformRequest('virtual:creasekit-runtime');
          assert(runtime);
          assert.match(runtime.code, /automatic\.js/);
          assert.doesNotMatch(runtime.code, /mcp-session|token/);
        },
      );
      for (let attempt = 0; ; attempt += 1) {
        try {
          await stat(join(app, '.creasekit/mcp-session.json'));
          break;
        } catch (error) {
          if (attempt >= 100) throw error;
          await delay(20);
        }
      }

      await t.test(
        'shares and revokes real snapshots through the installed Vite plugin and bunx CLI',
        async () => {
          const request = (path, body) =>
            fetch(`${origin}${path}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Origin: origin },
              body: JSON.stringify(body),
            });
          const snapshot = {
            version: 1,
            runtimeId: 'packed-runtime',
            projectId: 'packed-consumer',
            page: origin,
            sharedAt: 1,
            selection: null,
            annotations: [],
          };
          assert.equal((await request('/__creasekit/share', snapshot)).status, 204);
          const client = new McpClient(
            'bun',
            ['x', '--no-install', 'creasekit', '--cwd', app],
            launcher,
          );
          try {
            const initialized = await client.request('initialize', {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'packed-package-test', version: '1' },
            });
            assert.equal(initialized.serverInfo.name, 'creasekit');
            assert.equal(initialized.serverInfo.version, metadata.version);
            client.notify('notifications/initialized');
            const tools = await client.request('tools/list', {});
            assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
              'creasekit_clear_annotations',
              'creasekit_delete_annotation',
              'creasekit_get_annotation',
              'creasekit_get_context',
              'creasekit_list_sessions',
            ]);
            const listed = await client.request('tools/call', {
              name: 'creasekit_list_sessions',
              arguments: {},
            });
            assert.equal(listed.isError, false);
            assert.equal(
              listed.structuredContent.sessions[0].runtimeId,
              snapshot.runtimeId,
            );
            const context = await client.request('tools/call', {
              name: 'creasekit_get_context',
              arguments: { runtimeId: snapshot.runtimeId },
            });
            assert.equal(context.isError, false);
            assert.deepEqual(context.structuredContent, snapshot);
            assert.equal(
              (await request('/__creasekit/unshare', { runtimeId: snapshot.runtimeId }))
                .status,
              204,
            );
            const revoked = await client.request('tools/call', {
              name: 'creasekit_list_sessions',
              arguments: {},
            });
            assert.deepEqual(revoked.structuredContent.sessions, []);
          } finally {
            await client.close();
          }
        },
      );

      await t.test(
        'keeps the inspector and sharing code out of the consuming production build',
        async () => {
          await run(
            join(app, 'node_modules/.bin/vite'),
            ['build', '--logLevel', 'error'],
            {
              cwd: app,
              env: { ...process.env, NODE_ENV: 'production' },
            },
          );
          const files = await readdir(join(app, 'dist/assets'));
          const scripts = await Promise.all(
            files
              .filter((file) => file.endsWith('.js'))
              .map((file) => readFile(join(app, 'dist/assets', file), 'utf8')),
          );
          assert(scripts.length > 0);
          assert.equal(
            /data-creasekit-root|data-creasekit-ref|\/__creasekit\/share|Include scoped Model & history/.test(
              scripts.join('\n'),
            ),
            false,
            'The production build must not include the inspector or sharing code',
          );
        },
      );
    } finally {
      await server?.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

class McpClient {
  #child;
  #pending = new Map();
  #id = 0;

  constructor(command, args, cwd) {
    this.#child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child.stderr.resume();
    this.#child.on('error', () => this.#fail(new Error('MCP process failed to start')));
    this.#child.on('exit', () =>
      this.#fail(new Error('MCP process exited before responding')),
    );
    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.#fail(new Error('MCP stdout contained non-JSON data'));
        return;
      }
      const request = this.#pending.get(message.id);
      if (request === undefined) return;
      this.#pending.delete(message.id);
      clearTimeout(request.timer);
      message.error
        ? request.reject(new Error('MCP returned a protocol error'))
        : request.resolve(message.result);
    });
  }

  request(method, params) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 10_000);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      );
    });
  }

  notify(method) {
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  #fail(error) {
    for (const request of this.#pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.#pending.clear();
  }

  async close() {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return;
    const closed = new Promise((resolve) => this.#child.once('close', resolve));
    this.#child.stdin.end();
    const timer = setTimeout(() => this.#child.kill('SIGTERM'), 2_000);
    await closed;
    clearTimeout(timer);
  }
}
