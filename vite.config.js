import { cpSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { renderCvPage } from './tools/cv-page/build-cv.mjs';

const fromRoot = (path) => fileURLToPath(new URL(path, import.meta.url));

// content/ stays outside public/ because it is authored material, not a static
// asset of the app: keeping it at the root means the CV files have one home and
// the HTML edition can read the very same files. The dev server already serves
// them from the project root, so only the build needs this copy.
function copyContent() {
  return {
    name: 'farfield-content',
    apply: 'build',
    closeBundle() {
      cpSync(fromRoot('content'), fromRoot('dist/content'), { recursive: true });
    },
  };
}

// The readable edition is generated, never committed: it is the six content
// files laid out as one page, so a copy of it in the repository would be a
// second source of the same text and would go stale the moment one of them is
// corrected. It is built here rather than in a pre-build script so that the
// development server serves it from the files as they are on disk right now.
const CV_ROUTES = new Set(['/cv', '/cv/', '/cv/index.html']);

function cvPage() {
  return {
    name: 'farfield-cv',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!CV_ROUTES.has(request.url.split('?')[0])) return next();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        return response.end(renderCvPage());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'cv/index.html', source: renderCvPage() });
    },
  };
}

export default defineConfig({
  // Relative base keeps the build working on any static host, including
  // preview URLs served from a sub-path.
  base: './',
  server: {
    fs: {
      // The session worktrees reach node_modules through a junction into this
      // tree. Vite resolves the junction to its real path, which sits outside
      // the worktree's root, and answers 403 for every file in it -- the Basis
      // transcoder first, so KTX2 textures never transcode and the world runs
      // undressed. Allowing the real location keeps the junctions working.
      allow: ['.', realpathSync(fromRoot('node_modules'))],
    },
  },
  plugins: [copyContent(), cvPage()],
  optimizeDeps: {
    // The KTX2 loader resolves the Basis transcoder relative to its own module
    // URL. Dependency pre-bundling rewrites that URL and the dev server ends up
    // answering the request with index.html, so this one module is served from
    // where it actually lives.
    exclude: ['three/examples/jsm/loaders/KTX2Loader.js'],
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
