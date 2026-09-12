import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ParserPlugin, parse } from '@babel/parser';
import type {
  ArgumentPlaceholder,
  Function as BabelFunction,
  CallExpression,
  Expression,
  Identifier,
  JSXNamespacedName,
  Node,
  ObjectExpression,
  ObjectMethod,
  ObjectProperty,
  SpreadElement,
  TSType,
  VariableDeclaration,
} from '@babel/types';
import MagicString, { type SourceMap } from 'magic-string';

import type { SourceSpan } from '../src/source-schema.js';

const VIRTUAL_RUNTIME = 'virtual:creasekit-runtime';
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SUPPORTED_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
const ELEMENT_BUILDERS = new Set(
  `a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture portal pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr svg animate animateMotion animateTransform circle clipPath defs desc ellipse feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence filter foreignObject g image line linearGradient marker mask metadata mpath path pattern polygon polyline radialGradient rect set stop switch symbol text textPath tspan use view math annotation maction menclose merror mfenced mfrac mglyph mi mlabeledtr mlongdiv mmultiscripts mn mo mover mpadded mphantom mprescripts mroot mrow ms mscarries mscarry msgroup msline mspace msqrt msrow mstack mstyle msub msubsup msup mtable mtd mtext mtr munder munderover semantics`.split(
    ' ',
  ),
);

type ImportRole =
  | 'define-view'
  | 'define-view-namespace'
  | 'foldkit-namespace'
  | 'html-builder'
  | 'html-namespace'
  | 'make-application'
  | 'make-element'
  | 'runtime-namespace';

interface Scope {
  readonly parent?: Scope;
  readonly kind: 'block' | 'function' | 'program';
  readonly bindings: Map<string, Binding>;
  readonly typeBindings: Map<string, TypeBinding>;
}

interface Binding {
  readonly name: string;
  readonly identifier: Identifier;
  readonly scope: Scope;
  readonly declaration: Node;
  readonly variableKind?: VariableDeclaration['kind'];
  readonly initializer?: Expression | null | undefined;
  readonly importRole?: ImportRole;
  readonly importTypeOnly?: boolean;
  readonly isParameter?: true;
  readonly parameterType?: TSType;
  functionNode?: BabelFunction;
  defineViewCall?: CallExpression;
  defineViewModelType?: TSType;
  builderSource?: ViewSource;
}

interface TypeBinding {
  readonly name: string;
  readonly declaration: Node;
  readonly scope: Scope;
  readonly type?: TSType;
}

interface ViewSource {
  readonly view: string;
  readonly node: Node;
}

interface RuntimePlan {
  readonly call: CallExpression;
  readonly config: Expression | SpreadElement | JSXNamespacedName | ArgumentPlaceholder;
  readonly source: ViewSource;
  readonly modelSource?: ModelSource;
}

interface CapturePlan {
  readonly call: CallExpression;
  readonly receiver: string;
  readonly source: ViewSource;
  readonly kind: 'element' | 'helper' | 'submodel';
  readonly attributes?: Expression;
  readonly modelSource?: ModelSource;
}

interface RegistrationPlan {
  readonly binding: Binding;
  readonly source: ViewSource;
  readonly modelDefinition?: ViewSource;
}

interface ExpressionRegistrationPlan {
  readonly expression: Expression;
  readonly source: ViewSource;
  readonly modelDefinition?: ViewSource;
}

interface ModelSource {
  readonly expression: string;
  readonly node: Expression;
  readonly definition?: ViewSource;
}

interface AstContext {
  readonly code: string;
  readonly file: string;
  readonly revision: string;
  readonly sourceEvidence: boolean;
  readonly rootScope: Scope;
  readonly scopes: WeakMap<Node, Scope>;
  readonly parents: WeakMap<Node, Node>;
  readonly bindings: ReadonlyArray<Binding>;
  readonly tokens: ReadonlyArray<unknown>;
}

export interface AutomaticSourceReference {
  readonly source: SourceSpan;
  readonly start: number;
  readonly end: number;
  readonly snippetStart: number;
  readonly snippetEnd: number;
  readonly snippetTruncated: boolean;
  readonly attributesStart?: number;
  readonly attributesEnd?: number;
}

export interface AutomaticTransformResult {
  readonly code: string;
  readonly map: SourceMap;
  readonly sourceReferences: ReadonlyArray<AutomaticSourceReference>;
}

export interface AutomaticTransformOptions {
  readonly sourceEvidence?: boolean;
}

export const transformAutomaticContext = (
  code: string,
  id: string,
  root: string,
  options: AutomaticTransformOptions = {},
): AutomaticTransformResult | null => {
  const resolvedFile = resolveApplicationFile(id, root);
  if (resolvedFile === undefined) return null;

  const plugins = parserPlugins(resolvedFile.extension);
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, {
      allowAwaitOutsideFunction: true,
      plugins,
      sourceFilename: resolvedFile.file,
      sourceType: 'unambiguous',
      tokens: true,
    });
  } catch {
    return null;
  }
  if (ast.program.sourceType !== 'module') return null;

  const scopeState = buildScopes(ast.program);
  const context: AstContext = {
    code,
    file: resolvedFile.file,
    revision: createHash('sha256').update(code).digest('hex'),
    sourceEvidence: options.sourceEvidence === true,
    rootScope: scopeState.root,
    scopes: scopeState.scopes,
    parents: scopeState.parents,
    bindings: scopeState.bindings,
    tokens: Array.isArray(ast.tokens) ? ast.tokens : [],
  };

  const registrations = new Map<Binding, RegistrationPlan>();
  const expressionRegistrations = new Map<Expression, ExpressionRegistrationPlan>();
  discoverTypedBuilders(ast.program, context, registrations);
  discoverDefinedViews(ast.program, context, registrations);
  const runtimes = discoverRuntimes(
    ast.program,
    context,
    registrations,
    expressionRegistrations,
  );
  if (context.sourceEvidence) propagateBuilderHelpers(ast.program, context);
  const captures = discoverCaptures(ast.program, context, expressionRegistrations);

  if (
    registrations.size === 0 &&
    expressionRegistrations.size === 0 &&
    runtimes.length === 0 &&
    captures.length === 0
  ) {
    return null;
  }

  const names = collectIdentifierNames(ast.program);
  const registerFunction = uniqueName('__creasekitRegisterFunction', names);
  const observeRuntime = uniqueName('__creasekitObserveRuntime', names);
  const captureCall = uniqueName('__creasekitCaptureCall', names);
  const magic = new MagicString(code, { filename: resolvedFile.file });
  const sourceReferences = new Map<string, AutomaticSourceReference>();

  for (const plan of expressionRegistrations.values()) {
    const start = plan.expression.start;
    const end = plan.expression.end;
    if (start == null || end == null) continue;
    magic.prependLeft(start, `${registerFunction}(`);
    magic.appendLeft(
      end,
      `,${encodeSource(plan.source, context, sourceReferences)}${
        plan.modelDefinition === undefined
          ? ''
          : `,${encodeSource(plan.modelDefinition, context, sourceReferences)}`
      })`,
    );
  }

  const registrationsByPosition = new Map<number, Array<RegistrationPlan>>();
  for (const plan of registrations.values()) {
    const anchor = declarationAnchor(plan.binding.declaration, context.parents);
    if (anchor.end == null) continue;
    const plans = registrationsByPosition.get(anchor.end) ?? [];
    plans.push(plan);
    registrationsByPosition.set(anchor.end, plans);
  }
  for (const [position, plans] of registrationsByPosition) {
    magic.appendLeft(
      position,
      plans
        .map(
          (plan) =>
            `\n${registerFunction}(${plan.binding.name},${encodeSource(plan.source, context, sourceReferences)}${
              plan.modelDefinition === undefined
                ? ''
                : `,${encodeSource(plan.modelDefinition, context, sourceReferences)}`
            });`,
        )
        .join(''),
    );
  }

  for (const plan of runtimes) {
    if (plan.config.type === 'SpreadElement' || plan.config.start == null) continue;
    magic.prependLeft(plan.config.start, `${observeRuntime}(`);
    magic.appendLeft(
      plan.config.end ?? plan.config.start,
      `,${encodeSource(plan.source, context, sourceReferences)}${
        plan.modelSource === undefined
          ? ''
          : `,${encodeModelSource(plan.modelSource, context, sourceReferences)}`
      })`,
    );
  }

  for (const plan of captures) {
    const opening = callOpeningParenthesis(plan.call, context.tokens);
    const closing = callClosingParenthesis(plan.call, context.tokens);
    if (opening === undefined || closing === undefined) continue;
    magic.prependLeft(plan.call.start ?? opening, `${captureCall}(`);
    magic.overwrite(opening, opening + 1, `,${plan.receiver},[`);
    magic.overwrite(
      closing,
      closing + 1,
      `],${encodeSource(plan.source, context, sourceReferences, {
        call: plan.call,
        ...(plan.attributes === undefined ? {} : { attributes: plan.attributes }),
      })},${JSON.stringify(plan.kind)}${
        plan.modelSource === undefined
          ? ''
          : `,${encodeModelSource(plan.modelSource, context, sourceReferences)}`
      })`,
    );
  }

  const imports = [
    registrations.size > 0 || expressionRegistrations.size > 0
      ? `registerFunction as ${registerFunction}`
      : undefined,
    runtimes.length > 0 ? `observeRuntime as ${observeRuntime}` : undefined,
    captures.length > 0 ? `captureCall as ${captureCall}` : undefined,
  ].filter((value): value is string => value !== undefined);
  const importStatement = `import { ${imports.join(', ')} } from ${JSON.stringify(VIRTUAL_RUNTIME)};\n`;
  const importPosition = importInsertionPosition(ast.program, code);
  magic.appendLeft(
    importPosition,
    `${importPosition === 0 ? '' : '\n'}${importStatement}`,
  );

  return {
    code: magic.toString(),
    map: magic.generateMap({
      file: resolvedFile.file,
      hires: true,
      includeContent: true,
      source: resolvedFile.file,
    }),
    sourceReferences: Array.from(sourceReferences.values()),
  };
};

