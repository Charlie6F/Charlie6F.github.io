import { parseHTML } from 'linkedom';

class DownloadFormSubmitter {
    constructor(verbose = false, devMode = false) {
        this.verbose = verbose;
        this.devMode = devMode;
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive'
        };
        this.base_url = "https://downloadwella.com";
        
        if (this.devMode) {
            console.warn('⚠️ Running in development mode with relaxed SSL verification');
        }
    }

    extractFileId(url) {
        try {
            const parsedUrl = new URL(url);
            const pathName = parsedUrl.pathname;
            const match = pathName.match(/\/([a-zA-Z0-9]+)(?:\/|$)/);
            return match ? match[1] : null;
        } catch (e) {
            console.error(`Error extracting file ID: ${e.message}`);
            return null;
        }
    }

    async getPageContent(url) {
        if (!url.includes('downloadwella.com')) {
            return { url };
        }

        const fetchOptions = {
            headers: this.headers,
            method: 'GET'
        };

        if (this.devMode) {
            fetchOptions.cf = {
                ssl: false,
                rejectUnauthorized: false
            };
        }

        try {
            const response = await fetch(url, fetchOptions);
            
            if (response.status === 526 && this.devMode) {
                console.warn('Cloudflare SSL verification failed, retrying with relaxed settings');
                const retryResponse = await fetch(url, {
                    ...fetchOptions,
                    cf: {
                        ...fetchOptions.cf,
                        tlsVersion: 'TLSv1.2',
                        ciphers: ['ECDHE-ECDSA-AES128-GCM-SHA256'],
                        minTlsVersion: '1.0'
                    }
                });
                return retryResponse;
            }

            if (response.ok) {
                return response;
            }
            throw new Error(`Request failed with status ${response.status}`);
        } catch (error) {
            if (this.verbose) {
                console.error('Fetch error:', error);
            }
            throw error;
        }
    }

    extractFormData(htmlContent) {
        try {
            const { document } = parseHTML(htmlContent);
            const form = document.querySelector('form');
            const formData = {};
            
            if (form) {
                for (const input of form.querySelectorAll('input')) {
                    const name = input.getAttribute('name');
                    const value = input.getAttribute('value') || '';
                    if (name) formData[name] = value;
                }
                return [formData, form.getAttribute('action')];
            }
            return [null, null];
        } catch (e) {
            console.error(`Error extracting form data: ${e.message}`);
            return [null, null];
        }
    }

    async submitForm(url) {
        try {
            const fileId = this.extractFileId(url);
            if (!fileId) {
                throw new Error("Invalid URL format");
            }

            if (!url.includes('downloadwella.com')) {
                return { url };
            }

            const initialResponse = await this.getPageContent(url);
            const htmlContent = await initialResponse.text();
            const [formData, formAction] = this.extractFormData(htmlContent);

            const finalFormData = {
                op: 'download2',
                id: fileId,
                rand: '',
                referer: '',
                method_free: 'Free Download',
                method_premium: '',
                ...formData
            };

            // Wait for 2 seconds like the direct download version
            await new Promise(resolve => setTimeout(resolve, 2000));

            const submitUrl = new URL(formAction || '', this.base_url).href;
            const fetchOptions = {
                method: 'POST',
                headers: {
                    ...this.headers,
                    'Origin': this.base_url,
                    'Referer': url,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams(finalFormData).toString(),
                redirect: 'follow'
            };

            if (this.devMode) {
                fetchOptions.cf = {
                    ssl: false,
                    rejectUnauthorized: false,
                    tlsVersion: 'TLSv1.2',
                    ciphers: ['ECDHE-ECDSA-AES128-GCM-SHA256'],
                    minTlsVersion: '1.0'
                };
            }

            const response = await fetch(submitUrl, fetchOptions);

            if (response.status === 526 && this.devMode) {
                console.warn('Cloudflare SSL verification failed on form submission, retrying with relaxed settings');
                const retryResponse = await fetch(submitUrl, {
                    ...fetchOptions,
                    cf: {
                        ...fetchOptions.cf,
                        strictSSL: false
                    }
                });
                return this.extractDownloadUrl(retryResponse);
            }

            if (response.ok) {
                return this.extractDownloadUrl(response);
            }
            throw new Error(`Form submission failed with status ${response.status}`);
        } catch (e) {
            if (this.verbose) {
                console.error(`Request failed: ${e.message}`);
            }
            throw e;
        }
    }

    async extractDownloadUrl(response) {
        try {
            // Get the response content
            const html = await response.text();
            const { document } = parseHTML(html);
    
            // First try to find the direct download link
            const downloadLinks = [
                // Direct download button/link
                ...document.querySelectorAll('a[href*="downloadwella.com/d/"]'),
                ...document.querySelectorAll('a[href*="dweds"]'),
                // Backup selectors for different URL patterns
                ...document.querySelectorAll('a[href*="/d/"]'),
                ...document.querySelectorAll('a[href$=".mkv"]'),
                ...document.querySelectorAll('a[href$=".mp4"]'),
                ...document.querySelectorAll('a[href$=".avi"]')
            ];
    
            for (const link of downloadLinks) {
                const href = link.getAttribute('href');
                if (href && (
                    href.includes('/d/') || 
                    href.includes('dweds') || 
                    href.endsWith('.mkv') || 
                    href.endsWith('.mp4') || 
                    href.endsWith('.avi')
                )) {
                    // Ensure we have a full URL
                    const fullUrl = href.startsWith('http') ? href : new URL(href, this.base_url).href;
                    if (this.verbose) {
                        console.log('Found download URL:', fullUrl);
                    }
                    return { url: fullUrl };
                }
            }
    
            // Fallback to content-disposition header
            const contentDisposition = response.headers.get('content-disposition');
            if (contentDisposition) {
                return { url: response.url };
            }
    
            // If we still haven't found a URL, try parsing any iframe sources
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                const src = iframe.getAttribute('src');
                if (src && (src.includes('/d/') || src.includes('dweds'))) {
                    return { url: new URL(src, this.base_url).href };
                }
            }
    
            // Last resort: Try to find any link that looks like a download link
            const allLinks = document.querySelectorAll('a[href]');
            for (const link of allLinks) {
                const href = link.getAttribute('href');
                if (href && (
                    link.textContent.toLowerCase().includes('download') ||
                    href.includes('download') ||
                    href.includes('/d/') ||
                    href.includes('dweds')
                )) {
                    return { url: new URL(href, this.base_url).href };
                }
            }
    
            // If all methods fail, return the response URL
            console.warn('No download URL found in page, falling back to response URL');
            return { url: response.url };
        } catch (error) {
            console.error('Error extracting download URL:', error);
            return { url: response.url };
        }
    }
}

const ALLOWED_ORIGINS = [
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
        const devMode = url.searchParams.get('dev') === 'true';
        
        if (!downloadUrl) {
            return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            const downloader = new DownloadFormSubmitter(true, devMode);
            const result = await downloader.submitForm(downloadUrl);
            return new Response(JSON.stringify(result), {
                headers: { 
                    'Content-Type': 'application/json',
                    ...(devMode && { 'X-Dev-Mode': 'true' })
                }
            });
        } catch (error) {
            console.error('Download error:', error);
            
            const errorMessage = {
                error: 'Download failed',
                details: error.message,
                type: error.name,
                url: downloadUrl,
                devMode: devMode
            };
            
            return new Response(JSON.stringify(errorMessage), {
                status: 502,
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Error-Type': 'download_failed',
                    ...(devMode && { 'X-Dev-Mode': 'true' })
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