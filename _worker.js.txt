import { JSDOM } from 'jsdom';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // API routes handling
        if (url.pathname.startsWith('/api/')) {
            // Let the Pages Functions handle API routes
            return env.ASSETS.fetch(request);
        }

        // Static file handling
        try {
            // Try to serve the requested static file
            return await env.ASSETS.fetch(request);
        } catch {
            // If file not found, serve index.html for client-side routing
            return env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
        }
    }
}