const resolveApplicationFile = (
  id: string,
  root: string,
):
  | { readonly absolute: string; readonly extension: string; readonly file: string }
  | undefined => {
  if (
    id.startsWith('\0') ||
    id.startsWith('virtual:') ||
    id.includes('\0') ||
    root.trim() === ''
  ) {
    return undefined;
  }
  const queryStart = id.indexOf('?');
  if (queryStart >= 0) {
    const query = id.slice(queryStart + 1).split('#', 1)[0] ?? '';
    if (/(?:^|&)(?:inline|raw|sharedworker|url|worker)(?:[=&]|$)/u.test(query)) {
      return undefined;
    }
  }
  const cleanId = id.split(/[?#]/, 1)[0];
  if (cleanId === undefined || cleanId === '') return undefined;

  let absolute: string;
  try {
    absolute = cleanId.startsWith('file:')
      ? resolve(fileURLToPath(cleanId))
      : resolve(isAbsolute(cleanId) ? cleanId : resolve(root, cleanId));
  } catch {
    return undefined;
  }
  const absoluteRoot = resolve(root);
  const rootRelative = relative(absoluteRoot, absolute);
  if (
    rootRelative === '' ||
    rootRelative === '..' ||
    rootRelative.startsWith(`..${sep}`) ||
    isAbsolute(rootRelative) ||
    (absoluteRoot === PACKAGE_ROOT &&
      isWithin(PACKAGE_ROOT, absolute) &&
      !(rootRelative === 'src/main.ts' || rootRelative === 'src/entry.ts'))
  ) {
    return undefined;
  }
  const file = rootRelative.split(sep).join('/');
  if (file.split('/').includes('node_modules') || file.endsWith('.d.ts'))
    return undefined;
  const extensionIndex = file.lastIndexOf('.');
  const extension = extensionIndex < 0 ? '' : file.slice(extensionIndex).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) return undefined;
  return { absolute, extension, file };
};

const isWithin = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return (
    path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
};

const parserPlugins = (extension: string): Array<ParserPlugin> => {
  const plugins: Array<ParserPlugin> = ['decorators-legacy'];
  if (
    extension === '.ts' ||
    extension === '.tsx' ||
    extension === '.mts' ||
    extension === '.cts'
  ) {
    plugins.push('typescript');
  }
  if (extension === '.jsx' || extension === '.tsx') plugins.push('jsx');
  return plugins;
};

const buildScopes = (
  program: Node,
): {
  readonly root: Scope;
  readonly scopes: WeakMap<Node, Scope>;
  readonly parents: WeakMap<Node, Node>;
  readonly bindings: ReadonlyArray<Binding>;
} => {
  const root: Scope = {
    kind: 'program',
    bindings: new Map(),
    typeBindings: new Map(),
  };
  const scopes = new WeakMap<Node, Scope>();
  const parents = new WeakMap<Node, Node>();
  const bindings: Array<Binding> = [];

  const addBinding = (
    scope: Scope,
    identifier: Identifier,
    declaration: Node,
    options: {
      readonly variableKind?: VariableDeclaration['kind'];
      readonly initializer?: Expression | null;
      readonly importRole?: ImportRole;
      readonly importTypeOnly?: boolean;
      readonly isParameter?: true;
      readonly parameterType?: TSType;
    } = {},
  ): Binding => {
    const existing = scope.bindings.get(identifier.name);
    if (existing !== undefined) return existing;
    const binding: Binding = {
      name: identifier.name,
      identifier,
      scope,
      declaration,
      ...options,
    };
    scope.bindings.set(identifier.name, binding);
    bindings.push(binding);
    return binding;
  };

  const addPattern = (
    pattern: Node,
    scope: Scope,
    declaration: Node,
    options: {
      readonly variableKind?: VariableDeclaration['kind'];
      readonly initializer?: Expression | null;
      readonly isParameter?: true;
      readonly parameterType?: TSType;
    } = {},
  ): void => {
    switch (pattern.type) {
      case 'Identifier':
        const parameterType = typeAnnotationOf(pattern) ?? options.parameterType;
        addBinding(scope, pattern, declaration, {
          ...options,
          ...(parameterType === undefined ? {} : { parameterType }),
        });
        return;
      case 'AssignmentPattern':
        addPattern(pattern.left, scope, declaration, options);
        return;
      case 'RestElement':
        if (pattern.argument !== undefined)
          addPattern(pattern.argument, scope, declaration, options);
        return;
      case 'ArrayPattern':
        for (const item of pattern.elements) {
          if (item !== null) addPattern(item, scope, declaration, options);
        }
        return;
      case 'ObjectPattern':
        for (const property of pattern.properties) {
          if (property.type === 'RestElement') {
            if (property.argument !== undefined)
              addPattern(property.argument, scope, declaration, options);
          } else {
            addPattern(property.value, scope, declaration, options);
          }
        }
        return;
      case 'TSParameterProperty':
        addPattern(pattern.parameter, scope, declaration, options);
        return;
    }
  };

  const visit = (node: Node, scope: Scope, parent?: Node): void => {
    if (parent !== undefined) parents.set(node, parent);

    let activeScope = scope;
    if (isFunctionNode(node)) {
      if (node.type === 'FunctionDeclaration' && node.id != null) {
        const binding = addBinding(scope, node.id, node);
        binding.functionNode = node;
      }
      activeScope = {
        parent: scope,
        kind: 'function',
        bindings: new Map(),
        typeBindings: new Map(),
      };
      if (node.type === 'FunctionExpression' && node.id != null) {
        addBinding(activeScope, node.id, node).functionNode = node;
      }
      for (const parameter of node.params) {
        addPattern(parameter, activeScope, parameter, { isParameter: true });
      }
    } else if (
      node.type === 'BlockStatement' ||
      node.type === 'CatchClause' ||
      node.type === 'ClassBody' ||
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement' ||
      node.type === 'SwitchStatement'
    ) {
      activeScope = {
        parent: scope,
        kind: 'block',
        bindings: new Map(),
        typeBindings: new Map(),
      };
      if (node.type === 'CatchClause' && node.param != null) {
        addPattern(node.param, activeScope, node.param);
      }
    }
    scopes.set(node, activeScope);

    if (node.type === 'ImportDeclaration') {
      const module = node.source.value;
      for (const specifier of node.specifiers) {
        const imported =
          specifier.type === 'ImportSpecifier'
            ? specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value
            : undefined;
        const importTypeOnly =
          node.importKind === 'type' ||
          (specifier.type === 'ImportSpecifier' && specifier.importKind === 'type');
        const role = importRole(module, specifier.type, imported, importTypeOnly);
        addBinding(activeScope, specifier.local, node, {
          ...(role === undefined ? {} : { importRole: role }),
          importTypeOnly,
        });
      }
    } else if (node.type === 'VariableDeclaration') {
      const declarationScope =
        node.kind === 'var' ? nearestFunctionScope(activeScope) : activeScope;
      for (const declarator of node.declarations) {
        addPattern(declarator.id, declarationScope, node, {
          variableKind: node.kind,
          ...(declarator.init === undefined ? {} : { initializer: declarator.init }),
        });
        if (
          declarator.id.type === 'Identifier' &&
          declarator.init != null &&
          isFunctionNode(declarator.init)
        ) {
          const binding = declarationScope.bindings.get(declarator.id.name);
          if (binding !== undefined) binding.functionNode = declarator.init;
        }
      }
    } else if (node.type === 'ClassDeclaration' && node.id != null) {
      addBinding(activeScope, node.id, node);
    } else if (
      node.type === 'TSTypeAliasDeclaration' ||
      node.type === 'TSInterfaceDeclaration'
    ) {
      activeScope.typeBindings.set(node.id.name, {
        name: node.id.name,
        declaration: node,
        scope: activeScope,
        ...(node.type === 'TSTypeAliasDeclaration'
          ? { type: node.typeAnnotation }
          : {}),
      });
    } else if (node.type === 'TSEnumDeclaration') {
      activeScope.typeBindings.set(node.id.name, {
        name: node.id.name,
        declaration: node,
        scope: activeScope,
      });
      addBinding(activeScope, node.id, node);
    }

    forEachChild(node, (child) => visit(child, activeScope, node));
  };

  visit(program, root);
  return { root, scopes, parents, bindings };
};

const importRole = (
  module: string,
  specifier: 'ImportDefaultSpecifier' | 'ImportNamespaceSpecifier' | 'ImportSpecifier',
  imported: string | undefined,
  typeOnly: boolean,
): ImportRole | undefined => {
  if (module === 'foldkit') {
    if (specifier === 'ImportNamespaceSpecifier') return 'foldkit-namespace';
    if (specifier !== 'ImportSpecifier') return undefined;
    if (imported === 'Runtime' && !typeOnly) return 'runtime-namespace';
    if (imported === 'Html') return 'html-namespace';
    if (imported === 'Submodel' && !typeOnly) return 'define-view-namespace';
    return undefined;
  }
  if (module === 'foldkit/runtime') {
    if (specifier === 'ImportNamespaceSpecifier' && !typeOnly)
      return 'runtime-namespace';
    if (specifier !== 'ImportSpecifier' || typeOnly) return undefined;
    if (imported === 'makeApplication') return 'make-application';
    if (imported === 'makeElement') return 'make-element';
    return undefined;
  }
  if (module === 'foldkit/html') {
    if (specifier === 'ImportNamespaceSpecifier') return 'html-namespace';
    if (specifier !== 'ImportSpecifier') return undefined;
    if (imported === 'HtmlBuilder') return 'html-builder';
    if (imported === 'defineView' && !typeOnly) return 'define-view';
    return undefined;
  }
  if (module === 'foldkit/submodel') {
    if (specifier === 'ImportNamespaceSpecifier' && !typeOnly)
      return 'define-view-namespace';
    if (specifier === 'ImportSpecifier' && imported === 'defineView' && !typeOnly)
      return 'define-view';
  }
  return undefined;
};

const nearestFunctionScope = (scope: Scope): Scope => {
  let current = scope;
  while (current.kind === 'block' && current.parent !== undefined) {
    current = current.parent;
  }
  return current;
};

const discoverTypedBuilders = (
  program: Node,
  context: AstContext,
  registrations: Map<Binding, RegistrationPlan>,
): void => {
  walk(program, (node) => {
    if (!isFunctionNode(node)) return;
    const source = functionSource(node, context);
    if (source === undefined) return;
    for (const parameter of node.params) {
      const identifier = parameterIdentifier(parameter);
      const type = identifier === undefined ? undefined : typeAnnotationOf(identifier);
      if (
        identifier === undefined ||
        type === undefined ||
        !isHtmlBuilderType(type, context.scopes.get(node), context, new Set())
      ) {
        continue;
      }
      markBuilderParameter(node, identifier, source, context);
      const binding = bindingForFunction(node, context);
      if (binding !== undefined && binding.scope === context.rootScope) {
        setRegistration(
          registrations,
          binding,
          source,
          modelDefinitionForFunction(node, context),
        );
      }
    }
  });
};

const discoverDefinedViews = (
  program: Node,
  context: AstContext,
  registrations: Map<Binding, RegistrationPlan>,
): void => {
  walk(program, (node) => {
    if (node.type !== 'CallExpression') return;
    const scope = context.scopes.get(node);
    if (scope === undefined || !isDefineViewCall(node, scope)) return;
    const resultBinding = context.bindings.find(
      (binding) =>
        binding.variableKind === 'const' &&
        binding.initializer != null &&
        unwrapExpression(binding.initializer) === node,
    );
    const source =
      resultBinding === undefined
        ? viewSourceForInlineDefineView(node, context)
        : {
            view: resultBinding.name,
            node: declarationAnchor(resultBinding.declaration, context.parents),
          };
    const firstArgument = node.arguments[0];
    const viewFunction =
      firstArgument === undefined || firstArgument.type === 'SpreadElement'
        ? undefined
        : resolveFunction(firstArgument, scope, context);
    if (viewFunction !== undefined) {
      const parameter = viewFunction.params.at(-1);
      const identifier =
        parameter === undefined ? undefined : parameterIdentifier(parameter);
      if (identifier !== undefined) {
        markBuilderParameter(viewFunction, identifier, source, context);
      }
    }
    if (resultBinding !== undefined) {
      resultBinding.defineViewCall = node;
      const modelType = typeParameter(node, 0);
      if (modelType !== undefined) resultBinding.defineViewModelType = modelType;
      if (resultBinding.scope === context.rootScope) {
        setRegistration(
          registrations,
          resultBinding,
          source,
          modelType === undefined
            ? viewFunction === undefined
              ? undefined
              : modelDefinitionForFunction(viewFunction, context)
            : modelDefinitionFromType(modelType, scope, context, new Set()),
        );
      }
    }
  });
};

const discoverRuntimes = (
  program: Node,
  context: AstContext,
  registrations: Map<Binding, RegistrationPlan>,
  expressionRegistrations: Map<Expression, ExpressionRegistrationPlan>,
): Array<RuntimePlan> => {
  const plans: Array<RuntimePlan> = [];
  walk(program, (node) => {
    if (node.type !== 'CallExpression') return;
    const scope = context.scopes.get(node);
    if (scope === undefined || runtimeCallKind(node, scope) === undefined) return;
    const config = node.arguments[0];
    if (config === undefined || config.type === 'SpreadElement') return;
    const object = resolveObject(config, scope);
    if (object === undefined) return;
    const viewProperty = definiteProperty(object, 'view');
    const viewValue = propertyValue(viewProperty);
    if (viewValue === undefined) return;
    const source = viewSource(viewValue, viewProperty, scope, context);
    if (source === undefined) return;
    const valueScope = context.scopes.get(viewValue) ?? scope;

    const viewFunction = resolveFunction(viewValue, valueScope, context);
    if (viewFunction !== undefined) {
      const parameter = viewFunction.params[1];
      const identifier =
        parameter === undefined ? undefined : parameterIdentifier(parameter);
      if (identifier !== undefined)
        markBuilderParameter(viewFunction, identifier, source, context);
      const binding = bindingForFunction(viewFunction, context);
      if (binding !== undefined && binding.scope === context.rootScope) {
        setRegistration(
          registrations,
          binding,
          source,
          modelDefinitionForFunction(viewFunction, context),
        );
      } else if (isRegisterableExpression(viewValue)) {
        expressionRegistrations.set(viewValue, {
          expression: viewValue,
          source,
          ...(() => {
            const modelDefinition = modelDefinitionForFunction(viewFunction, context);
            return modelDefinition === undefined ? {} : { modelDefinition };
          })(),
        });
      }
    }

    const modelProperty = definiteProperty(object, 'Model');
    const modelExpression = expressionPropertyValue(modelProperty);
    plans.push({
      call: node,
      config,
      source,
      ...(modelExpression === undefined
        ? {}
        : {
            modelSource: modelSource(
              modelExpression,
              context.scopes.get(modelExpression) ?? scope,
              context,
              undefined,
            ),
          }),
    });
  });
  return plans;
};

const propagateBuilderHelpers = (program: Node, context: AstContext): void => {
  const maximumPasses = Math.min(context.bindings.length + 1, 32);
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let changed = false;
    walk(program, (node) => {
      if (node.type !== 'CallExpression') return;
      const scope = context.scopes.get(node);
      if (scope === undefined) return;
      const helper = localHelperFunctionForCall(node, scope, context);
      if (helper === undefined) return;
      const helperSource = functionSource(helper, context);
      for (let index = 0; index < node.arguments.length; index += 1) {
        const argument = node.arguments[index];
        if (
          argument === undefined ||
          argument.type === 'SpreadElement' ||
          !isExpressionNode(argument)
        ) {
          continue;
        }
        const builder = builderBindingForExpression(argument, scope, context);
        if (builder?.builderSource === undefined) continue;
        const parameter = helper.params[index];
        const identifier =
          parameter === undefined || parameter.type === 'RestElement'
            ? undefined
            : parameterIdentifier(parameter);
        if (identifier === undefined) continue;
        const helperScope = context.scopes.get(helper);
        const binding =
          helperScope === undefined
            ? undefined
            : resolveBinding(helperScope, identifier.name);
        if (binding === undefined || binding.identifier !== identifier) continue;
        if (binding.builderSource === undefined) {
          binding.builderSource = helperSource ?? builder.builderSource;
          changed = true;
        }
      }
    });
    if (!changed) return;
  }
};

