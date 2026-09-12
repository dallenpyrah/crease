import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sessionFilePath } from './bridge';
import {
  type TestBridge,
  startTestBridge,
  waitForSessionRemoval,
} from './test-fixtures';

describe('bridge session credential privacy', () => {
  let root: string | undefined;
  let bridge: TestBridge | undefined;

  afterEach(async () => {
    if (bridge !== undefined) await bridge.server.close();
    if (root !== undefined) {
      await waitForSessionRemoval(root);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('denies direct, raw, encoded, and /@fs browser access to .creasekit', async () => {
    root = await mkdtemp(join(tmpdir(), 'creasekit-session-privacy-'));
    bridge = await startTestBridge(root);
    expect(bridge.server.config.server.fs.deny).toContain('**/.creasekit/**');
    expect(bridge.server.config.server.fs.deny.length).toBeGreaterThan(1);

    const absoluteSessionPath = sessionFilePath(root);
    const paths = [
      '/.creasekit/mcp-session.json',
      '/.creasekit/mcp-session.json?raw',
      '/.creasekit/mcp-session.json?import',
      '/%2ecreasekit/mcp-session.json',
      `/@fs${absoluteSessionPath}`,
      `/@fs${absoluteSessionPath}?raw`,
      `/@fs${absoluteSessionPath}?import`,
      `/@fs${absoluteSessionPath.replace('/.creasekit/', '/%2Ecreasekit/')}`,
    ];
    for (const path of paths) {
      const response = await fetch(new URL(path, bridge.session.url));
      expect(response.status, path).toBe(404);
      await response.body?.cancel();
    }
  });
});
