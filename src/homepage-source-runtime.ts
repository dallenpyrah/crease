import { sources } from 'virtual:creasekit-homepage-sources';

import { configureAutomaticContext } from './automatic-context.js';
import { installHomepageSources } from './homepage-source-context.js';

export { captureCall, observeRuntime, registerFunction } from './automatic-context.js';

configureAutomaticContext([]);
installHomepageSources(sources);