const discoverCaptures = (
  program: Node,
  context: AstContext,
  expressionRegistrations: Map<Expression, ExpressionRegistrationPlan>,
): Array<CapturePlan> => {
  const plans: Array<CapturePlan> = [];
  const planned = new Set<CallExpression>();
  walk(program, (node) => {
    if (node.type !== 'CallExpression' || planned.has(node)) return;
    const scope = context.scopes.get(node);
    if (scope === undefined) return;

    const direct = directBuilderCall(node, scope);
    if (direct !== undefined && ELEMENT_BUILDERS.has(direct.method)) {
      const attributes = callArgumentExpression(node, 0);
      plans.push({
        call: node,
        receiver: direct.binding.name,
        source: {
          view: direct.binding.builderSource?.view ?? '(unknown view)',
          node,
        },
        kind: 'element',
        ...(attributes === undefined ? {} : { attributes }),
      });
      planned.add(node);
      return;
    }

    const keyed = keyedBuilderCall(node, scope);
    if (keyed !== undefined) {
      const attributes = callArgumentExpression(node, 1);
      plans.push({
        call: node,
        receiver: 'void 0',
        source: {
          view: keyed.builderSource?.view ?? '(unknown view)',
          node,
        },
        kind: 'element',
        ...(attributes === undefined ? {} : { attributes }),
      });
      planned.add(node);
      return;
    }

    if (direct?.method === 'submodel' && direct.binding.builderSource !== undefined) {
      const config = node.arguments[0];
      if (config === undefined || config.type === 'SpreadElement') return;
      const object = resolveObject(config, scope);
      if (object === undefined) return;
      const viewProperty = definiteProperty(object, 'view');
      const modelProperty = definiteProperty(object, 'model');
      const viewValue = propertyValue(viewProperty);
      const modelExpression = expressionPropertyValue(modelProperty);
      if (viewValue === undefined || modelExpression === undefined) return;
      const source = viewSource(viewValue, viewProperty, scope, context);
      if (source === undefined) return;
      const valueScope = context.scopes.get(viewValue) ?? scope;
      if (isRegisterableExpression(viewValue)) {
        const viewFunction = resolveFunction(viewValue, valueScope, context);
        const modelDefinition =
          viewFunction === undefined
            ? undefined
            : modelDefinitionForFunction(viewFunction, context);
        expressionRegistrations.set(viewValue, {
          expression: viewValue,
          source,
          ...(modelDefinition === undefined ? {} : { modelDefinition }),
        });
      }
      plans.push({
        call: node,
        receiver: direct.binding.name,
        source,
        kind: 'submodel',
        modelSource: modelSource(
          modelExpression,
          context.scopes.get(modelExpression) ?? scope,
          context,
          modelDefinitionFromView(viewValue, valueScope, context),
        ),
      });
      planned.add(node);
      return;
    }

    if (!context.sourceEvidence) return;
    const callerBuilder = nearestBuilderBinding(scope);
    const helper = localHelperFunctionForCall(node, scope, context);
    if (
      callerBuilder?.builderSource === undefined ||
      helper === undefined ||
      !functionUsesBuilder(helper, context)
    ) {
      return;
    }
    plans.push({
      call: node,
      receiver: 'void 0',
      source: { view: callerBuilder.builderSource.view, node },
      kind: 'helper',
    });
    planned.add(node);
  });
  return plans;
};

