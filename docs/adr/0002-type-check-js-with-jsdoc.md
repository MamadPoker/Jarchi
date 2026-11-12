# Type-check the JS with JSDoc and tsc; no build step

Jarchi stays plain CommonJS that Node, Electron and the browser run as written. Types are JSDoc comments in the `.js` files, and `npm run typecheck` (`tsc` with `allowJs`, `checkJs`, `noEmit`, `tsconfig.json`) checks them in CI next to `npm test`. `typescript` and `@types/node` are dev dependencies only, so nothing new ends up in the installer. The check covers the Node side first (`core`, `connectors`, `server`, `electron`, `build`) with `strict` off; folders turn strict one at a time. The relay has its own config (`relay/tsconfig.json`: Workers' globals from `@cloudflare/workers-types`, its bindings as an `Env` typedef), and the panel and widgets may get theirs later.

## Considered options

- **Rewrite in `.ts` with a compile step** (`tsc` or esbuild to a `dist/`): rejected for now. It adds a build to `npm start`, `npm run app`, the tests and the installer, and a bundler for the panel and widgets, for type safety JSDoc already gives.
- **Node's built-in type stripping** (`.ts` files run as they are, Node 22.18+): rejected, after trying it (November 2026). The runtime isn't the problem: Electron 45 runs Node 24 with `process.features.typescript` `strip`. But in a `.ts` or `.cts` file a CommonJS `require()` returns `any`, so a converted file would lose the types JSDoc gives it now; keeping them means ES modules, which breaks the `module.exports.fn()` stubs the tests use.
- **The relay as `worker.ts`** (Wrangler bundles it anyway): not yet. ESLint can't parse TypeScript without typescript-eslint, which doesn't support TypeScript 7 yet (its peer range ends below 6.1), and the relay is the file that handles Kick tokens, so it keeps its lint. JSDoc and `relay/tsconfig.json` check its types meanwhile. Rename it when typescript-eslint supports TypeScript 7.
- **Stay untyped**: rejected. The event shape, the settings and the connector callbacks are used across many files, and nothing checked them.

## Consequences

- Inferred types come for free: `settings.get()`'s type follows its defaults, so the settings shape is still written once.
- Where `tsc` can't follow the code (a value changed during an `await`, Node's WebSocket taking headers), a JSDoc cast says why in a comment.
- The `module.exports.fn()` calls the tests stub keep working, because the code stays CommonJS.
