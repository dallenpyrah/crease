import type { IncomingMessage, ServerResponse } from 'node:http';

import { Schema } from 'effect';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';

import {
  BRIDGE_CONTEXT_PATH,
  BRIDGE_SHARE_PATH,
  BRIDGE_UNSHARE_PATH,
  MAX_REQUEST_BODY_BYTES,
  type OwnedSessionFile,
  type SessionDescriptor,
  SnapshotStore,
  UnshareRequest,
  constantTimeTokenEqual,
  createSessionDescriptor,
  decodeSnapshot,
  isLoopbackAddress,
  isLoopbackHostname,
  removeOwnedSessionFile,
  writeSessionFile,
} from './bridge.js';

export interface CreasekitPluginOptions {
  readonly ttlMs?: number;
}

class RequestBodyTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}

interface ValidHost {
  readonly hostname: string;
  readonly port: number;
  readonly origin: string;
}

export const creasekit = (options: CreasekitPluginOptions = {}): Plugin => {
  let projectRoot: string | undefined;

  return {
    name: 'creasekit',
    apply: 'serve',
    configResolved(config) {
      assertSecureDevelopmentConfig(config);
      projectRoot = config.root;
    },
    configureServer(server) {
      if (projectRoot === undefined) {
        throw new Error('creasekit bridge did not receive a resolved Vite root');
      }
      if (server.httpServer === null) {
        throw new Error(
          'creasekit bridge requires Vite to own a loopback HTTP development server',
        );
      }

      installBridge(server, projectRoot, options);
    },
  };
};

const assertSecureDevelopmentConfig = (config: ResolvedConfig): void => {
  const host = config.server.host;
  if (typeof host !== 'string' || !isLoopbackHostname(host)) {
    throw new Error(
      'creasekit bridge requires server.host to be 127.0.0.1, localhost, or ::1',
    );
  }
  if (config.server.https !== undefined) {
    throw new Error(
      'creasekit bridge requires the local Vite development server to use HTTP',
    );
  }
};

const installBridge = (
  server: ViteDevServer,
  projectRoot: string,
  options: CreasekitPluginOptions,
): void => {
  const httpServer = server.httpServer;
  if (httpServer === null) return;

  const store = new SnapshotStore(
    options.ttlMs === undefined ? undefined : { ttlMs: options.ttlMs },
  );
  let descriptor: SessionDescriptor | undefined;
  let ownedSessionFile: OwnedSessionFile | undefined;
  let closing = false;
  let installation: Promise<void> | undefined;

  server.middlewares.use((request, response, next) => {
    void handleBridgeRequest(request, response, descriptor, store).then(
      (handled) => {
        if (!handled) next();
      },
      () => {
        if (!response.headersSent) {
          sendJson(response, 500, { error: 'internal_bridge_error' });
        } else {
          response.end();
        }
      },
    );
  });

  const onListening = (): void => {
    const address = httpServer.address();
    if (address === null || typeof address === 'string') {
      server.config.logger.error(
        'creasekit bridge could not determine the Vite development server address',
      );
      void server.close();
      return;
    }
    const { address: boundAddress, port } = address;
    if (!isLoopbackAddress(boundAddress)) {
      server.config.logger.error(
        'creasekit bridge refused a non-loopback Vite development server address',
      );
      void server.close();
      return;
    }

    const nextDescriptor = createSessionDescriptor(port, boundAddress);
    installation = writeSessionFile(projectRoot, nextDescriptor)
      .then(async (owned) => {
        if (closing) {
          await removeOwnedSessionFile(owned);
          return;
        }
        ownedSessionFile = owned;
        descriptor = nextDescriptor;
      })
      .catch(() => {
        server.config.logger.error(
          'creasekit bridge could not create its protected MCP session file',
        );
        void server.close();
      });
  };

  httpServer.once('listening', onListening);
  httpServer.once('close', () => {
    closing = true;
    descriptor = undefined;
    store.clear();
    const cleanup = async (): Promise<void> => {
      await installation?.catch(() => undefined);
      if (ownedSessionFile !== undefined) {
        await removeOwnedSessionFile(ownedSessionFile).catch(() => undefined);
        ownedSessionFile = undefined;
      }
    };
    void cleanup();
  });
};

const handleBridgeRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  descriptor: SessionDescriptor | undefined,
  store: SnapshotStore,
): Promise<boolean> => {
  const requestUrl = parseRequestUrl(request.url);
  if (requestUrl === undefined) return false;

  const bridgePath =
    requestUrl.pathname === BRIDGE_SHARE_PATH ||
    requestUrl.pathname === BRIDGE_UNSHARE_PATH ||
    requestUrl.pathname === BRIDGE_CONTEXT_PATH;
  if (!bridgePath) return false;

  const host = validateHost(request);
  if (host === undefined) {
    sendJson(response, 403, { error: 'invalid_host' });
    return true;
  }

  if (descriptor === undefined) {
    sendJson(response, 503, { error: 'bridge_starting' });
    return true;
  }

  if (requestUrl.pathname === BRIDGE_CONTEXT_PATH) {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, 'GET');
      return true;
    }
    if (!isAuthorized(request, descriptor.token)) {
      sendJson(response, 401, { error: 'unauthorized' });
      return true;
    }

    const runtimeIds = requestUrl.searchParams.getAll('runtimeId');
    const hasUnexpectedParameter = Array.from(requestUrl.searchParams.keys()).some(
      (key) => key !== 'runtimeId',
    );
    if (runtimeIds.length > 1 || hasUnexpectedParameter) {
      sendJson(response, 400, { error: 'invalid_query' });
      return true;
    }
    const runtimeId = runtimeIds[0];
    if (runtimeId === undefined) {
      sendJson(response, 200, store.list());
      return true;
    }

    const lookup = store.get(runtimeId);
    if (lookup._tag === 'Found') {
      sendJson(response, 200, lookup.snapshot);
    } else if (lookup._tag === 'Stale') {
      sendJson(response, 410, { error: 'snapshot_stale' });
    } else {
      sendJson(response, 404, { error: 'snapshot_not_shared' });
    }
    return true;
  }

  if (request.method !== 'POST') {
    sendMethodNotAllowed(response, 'POST');
    return true;
  }
  if (!hasSameOrigin(request, host)) {
    sendJson(response, 403, { error: 'invalid_origin' });
    return true;
  }
  if (!isJsonContentType(request.headers['content-type'])) {
    sendJson(response, 415, { error: 'application_json_required' });
    return true;
  }
  if (requestUrl.search !== '') {
    sendJson(response, 400, { error: 'invalid_query' });
    return true;
  }

  let input: unknown;
  try {
    input = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      sendJson(response, 413, { error: 'request_body_too_large' });
    } else {
      sendJson(response, 400, { error: 'malformed_json' });
    }
    return true;
  }

  if (requestUrl.pathname === BRIDGE_SHARE_PATH) {
    try {
      const snapshot = decodeSnapshot(input);
      if (!store.share(snapshot)) {
        sendJson(response, 429, { error: 'session_limit_reached' });
        return true;
      }
    } catch {
      sendJson(response, 422, { error: 'invalid_snapshot' });
      return true;
    }
    sendEmpty(response, 204);
    return true;
  }

  try {
    const { runtimeId } = Schema.decodeUnknownSync(UnshareRequest)(input);
    if (!store.unshare(runtimeId)) {
      sendJson(response, 404, { error: 'snapshot_not_shared' });
      return true;
    }
  } catch {
    sendJson(response, 422, { error: 'invalid_unshare_request' });
    return true;
  }
  sendEmpty(response, 204);
  return true;
};

const parseRequestUrl = (value: string | undefined): URL | undefined => {
  if (value === undefined) return undefined;
  try {
    return new URL(value, 'http://creasekit.local');
  } catch {
    return undefined;
  }
};

const validateHost = (request: IncomingMessage): ValidHost | undefined => {
  const hostHeader = request.headers.host;
  const localPort = request.socket.localPort;
  if (hostHeader === undefined || localPort === undefined) return undefined;

  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${hostHeader}`);
  } catch {
    return undefined;
  }
  if (
    hostUrl.username !== '' ||
    hostUrl.password !== '' ||
    hostUrl.pathname !== '/' ||
    hostUrl.search !== '' ||
    hostUrl.hash !== '' ||
    !isLoopbackHostname(hostUrl.hostname)
  ) {
    return undefined;
  }

  const port = hostUrl.port === '' ? 80 : Number(hostUrl.port);
  if (!Number.isInteger(port) || port !== localPort) return undefined;
  return {
    hostname: hostUrl.hostname.toLowerCase().replace(/^\[|\]$/g, ''),
    port,
    origin: hostUrl.origin,
  };
};

const hasSameOrigin = (request: IncomingMessage, host: ValidHost): boolean => {
  const origin = request.headers.origin;
  if (origin === undefined) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const originPort = originUrl.port === '' ? 80 : Number(originUrl.port);
  const originHostname = originUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    origin === originUrl.origin &&
    originUrl.protocol === 'http:' &&
    originHostname === host.hostname &&
    originPort === host.port &&
    originUrl.origin === host.origin
  );
};

const isAuthorized = (request: IncomingMessage, token: string): boolean => {
  const authorization = request.headers.authorization;
  if (authorization === undefined) return false;
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match !== null && constantTimeTokenEqual(match[1] ?? '', token);
};

const isJsonContentType = (value: string | undefined): boolean =>
  value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';

const readJsonBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const contentLength = request.headers['content-length'];
    if (contentLength !== undefined) {
      if (!/^\d+$/.test(contentLength)) {
        reject(new InvalidRequestBodyError());
        request.resume();
        return;
      }
      if (Number(contentLength) > MAX_REQUEST_BODY_BYTES) {
        reject(new RequestBodyTooLargeError());
        request.resume();
        return;
      }
    }

    const chunks: Array<Buffer> = [];
    let size = 0;
    let settled = false;

    const cleanup = (): void => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAborted);
      request.off('error', onError);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk: Buffer | string): void => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += bytes.byteLength;
      if (size > MAX_REQUEST_BODY_BYTES) {
        fail(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const encoded = Buffer.concat(chunks, size);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(encoded);
        resolve(JSON.parse(text));
      } catch {
        reject(new InvalidRequestBodyError());
      }
    };
    const onAborted = (): void => fail(new InvalidRequestBodyError());
    const onError = (): void => fail(new InvalidRequestBodyError());

    request.on('data', onData);
    request.on('end', onEnd);
    request.on('aborted', onAborted);
    request.on('error', onError);
  });

const sendMethodNotAllowed = (
  response: ServerResponse,
  method: 'GET' | 'POST',
): void => {
  response.setHeader('allow', method);
  sendJson(response, 405, { error: 'method_not_allowed' });
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  const encoded = JSON.stringify(body);
  removeInheritedCorsHeaders(response);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-length', Buffer.byteLength(encoded));
  response.end(encoded);
};

const sendEmpty = (response: ServerResponse, status: number): void => {
  removeInheritedCorsHeaders(response);
  response.statusCode = status;
  response.setHeader('cache-control', 'no-store');
  response.end();
};

const removeInheritedCorsHeaders = (response: ServerResponse): void => {
  response.removeHeader('access-control-allow-origin');
  response.removeHeader('access-control-allow-credentials');
  response.removeHeader('access-control-allow-headers');
  response.removeHeader('access-control-allow-methods');
};