const callArgumentExpression = (
  call: CallExpression,
  index: number,
): Expression | undefined => {
  const argument = call.arguments[index];
  return argument === undefined ||
    argument.type === 'SpreadElement' ||
    !isExpressionNode(argument)
    ? undefined
    : argument;
};

const nearestBuilderBinding = (scope: Scope): Binding | undefined => {
  let current: Scope | undefined = scope;
  while (current !== undefined) {
    for (const binding of current.bindings.values()) {
      if (binding.builderSource !== undefined) return binding;
    }
    current = current.parent;
  }
  return undefined;
};

const builderBindingForExpression = (
  expression: Expression,
  scope: Scope,
  context: AstContext,
  seen: Set<Binding> = new Set(),
): Binding | undefined => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== 'Identifier') return undefined;
  const binding = resolveBinding(scope, unwrapped.name);
  if (binding === undefined || seen.has(binding)) return undefined;
  if (binding.builderSource !== undefined) return binding;
  if (
    binding.variableKind !== 'const' ||
    binding.initializer == null ||
    binding.declaration.type === 'ImportDeclaration'
  ) {
    return undefined;
  }
  seen.add(binding);
  const initializerScope = context.scopes.get(binding.initializer) ?? binding.scope;
  return builderBindingForExpression(
    binding.initializer,
    initializerScope,
    context,
    seen,
  );
};

