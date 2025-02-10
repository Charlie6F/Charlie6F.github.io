import { parseHTML } from 'linkedom';

const ALLOWED_ORIGINS = [
    'https://servers-5407.onrender.com',
    'https://nexu.charles06f.workers.dev',
    'https://nexu.name.ng',
    'https://nkiri.com',
    'https://optimum-current-hawk.ngrok-free.app',
    'https://charlie6f.github.io',
    'http://localhost:8000',
    'http://localhost:8080',
    'https://ominous-space-fishstick-pjgvrxjqjwrjh9476-8080.app.github.dev',
    'https://ominous-space-fishstick-pjgvrxjqjwrjh9476-9564.app.github.dev'
];

// API Route handlers
const apiRoutes = {
    '/api/health': async () => {
        return new Response(JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString()
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    },

    '/api/image': async (request) => {
        const url = new URL(request.url);
        const imageUrl = url.searchParams.get('url');

        if (!imageUrl) {
            return new Response('Missing url parameter', { status: 400 });
        }

        try {
            const response = await fetch(imageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)',
                }
            });

            return new Response(response.body, {
                headers: {
                    'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
                }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    },

    '/api/youtube': async (request, env) => {
        const url = new URL(request.url);
        const searchQuery = url.searchParams.get('q');

        if (!searchQuery) {
            return new Response(JSON.stringify({ error: 'Search query parameter "q" is missing.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            const youtubeResponse = await fetch(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery + ' official trailer')}&type=video&maxResults=1&key=${env.YOUTUBE_API_KEY}`
            );

            const data = await youtubeResponse.json();
            return new Response(JSON.stringify({
                videoId: data.items?.[0]?.id?.videoId
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    },

    '/api/download': async (request) => {
        const url = new URL(request.url);
        const downloadUrl = url.searchParams.get('url');
        
        if (!downloadUrl) {
            return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            // Forward the request to your external service
            const externalServiceUrl = `https://servers-5407.onrender.com/download?url=${encodeURIComponent(downloadUrl)}`;
            const response = await fetch(externalServiceUrl);
            const result = await response.json();

            return new Response(JSON.stringify(result), {
                headers: { 
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            console.error('Download error:', error);
            
            const errorResponse = {
                error: 'Download failed',
                details: error.message,
                url: downloadUrl,
                suggestion: 'Please try again later'
            };
            
            return new Response(JSON.stringify(errorResponse), {
                status: 502,
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Error-Type': 'download_failed'
                }
            });
        }
    },
};

// Main worker
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get('origin');

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    'Access-Control-Max-Age': '86400'
                }
            });
        }

        try {
            // Handle API routes
            const apiHandler = apiRoutes[url.pathname];
            if (apiHandler) {
                const response = await apiHandler(request, env);
                // Add CORS headers to API responses
                const headers = new Headers(response.headers);
                headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
                return new Response(response.body, {
                    status: response.status,
                    headers
                });
            }

            // Handle static assets
            if (env.ASSETS) {
                try {
                    const response = await env.ASSETS.fetch(request);
                    if (response.ok) {
                        const headers = new Headers(response.headers);
                        if (url.pathname.endsWith('.js')) {
                            headers.set('Content-Type', 'application/javascript');
                        }
                        headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '');
                        
                        return new Response(response.body, {
                            status: response.status,
                            headers
                        });
                    }
                } catch (staticError) {
                    // Fall through to index.html
                }
                
                // Serve index.html for all other routes (SPA fallback)
                return await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
            }

            return new Response('Server configuration error: ASSETS binding not found', {
                status: 500,
                headers: { 'Content-Type': 'text/plain' }
            });
            
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ''
                }
            });
        }
    }
};