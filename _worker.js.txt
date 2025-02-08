export default {
    async fetch(request, env, ctx) {
        // Check if ASSETS binding exists
        if (!env.ASSETS) {
            return new Response('Server configuration error: ASSETS binding not found', {
                status: 500,
                headers: { 'Content-Type': 'text/plain' }
            });
        }

        const url = new URL(request.url);
        
        try {
            // Handle specific file types needed for Flutter/Python web app
            const criticalFiles = [
                '/python.js',
                '/flutter_bootstrap.js',
                '/flutter_service_worker',
                '/manifest.json',
                '/python-worker.js',  // Common Pyodide worker path
            ];

            // API routes handling
            if (url.pathname.startsWith('/api/')) {
                return await env.ASSETS.fetch(request);
            }

            // Try to serve the requested static file
            try {
                const response = await env.ASSETS.fetch(request);
                if (response.ok) {
                    // Add CORS headers for development
                    const headers = new Headers(response.headers);
                    headers.set('Access-Control-Allow-Origin', '*');
                    
                    // Add proper content type for JavaScript files
                    if (url.pathname.endsWith('.js')) {
                        headers.set('Content-Type', 'application/javascript');
                    }
                    
                    return new Response(response.body, {
                        status: response.status,
                        headers
                    });
                }
            } catch (staticError) {
                console.error('Static file error:', staticError);
            }

            // If file not found, check if it's a critical file
            if (criticalFiles.includes(url.pathname)) {
                return new Response('File not found: ' + url.pathname, {
                    status: 404,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }

            // Serve index.html for all other routes (SPA fallback)
            return await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
            
        } catch (error) {
            return new Response(`Internal server error: ${error.message}`, {
                status: 500,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
    }
}