const localHelperFunctionForCall = (
  call: CallExpression,
  scope: Scope,
  context: AstContext,
): BabelFunction | undefined => {
  if (call.optional === true || call.callee.type !== 'Identifier') return undefined;
  let binding = resolveBinding(scope, call.callee.name);
  const seen = new Set<Binding>();
  while (binding !== undefined && !seen.has(binding)) {
    seen.add(binding);
    if (
      binding.declaration.type === 'ImportDeclaration' ||
      binding.importRole !== undefined ||
      binding.importTypeOnly === true
    ) {
      return undefined;
    }
    if (binding.functionNode !== undefined) return binding.functionNode;
    if (binding.variableKind !== 'const' || binding.initializer == null) {
      return undefined;
    }
    const initializer = unwrapExpression(binding.initializer);
    if (initializer.type !== 'Identifier') return undefined;
    binding = resolveBinding(
      context.scopes.get(initializer) ?? binding.scope,
      initializer.name,
    );
  }
  return undefined;
};

const functionUsesBuilder = (
  fn: BabelFunction,
  context: AstContext,
  seen: Set<BabelFunction> = new Set(),
): boolean => {
  if (seen.has(fn)) return false;
  seen.add(fn);
  let usesBuilder = false;
  walk(fn.body, (node) => {
    if (usesBuilder || node.type !== 'CallExpression') return;
    const scope = context.scopes.get(node);
    if (scope === undefined) return;
    const direct = directBuilderCall(node, scope);
    if (
      (direct !== undefined &&
        (ELEMENT_BUILDERS.has(direct.method) || direct.method === 'submodel')) ||
      keyedBuilderCall(node, scope) !== undefined
    ) {
      usesBuilder = true;
      return;
    }
    const nested = localHelperFunctionForCall(node, scope, context);
    if (nested !== undefined && functionUsesBuilder(nested, context, seen)) {
      usesBuilder = true;
    }
  });
  return usesBuilder;
};

const directBuilderCall = (
  call: CallExpression,
  scope: Scope,
): { readonly binding: Binding; readonly method: string } | undefined => {
  const callee = call.callee;
  if (
    callee.type !== 'MemberExpression' ||
    callee.optional === true ||
    callee.computed ||
    callee.object.type !== 'Identifier' ||
    callee.property.type !== 'Identifier'
  ) {
    return undefined;
  }
  const binding = resolveBinding(scope, callee.object.name);
  if (binding?.builderSource === undefined) return undefined;
  return { binding, method: callee.property.name };
};

const keyedBuilderCall = (call: CallExpression, scope: Scope): Binding | undefined => {
  if (call.callee.type !== 'CallExpression' || call.callee.optional === true)
    return undefined;
  const inner = directBuilderCall(call.callee, scope);
  if (inner?.method !== 'keyed' || call.callee.arguments.length !== 1) return undefined;
  return inner.binding;
};

const runtimeCallKind = (
  call: CallExpression,
  scope: Scope,
): 'application' | 'element' | undefined => {
  const callee = call.callee;
  if (callee.type === 'Identifier') {
    const binding = resolveBinding(scope, callee.name);
    if (binding?.importTypeOnly === true) return undefined;
    const role = binding?.importRole;
    if (role === 'make-application') return 'application';
    if (role === 'make-element') return 'element';
    return undefined;
  }
  if (
    callee.type !== 'MemberExpression' ||
    callee.optional === true ||
    callee.computed ||
    callee.property.type !== 'Identifier'
  ) {
    return undefined;
  }
  const kind =
    callee.property.name === 'makeApplication'
      ? 'application'
      : callee.property.name === 'makeElement'
        ? 'element'
        : undefined;
  if (kind === undefined) return undefined;
  if (callee.object.type === 'Identifier') {
    const binding = resolveBinding(scope, callee.object.name);
    return binding?.importRole === 'runtime-namespace' &&
      binding.importTypeOnly !== true
      ? kind
      : undefined;
  }
  if (
    callee.object.type === 'MemberExpression' &&
    !callee.object.computed &&
    callee.object.object.type === 'Identifier' &&
    callee.object.property.type === 'Identifier' &&
    callee.object.property.name === 'Runtime'
  ) {
    const binding = resolveBinding(scope, callee.object.object.name);
    return binding?.importRole === 'foldkit-namespace' &&
      binding.importTypeOnly !== true
      ? kind
      : undefined;
  }
  return undefined;
};

const isDefineViewCall = (call: CallExpression, scope: Scope): boolean => {
  const callee = call.callee;
  if (callee.type === 'Identifier') {
    const binding = resolveBinding(scope, callee.name);
    return binding?.importRole === 'define-view' && binding.importTypeOnly !== true;
  }
  if (
    callee.type !== 'MemberExpression' ||
    callee.optional === true ||
    callee.computed ||
    callee.property.type !== 'Identifier' ||
    callee.property.name !== 'defineView'
  ) {
    return false;
  }
  if (callee.object.type === 'Identifier') {
    const binding = resolveBinding(scope, callee.object.name);
    const role = binding?.importRole;
    return (
      binding?.importTypeOnly !== true &&
      (role === 'define-view-namespace' || role === 'html-namespace')
    );
  }
  if (
    callee.object.type === 'MemberExpression' &&
    !callee.object.computed &&
    callee.object.object.type === 'Identifier' &&
    callee.object.property.type === 'Identifier' &&
    (callee.object.property.name === 'Submodel' ||
      callee.object.property.name === 'Html')
  ) {
    const binding = resolveBinding(scope, callee.object.object.name);
    return (
      binding?.importRole === 'foldkit-namespace' && binding.importTypeOnly !== true
    );
  }
  return false;
};

const resolveObject = (
  expression: Expression | JSXNamespacedName | ArgumentPlaceholder,
  scope: Scope,
): ObjectExpression | undefined => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type === 'ObjectExpression') return unwrapped;
  if (unwrapped.type !== 'Identifier') return undefined;
  const binding = resolveBinding(scope, unwrapped.name);
  if (
    binding?.variableKind !== 'const' ||
    binding.initializer === undefined ||
    binding.initializer === null
  ) {
    return undefined;
  }
  const initializer = unwrapExpression(binding.initializer);
  return initializer.type === 'ObjectExpression' ? initializer : undefined;
};

const definiteProperty = (
  object: ObjectExpression,
  name: string,
): ObjectMethod | ObjectProperty | undefined => {
  for (let index = object.properties.length - 1; index >= 0; index -= 1) {
    const property = object.properties[index];
    if (property === undefined || property.type === 'SpreadElement') return undefined;
    if (property.computed) return undefined;
    const propertyName =
      property.key.type === 'Identifier'
        ? property.key.name
        : property.key.type === 'StringLiteral'
          ? property.key.value
          : undefined;
    if (propertyName === name) return property;
  }
  return undefined;
};

