import { defineConfig } from 'tsup';

// Bundles the MCP server into a single self-contained ESM file for npm publishing.
//
// Externalization:
//   - `@modelcontextprotocol/sdk` and `zod` are real runtime `dependencies` →
//     tsup leaves them external (installed from npm; `zod` is also the SDK's own
//     peer, so sharing one copy avoids duplication).
//   - `@runhooks/shared` is a `devDependency` and listed in `noExternal` to be
//     explicit → it is inlined into dist/index.js (never published).
// The shebang on src/index.ts is preserved by tsup and the output is executable.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  clean: true,
  dts: false, // a server bin ships no type declarations
  sourcemap: false,
  minify: false,
  noExternal: ['@runhooks/shared'],
});
