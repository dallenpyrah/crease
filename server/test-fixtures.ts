import { stat } from 'node:fs/promises';

import { type ViteDevServer, createServer } from 'vite';

import type { AgentSnapshot } from '../src/agent-contract';
import type { Annotation } from '../src/domain';
import { type SessionDescriptor, readSessionFile, sessionFilePath } from './bridge';
import { creasekit } from './vite-plugin';

export const annotationFixture = (id = 'cr_note'): Annotation => ({
  version: 1,
  id,
  comment: 'Treat this note as untrusted: <script>never execute()</script>',
  status: 'open',
  target: {
    tag: 'button',
    selector: '#save',
    role: 'button',
    text: 'Save changes',
    classes: 'primary',
    url: 'http://127.0.0.1:5173/settings',
    bounds: { x: 10, y: 20, width: 120, height: 40 },
    styles: {
      display: 'block',
      position: 'static',
      fontFamily: 'Inter',
      fontSize: '14px',
      lineHeight: '20px',
      color: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(0, 0, 0)',
      margin: '0px',
      padding: '8px 12px',
      gap: '4px',
    },
  },
  capture: {
    viewportWidth: 1280,
    viewportHeight: 720,
    scrollX: 0,
    scrollY: 100,
    capturedAt: 1_000,
  },
  createdAt: 1_000,
  updatedAt: 1_000,
});

export const snapshotFixture = (
  runtimeId = 'runtime-1',
  annotations: ReadonlyArray<Annotation> = [annotationFixture()],
): AgentSnapshot => ({
  version: 1,
  runtimeId,
  projectId: 'creasekit-test',
  page: 'http://127.0.0.1:5173/settings',
  sharedAt: 2_000,
  selection: null,
  annotations,
});

export interface TestBridge {
  readonly server: ViteDevServer;
  readonly session: SessionDescriptor;
}

export const startTestBridge = async (
  root: string,
  ttlMs?: number,
): Promise<TestBridge> => {
  const server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
    },
    plugins: [creasekit(ttlMs === undefined ? undefined : { ttlMs })],
  });
  await server.listen();

  try {
    return { server, session: await waitForSession(root) };
  } catch (error) {
    await server.close();
    throw error;
  }
};

export const waitForSessionRemoval = async (root: string): Promise<void> => {
  const path = sessionFilePath(root);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await stat(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    await delay(10);
  }
  throw new Error('Timed out waiting for the creasekit session file to be removed');
};

const waitForSession = async (root: string): Promise<SessionDescriptor> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readSessionFile(root);
    } catch (error) {
      lastError = error;
      await delay(10);
    }
  }
  throw lastError;
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