const propertyValue = (
  property: ObjectMethod | ObjectProperty | undefined,
): Expression | ObjectMethod | undefined => {
  if (property === undefined) return undefined;
  if (property.type === 'ObjectMethod') return property;
  return isExpressionNode(property.value) ? property.value : undefined;
};

const expressionPropertyValue = (
  property: ObjectMethod | ObjectProperty | undefined,
): Expression | undefined => {
  const value = propertyValue(property);
  return value === undefined || value.type === 'ObjectMethod' ? undefined : value;
};

const viewSource = (
  value: Expression | ObjectMethod,
  property: ObjectMethod | ObjectProperty | undefined,
  scope: Scope,
  context: AstContext,
): ViewSource | undefined => {
  const valueScope = context.scopes.get(value) ?? scope;
  if (isFunctionNode(value)) {
    const binding = bindingForFunction(value, context);
    if (binding !== undefined) {
      return {
        view: binding.name,
        node: declarationAnchor(binding.declaration, context.parents),
      };
    }
    return { view: propertyName(property) ?? 'view', node: value };
  }
  const expression = unwrapExpression(value);
  if (expression.type === 'Identifier') {
    const binding = resolveBinding(valueScope, expression.name);
    if (binding?.functionNode !== undefined || binding?.defineViewCall !== undefined) {
      return {
        view: binding.name,
        node: declarationAnchor(binding.declaration, context.parents),
      };
    }
    return { view: expression.name, node: expression };
  }
  if (isDefineViewCallExpression(expression, valueScope)) {
    return { view: propertyName(property) ?? 'view', node: expression };
  }
  const label = safePath(expression);
  return label === undefined ? undefined : { view: label, node: expression };
};

const propertyName = (
  property: ObjectMethod | ObjectProperty | undefined,
): string | undefined => {
  if (property === undefined || property.computed) return undefined;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'StringLiteral' && isSafeIdentifier(property.key.value)) {
    return property.key.value;
  }
  return undefined;
};

const functionSource = (
  fn: BabelFunction,
  context: AstContext,
): ViewSource | undefined => {
  const binding = bindingForFunction(fn, context);
  if (binding !== undefined) {
    return {
      view: binding.name,
      node: declarationAnchor(binding.declaration, context.parents),
    };
  }
  if (
    (fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression') &&
    fn.id != null
  ) {
    return { view: fn.id.name, node: fn };
  }
  if (fn.type === 'ObjectMethod') {
    const name = propertyName(fn);
    return name === undefined ? undefined : { view: name, node: fn };
  }
  return undefined;
};

const viewSourceForInlineDefineView = (
  call: CallExpression,
  context: AstContext,
): ViewSource => {
  const parent = context.parents.get(call);
  if (parent?.type === 'ObjectProperty') {
    return { view: propertyName(parent) ?? 'view', node: call };
  }
  return { view: 'view', node: call };
};

const markBuilderParameter = (
  fn: BabelFunction,
  identifier: Identifier,
  source: ViewSource,
  context: AstContext,
): void => {
  const scope = context.scopes.get(fn);
  const binding =
    scope === undefined ? undefined : resolveBinding(scope, identifier.name);
  if (binding !== undefined && binding.identifier === identifier) {
    binding.builderSource = source;
  }
};

const bindingForFunction = (
  fn: BabelFunction,
  context: AstContext,
): Binding | undefined =>
  context.bindings.find((binding) => binding.functionNode === fn);

const setRegistration = (
  registrations: Map<Binding, RegistrationPlan>,
  binding: Binding,
  source: ViewSource,
  modelDefinition: ViewSource | undefined,
): void => {
  const existing = registrations.get(binding);
  const resolvedDefinition = modelDefinition ?? existing?.modelDefinition;
  registrations.set(binding, {
    binding,
    source,
    ...(resolvedDefinition === undefined
      ? {}
      : { modelDefinition: resolvedDefinition }),
  });
};

const modelDefinitionForFunction = (
  fn: BabelFunction,
  context: AstContext,
): ViewSource | undefined => {
  const parameter = fn.params[0];
  const identifier =
    parameter === undefined ? undefined : parameterIdentifier(parameter);
  const type = identifier === undefined ? undefined : typeAnnotationOf(identifier);
  const scope = context.scopes.get(fn);
  if (
    type === undefined ||
    scope === undefined ||
    isHtmlBuilderType(type, scope, context, new Set())
  ) {
    return undefined;
  }
  return modelDefinitionFromType(type, scope, context, new Set());
};

const resolveFunction = (
  value: Expression | ObjectMethod | JSXNamespacedName | ArgumentPlaceholder,
  scope: Scope,
  context: AstContext,
): BabelFunction | undefined => {
  if (isFunctionNode(value)) return value;
  const expression = unwrapExpression(value);
  if (expression.type === 'CallExpression' && isDefineViewCall(expression, scope)) {
    const argument = expression.arguments[0];
    return argument === undefined || argument.type === 'SpreadElement'
      ? undefined
      : resolveFunction(argument, context.scopes.get(expression) ?? scope, context);
  }
  if (expression.type !== 'Identifier') return undefined;
  const binding = resolveBinding(scope, expression.name);
  if (binding?.functionNode !== undefined) return binding.functionNode;
  const defineViewCall = binding?.defineViewCall;
  if (defineViewCall === undefined) return undefined;
  const argument = defineViewCall.arguments[0];
  if (argument === undefined || argument.type === 'SpreadElement') return undefined;
  return resolveFunction(
    argument,
    context.scopes.get(defineViewCall) ?? scope,
    context,
  );
};

const modelSource = (
  expression: Expression,
  scope: Scope,
  context: AstContext,
  preferredDefinition: ViewSource | undefined,
): ModelSource => ({
  expression: safeModelExpression(expression),
  node: expression,
  ...(preferredDefinition === undefined
    ? (() => {
        const definition = modelDefinitionFromExpression(expression, scope, context);
        return definition === undefined ? {} : { definition };
      })()
    : { definition: preferredDefinition }),
});

const modelDefinitionFromView = (
  value: Expression | ObjectMethod,
  scope: Scope,
  context: AstContext,
): ViewSource | undefined => {
  const expression =
    value.type === 'ObjectMethod' ? undefined : unwrapExpression(value);
  const binding =
    expression?.type === 'Identifier'
      ? resolveBinding(scope, expression.name)
      : undefined;
  const modelType =
    binding?.defineViewModelType ??
    (() => {
      const fn = resolveFunction(value, scope, context);
      const parameter = fn?.params[0];
      const identifier =
        parameter === undefined ? undefined : parameterIdentifier(parameter);
      return identifier === undefined ? undefined : typeAnnotationOf(identifier);
    })();
  return modelType === undefined
    ? undefined
    : modelDefinitionFromType(modelType, scope, context, new Set());
};

const modelDefinitionFromExpression = (
  value: Expression,
  scope: Scope,
  context: AstContext,
): ViewSource | undefined => {
  const expression = unwrapExpression(value);
  if (expression.type !== 'Identifier') return undefined;
  const binding = resolveBinding(scope, expression.name);
  if (
    binding === undefined ||
    binding.declaration.type === 'ImportDeclaration' ||
    binding.importRole !== undefined
  ) {
    return undefined;
  }
  if (binding.isParameter) {
    return binding.parameterType === undefined
      ? undefined
      : modelDefinitionFromType(
          binding.parameterType,
          binding.scope,
          context,
          new Set(),
        );
  }
  return {
    view: binding.name,
    node: declarationAnchor(binding.declaration, context.parents),
  };
};

const modelDefinitionFromType = (
  type: TSType,
  scope: Scope,
  context: AstContext,
  seen: Set<TypeBinding>,
): ViewSource | undefined => {
  const unwrapped = unwrapType(type);
  if (
    unwrapped.type === 'TSTypeReference' &&
    unwrapped.typeName.type === 'Identifier'
  ) {
    const binding = resolveTypeBinding(scope, unwrapped.typeName.name);
    if (binding === undefined || seen.has(binding)) return undefined;
    seen.add(binding);
    if (binding.type !== undefined) {
      const nested = modelDefinitionFromType(
        binding.type,
        binding.scope,
        context,
        seen,
      );
      if (nested !== undefined) return nested;
    }
    return {
      view: binding.name,
      node: declarationAnchor(binding.declaration, context.parents),
    };
  }
  if (unwrapped.type === 'TSTypeQuery') {
    const name = entityRootName(unwrapped.exprName);
    if (name === undefined) return undefined;
    const binding = resolveBinding(scope, name);
    if (binding === undefined || binding.importRole !== undefined) return undefined;
    return {
      view: binding.name,
      node: declarationAnchor(binding.declaration, context.parents),
    };
  }
  return undefined;
};

const isHtmlBuilderType = (
  type: TSType,
  scope: Scope | undefined,
  context: AstContext,
  seen: Set<TypeBinding>,
): boolean => {
  if (scope === undefined) return false;
  const unwrapped = unwrapType(type);
  if (unwrapped.type !== 'TSTypeReference') return false;
  const parts = qualifiedTypeName(unwrapped.typeName);
  if (parts.length === 1) {
    const name = parts[0];
    if (name === undefined) return false;
    const importBinding = resolveBinding(scope, name);
    if (importBinding?.importRole === 'html-builder') return true;
    const typeBinding = resolveTypeBinding(scope, name);
    if (typeBinding?.type === undefined || seen.has(typeBinding)) return false;
    seen.add(typeBinding);
    return isHtmlBuilderType(typeBinding.type, typeBinding.scope, context, seen);
  }
  const root = parts[0];
  if (root === undefined) return false;
  const role = resolveBinding(scope, root)?.importRole;
  return (
    (role === 'html-namespace' && parts.length === 2 && parts[1] === 'HtmlBuilder') ||
    (role === 'foldkit-namespace' &&
      parts.length === 3 &&
      parts[1] === 'Html' &&
      parts[2] === 'HtmlBuilder')
  );
};

const resolveBinding = (scope: Scope, name: string): Binding | undefined => {
  let current: Scope | undefined = scope;
  while (current !== undefined) {
    const binding = current.bindings.get(name);
    if (binding !== undefined) return binding;
    current = current.parent;
  }
  return undefined;
};

const resolveTypeBinding = (scope: Scope, name: string): TypeBinding | undefined => {
  let current: Scope | undefined = scope;
  while (current !== undefined) {
    const binding = current.typeBindings.get(name);
    if (binding !== undefined) return binding;
    current = current.parent;
  }
  return undefined;
};

const typeAnnotationOf = (identifier: Identifier): TSType | undefined => {
  const annotation = identifier.typeAnnotation;
  return annotation?.type === 'TSTypeAnnotation'
    ? annotation.typeAnnotation
    : undefined;
};

const parameterIdentifier = (parameter: Node): Identifier | undefined => {
  if (parameter.type === 'Identifier') return parameter;
  if (parameter.type === 'AssignmentPattern' && parameter.left.type === 'Identifier') {
    return parameter.left;
  }
  if (parameter.type === 'TSParameterProperty') {
    return parameterIdentifier(parameter.parameter);
  }
  return undefined;
};

const typeParameter = (call: CallExpression, index: number): TSType | undefined => {
  const parameters = call.typeParameters;
  if (parameters?.type !== 'TSTypeParameterInstantiation') return undefined;
  return parameters.params[index];
};

function unwrapExpression(node: Expression): Expression;
function unwrapExpression(node: Node): Node;
function unwrapExpression(node: Node): Node {
  let current: Node = node;
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TypeCastExpression'
  ) {
    current = current.expression;
  }
  return current.type === 'ParenthesizedExpression'
    ? unwrapExpression(current.expression)
    : current;
}

