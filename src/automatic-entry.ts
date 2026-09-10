import { createAgentConnection } from './agent-connection.js';
import {
  automaticInspector,
  configureAutomaticContext,
  resetAutomaticContext,
} from './automatic-context.js';
import { mountCreasekit } from './creasekit.js';
import { setDefaultFoldkitInspector } from './foldkit-context.js';

export { captureCall, observeRuntime, registerFunction } from './automatic-context.js';

export const startAutomaticCreasekit = (options: {
  readonly projectId: string;
  readonly autoMount: boolean;
  readonly excludeModelKeys: ReadonlyArray<string>;
}): (() => void) => {
  configureAutomaticContext(options.excludeModelKeys);
  setDefaultFoldkitInspector(automaticInspector);
  let handle: ReturnType<typeof mountCreasekit> | undefined;
  const mount = (): void => {
    if (!options.autoMount || document.querySelector('[data-creasekit-root]')) return;
    handle = mountCreasekit({
      projectId: options.projectId,
      foldkit: automaticInspector,
      agent: createAgentConnection(),
    });
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  return () => {
    document.removeEventListener('DOMContentLoaded', mount);
    handle?.destroy();
    resetAutomaticContext();
    setDefaultFoldkitInspector(undefined);
  };
};
