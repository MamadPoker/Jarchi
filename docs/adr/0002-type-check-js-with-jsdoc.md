# Type-check the JS with JSDoc and tsc; no build step

Jarchi stays plain CommonJS that Node, Electron and the browser run as written. Types are JSDoc comments in the `.js` files, and `npm run typecheck` (`tsc` with `allowJs`, `checkJs`, `noEmit`, `tsconfig.json`) checks them in CI next to `npm test`. `typescript` and `@types/node` are dev dependencies only, so nothing new ends up in the installer. The check covers the Node side first (`core`, `connectors`, `server`, `electron`, `build`) with `strict` off; folders turn strict one at a time, and the panel, widgets and relay get their own configs later.

## Considered options

- **Rewrite in `.ts` with a compile step** (`tsc` or esbuild to a `dist/`): rejected for now. It adds a build to `npm start`, `npm run app`, the tests and the installer, and a bundler for the panel and widgets, for type safety JSDoc already gives.
- **Node's built-in type stripping** (`.ts` files run as they are, Node 22.18+): not yet. It hasn't been tried in Electron's `utilityProcess` inside the packaged asar. If it works there, a folder can become `.ts` with `erasableSyntaxOnly` and no build step. The relay can be `.ts` already, since Wrangler bundles it anyway.
- **Stay untyped**: rejected. The event shape, the settings and the connector callbacks are used across many files, and nothing checked them.

## Consequences

- Inferred types come for free: `settings.get()`'s type follows its defaults, so the settings shape is still written once.
- Where `tsc` can't follow the code (a value changed during an `await`, Node's WebSocket taking headers), a JSDoc cast says why in a comment.
- The `module.exports.fn()` calls the tests stub keep working, because the code stays CommonJS.