const unwrapType = (type: TSType): TSType =>
  type.type === 'TSParenthesizedType' ? unwrapType(type.typeAnnotation) : type;

const qualifiedTypeName = (name: Node): Array<string> => {
  if (name.type === 'Identifier') return [name.name];
  if (name.type !== 'TSQualifiedName') return [];
  return [...qualifiedTypeName(name.left), name.right.name];
};

const entityRootName = (name: Node): string | undefined => {
  if (name.type === 'Identifier') return name.name;
  return name.type === 'TSQualifiedName' ? entityRootName(name.left) : undefined;
};

const safeModelExpression = (expression: Expression): string => {
  const unwrapped = unwrapExpression(expression);
  const path = safePath(unwrapped);
  if (path !== undefined) return boundedLabel(path);
  if (unwrapped.type === 'CallExpression') {
    const callee =
      unwrapped.callee.type === 'Super' ||
      unwrapped.callee.type === 'V8IntrinsicIdentifier'
        ? undefined
        : safePath(unwrapExpression(unwrapped.callee));
    return callee === undefined
      ? '(computed expression)'
      : boundedLabel(`${callee}(…)`);
  }
  if (unwrapped.type === 'NewExpression') {
    const callee = safePath(unwrapExpression(unwrapped.callee));
    return callee === undefined
      ? '(computed expression)'
      : boundedLabel(`new ${callee}(…)`);
  }
  return '(computed expression)';
};

const safePath = (expression: Expression): string | undefined => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type === 'Identifier') return unwrapped.name;
  if (
    unwrapped.type !== 'MemberExpression' ||
    unwrapped.computed ||
    unwrapped.property.type !== 'Identifier'
  ) {
    return undefined;
  }
  if (unwrapped.object.type === 'Super') return undefined;
  const owner = safePath(unwrapExpression(unwrapped.object));
  return owner === undefined ? undefined : `${owner}.${unwrapped.property.name}`;
};

const boundedLabel = (value: string): string =>
  value.length <= 120 ? value : `${value.slice(0, 119)}…`;

const isSafeIdentifier = (value: string): boolean => /^[$A-Z_a-z][$\w]*$/u.test(value);

const isRegisterableExpression = (
  value: Expression | ObjectMethod,
): value is Expression => {
  const expression =
    value.type === 'ObjectMethod' ? undefined : unwrapExpression(value);
  return (
    expression?.type === 'ArrowFunctionExpression' ||
    expression?.type === 'FunctionExpression' ||
    expression?.type === 'CallExpression'
  );
};

const isDefineViewCallExpression = (
  expression: Expression,
  scope: Scope,
): expression is CallExpression =>
  expression.type === 'CallExpression' && isDefineViewCall(expression, scope);

