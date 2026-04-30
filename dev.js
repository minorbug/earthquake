// dev.js — local dev server with Bun's HTML bundler + static file serving.
// Run: bun run dev
import index from './index.html';

const PORT = 3000;

Bun.serve({
    development: true,
    port: PORT,
    routes: {
        '/': index,
    },
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;

        // Serve static files from project root for these prefixes
        if (path.startsWith('/img/') || path.startsWith('/data/') || path === '/favicon.ico') {
            const file = Bun.file('.' + path);
            if (await file.exists()) return new Response(file);
        }

        return new Response('Not Found', { status: 404 });
    },
});

console.log(`Dev server: http://localhost:${PORT}/`);