const encodeSource = (
  source: ViewSource,
  context: AstContext,
  references: Map<string, AutomaticSourceReference>,
  options: {
    readonly call?: CallExpression;
    readonly attributes?: Expression;
  } = {},
): string => {
  const span = sourceSpan(source, context);
  const start = source.node.start ?? 0;
  const end = source.node.end ?? start;
  const isCapturedCall = options.call === source.node;
  const defaultSnippet = safeSourceSnippetRange(source.node);
  const snippetStart = isCapturedCall
    ? (options.call?.start ?? start)
    : defaultSnippet.start;
  const snippetEnd = isCapturedCall
    ? (options.attributes?.end ?? options.call?.callee.end ?? end)
    : defaultSnippet.end;
  const reference: AutomaticSourceReference = {
    source: span,
    start,
    end,
    snippetStart: Math.max(start, Math.min(snippetStart, end)),
    snippetEnd: Math.max(start, Math.min(snippetEnd, end)),
    snippetTruncated:
      snippetStart > start || snippetEnd < end || defaultSnippet.truncated,
    ...(isCapturedCall && options.attributes?.start != null
      ? {
          attributesStart: options.attributes.start,
          attributesEnd: options.attributes.end ?? options.attributes.start,
        }
      : {}),
  };
  const key = sourceSpanKey(span);
  const existing = references.get(key);
  if (
    existing === undefined ||
    (existing.attributesStart === undefined && reference.attributesStart !== undefined)
  ) {
    references.set(key, reference);
  }
  return JSON.stringify(
    context.sourceEvidence
      ? span
      : {
          file: span.file,
          view: span.view,
          line: span.line,
          column: span.column,
        },
  );
};

const encodeModelSource = (
  source: ModelSource,
  context: AstContext,
  references: Map<string, AutomaticSourceReference>,
): string => {
  const start = source.node.loc?.start;
  const end = source.node.loc?.end;
  return JSON.stringify({
    expression: source.expression,
    file: context.file,
    line: start?.line ?? 1,
    column: (start?.column ?? 0) + 1,
    ...(context.sourceEvidence
      ? {
          endLine: end?.line ?? start?.line ?? 1,
          endColumn: (end?.column ?? start?.column ?? 0) + 1,
          revision: context.revision,
        }
      : {}),
    ...(source.definition === undefined
      ? {}
      : {
          definition: JSON.parse(encodeSource(source.definition, context, references)),
        }),
  });
};

const sourceSpan = (source: ViewSource, context: AstContext): SourceSpan => {
  const start = source.node.loc?.start;
  const end = source.node.loc?.end;
  return {
    file: context.file,
    view: boundedLabel(source.view),
    line: start?.line ?? 1,
    column: (start?.column ?? 0) + 1,
    endLine: end?.line ?? start?.line ?? 1,
    endColumn: (end?.column ?? start?.column ?? 0) + 1,
    revision: context.revision,
  };
};

const sourceSpanKey = (source: SourceSpan): string =>
  [
    source.file,
    source.view,
    source.line,
    source.column,
    source.endLine,
    source.endColumn,
    source.revision,
  ].join('\u0000');

const safeSourceSnippetRange = (
  node: Node,
): { readonly start: number; readonly end: number; readonly truncated: boolean } => {
  const start = node.start ?? 0;
  const end = node.end ?? start;
  const fn = sourceFunction(node);
  if (fn === undefined) return { start, end, truncated: false };
  const bodyStart = fn.body.start;
  if (bodyStart == null || bodyStart <= start || bodyStart >= end) {
    return { start, end, truncated: false };
  }
  const snippetEnd =
    fn.body.type === 'BlockStatement' ? Math.min(bodyStart + 1, end) : bodyStart;
  return { start, end: snippetEnd, truncated: snippetEnd < end };
};

const sourceFunction = (node: Node): BabelFunction | undefined => {
  if (isFunctionNode(node)) return node;
  if (
    (node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportDefaultDeclaration') &&
    node.declaration != null
  ) {
    return sourceFunction(node.declaration);
  }
  if (node.type === 'VariableDeclaration') {
    for (const declaration of node.declarations) {
      if (declaration.init == null) continue;
      const initializer = unwrapExpression(declaration.init);
      if (isFunctionNode(initializer)) return initializer;
      if (initializer.type === 'CallExpression') {
        for (const argument of initializer.arguments) {
          if (argument.type !== 'SpreadElement' && isFunctionNode(argument)) {
            return argument;
          }
        }
      }
    }
  }
  return undefined;
};

const declarationAnchor = (node: Node, parents: WeakMap<Node, Node>): Node => {
  let anchor = node;
  let parent = parents.get(anchor);
  while (
    parent !== undefined &&
    (parent.type === 'ExportNamedDeclaration' ||
      parent.type === 'ExportDefaultDeclaration') &&
    parent.declaration === anchor
  ) {
    anchor = parent;
    parent = parents.get(anchor);
  }
  return anchor;
};

const callOpeningParenthesis = (
  call: CallExpression,
  tokens: ReadonlyArray<unknown>,
): number | undefined => {
  const minimum = call.typeParameters?.end ?? call.callee.end;
  if (minimum == null) return undefined;
  for (const token of tokens) {
    if (!isToken(token) || token.start < minimum || token.end > (call.end ?? Infinity))
      continue;
    if (token.type.label === '(') return token.start;
  }
  return undefined;
};

const callClosingParenthesis = (
  call: CallExpression,
  tokens: ReadonlyArray<unknown>,
): number | undefined => {
  const end = call.end;
  if (end == null) return undefined;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!isToken(token)) continue;
    if (token.end === end && token.type.label === ')') return token.start;
    if (token.end < end) break;
  }
  return undefined;
};

const isToken = (
  value: unknown,
): value is {
  readonly start: number;
  readonly end: number;
  readonly type: { readonly label: string };
} => {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const type = value.type;
  return (
    typeof type === 'object' &&
    type !== null &&
    'label' in type &&
    typeof type.label === 'string' &&
    'start' in value &&
    typeof value.start === 'number' &&
    'end' in value &&
    typeof value.end === 'number'
  );
};

const importInsertionPosition = (program: Node, code: string): number => {
  if (program.type !== 'Program') return 0;
  let position = code.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (program.interpreter?.end !== null && program.interpreter?.end !== undefined) {
    position = Math.max(position, program.interpreter.end);
  }
  for (const directive of program.directives) {
    if (directive.end != null) position = Math.max(position, directive.end);
  }
  return position;
};

const collectIdentifierNames = (program: Node): Set<string> => {
  const names = new Set<string>();
  walk(program, (node) => {
    if (node.type === 'Identifier') names.add(node.name);
    if (node.type === 'PrivateName') names.add(node.id.name);
  });
  return names;
};

const uniqueName = (preferred: string, names: Set<string>): string => {
  let candidate = preferred;
  let suffix = 1;
  while (names.has(candidate)) {
    candidate = `${preferred}_${suffix}`;
    suffix += 1;
  }
  names.add(candidate);
  return candidate;
};

const isFunctionNode = (node: Node): node is BabelFunction =>
  node.type === 'FunctionDeclaration' ||
  node.type === 'FunctionExpression' ||
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'ObjectMethod' ||
  node.type === 'ClassMethod' ||
  node.type === 'ClassPrivateMethod';

const isExpressionNode = (node: Node): node is Expression =>
  node.type !== 'ArrayPattern' &&
  node.type !== 'AssignmentPattern' &&
  node.type !== 'ObjectPattern' &&
  node.type !== 'RestElement' &&
  node.type !== 'VoidPattern';

const forEachChild = (node: Node, visit: (child: Node) => void): void => {
  for (const [key, value] of Object.entries(node)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'innerComments' ||
      key === 'trailingComments' ||
      key === 'tokens' ||
      key === 'comments' ||
      key === 'errors'
    ) {
      continue;
    }
    if (isNode(value)) {
      visit(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) visit(item);
      }
    }
  }
};

const walk = (node: Node, visit: (node: Node) => void): void => {
  visit(node);
  forEachChild(node, (child) => walk(child, visit));
};

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string';
