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
        
        console.log('🔧 Initializing DownloadFormSubmitter:', {
            verbose,
            devMode,
            baseUrl: this.base_url,
            headers: JSON.stringify(this.headers, null, 2)
        });
    }

    debug(message, data = null) {
        if (this.verbose) {
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] 🔍 ${message}`;
            if (data) {
                console.log(logMessage, JSON.stringify(data, null, 2));
            } else {
                console.log(logMessage);
            }
        }
    }

    error(message, error = null) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] ❌ ${message}`, error ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: error.cause
        } : '');
    }

    extractFileId(url) {
        this.debug('Attempting to extract file ID from URL:', { url });
        try {
            const parsedUrl = new URL(url);
            const pathName = parsedUrl.pathname;
            const match = pathName.match(/\/([a-zA-Z0-9]+)(?:\/|$)/);
            const fileId = match ? match[1] : null;
            
            this.debug('File ID extraction result:', { 
                pathName,
                matchPattern: '/([a-zA-Z0-9]+)(?:\/|$)',
                fileId,
                success: !!fileId
            });
            
            return fileId;
        } catch (e) {
            this.error('Failed to extract file ID', e);
            return null;
        }
    }

    async getPageContent(url) {
        this.debug('Initiating page content fetch:', { url });

        const fetchOptions = {
            headers: this.headers,
            method: 'GET'
        };

        if (this.devMode) {
            this.debug('Running in dev mode with SSL verification disabled');
            fetchOptions.cf = {
                ssl: false,
                rejectUnauthorized: false
            };
        }

        try {
            this.debug('Sending fetch request with options:', fetchOptions);
            const response = await fetch(url, fetchOptions);
            
            this.debug('Received response:', {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries())
            });
            
            if (response.status === 526 && this.devMode) {
                this.debug('Cloudflare SSL verification failed, attempting retry with relaxed settings');
                const retryResponse = await fetch(url, {
                    ...fetchOptions,
                    cf: {
                        ...fetchOptions.cf,
                        tlsVersion: 'TLSv1.2',
                        ciphers: ['ECDHE-ECDSA-AES128-GCM-SHA256'],
                        minTlsVersion: '1.0'
                    }
                });
                this.debug('Retry response received:', {
                    status: retryResponse.status,
                    statusText: retryResponse.statusText,
                    headers: Object.fromEntries(retryResponse.headers.entries())
                });
                return retryResponse;
            }

            if (response.ok) {
                return response;
            }
            throw new Error(`Request failed with status ${response.status}`);
        } catch (error) {
            this.error('Failed to fetch page content', error);
            throw error;
        }
    }

    extractFormData(htmlContent) {
        this.debug('Beginning form data extraction from HTML content');
        try {
            const { document } = parseHTML(htmlContent);
            const form = document.querySelector('form');
            
            if (!form) {
                this.debug('No form found in HTML content');
                return [null, null];
            }

            const formData = {};
            const inputs = form.querySelectorAll('input');
            
            this.debug('Found form:', {
                action: form.getAttribute('action'),
                method: form.getAttribute('method'),
                inputCount: inputs.length
            });
            
            for (const input of inputs) {
                const name = input.getAttribute('name');
                const value = input.getAttribute('value') || '';
                if (name) {
                    formData[name] = value;
                    this.debug('Extracted input field:', { name, value, type: input.getAttribute('type') });
                }
            }
            
            return [formData, form.getAttribute('action')];
        } catch (e) {
            this.error('Failed to extract form data', e);
            return [null, null];
        }
    }

    async submitForm(url) {
        this.debug('Starting form submission process', { url });
        try {
            const fileId = this.extractFileId(url);
            if (!fileId) {
                throw new Error("Invalid URL format");
            }

            if (!url.includes('downloadwella.com')) {
                this.debug('URL is not from downloadwella.com, returning directly', { url });
                return { url };
            }

            this.debug('Fetching initial page content');
            const initialResponse = await this.getPageContent(url);
            const htmlContent = await initialResponse.text();
            this.debug('Initial page content length:', { contentLength: htmlContent.length });

            const [formData, formAction] = this.extractFormData(htmlContent);
            this.debug('Extracted form data:', { formData, formAction });

            const finalFormData = {
                op: 'download2',
                id: fileId,
                rand: '',
                referer: '',
                method_free: 'Free Download',
                method_premium: '',
                ...formData
            };

            this.debug('Constructed final form data:', finalFormData);

            this.debug('Waiting 2 seconds before submission...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            const submitUrl = new URL(formAction || '', this.base_url).href;
            this.debug('Form submission URL:', { submitUrl });

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
                this.debug('Adding dev mode SSL options to form submission');
                fetchOptions.cf = {
                    ssl: false,
                    rejectUnauthorized: false,
                    tlsVersion: 'TLSv1.2',
                    ciphers: ['ECDHE-ECDSA-AES128-GCM-SHA256'],
                    minTlsVersion: '1.0'
                };
            }

            this.debug('Submitting form with options:', fetchOptions);
            const response = await fetch(submitUrl, fetchOptions);
            
            this.debug('Form submission response:', {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries())
            });

            if (response.status === 526 && this.devMode) {
                this.debug('Cloudflare SSL verification failed on form submission, retrying with relaxed settings');
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
            this.error('Form submission failed', e);
            throw e;
        }
    }

    async extractDownloadUrl(response) {
        this.debug('Beginning download URL extraction from response');
        try {
            const html = await response.text();
            this.debug('Response content length:', {content: html, contentLength: html.length });
            
            const { document } = parseHTML(html);
            this.debug('Response document :', {content: document});
            
            const selectors = [
                'a[href*="downloadwella.com/d/"]',
                'a[href*="dweds"]',
                'a[href*="/d/"]',
                'a[href$=".mkv"]',
                'a[href$=".mp4"]',
                'a[href$=".avi"]'
            ];
            
            this.debug('Searching for download links using selectors:', selectors);

            const downloadLinks = selectors.flatMap(selector => {
                const links = [...document.querySelectorAll(selector)];
                this.debug(`Found ${links} links matching selector:`, { selector });
                return links;
            });

            for (const link of downloadLinks) {
                const href = link.getAttribute('href');
                this.debug('Found valid URL:', { link });
                if (href && (
                    href.includes('/d/') || 
                    href.includes('dweds') || 
                    href.endsWith('.mkv') || 
                    href.endsWith('.mp4') || 
                    href.endsWith('.avi')
                )) {
                    const fullUrl = href.startsWith('http') ? href : new URL(href, this.base_url).href;
                    this.debug('Found valid download URL:', { fullUrl });
                    return { fullurl: fullUrl };
                }
            }

            const contentDisposition = response.headers.get('content-disposition');
            if (contentDisposition) {
                this.debug('Found content-disposition header:', { contentDisposition });
                return { url: response.url };
            }

            this.debug('Checking iframe sources');
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                const src = iframe.getAttribute('src');
                if (src && (src.includes('/d/') || src.includes('dweds'))) {
                    const fullUrl = new URL(src, this.base_url).href;
                    this.debug('Found download URL in iframe:', { fullUrl });
                    return { url: fullUrl };
                }
            }

            this.debug('Searching for any download-like links');
            const allLinks = document.querySelectorAll('a[href]');
            for (const link of allLinks) {
                const href = link.getAttribute('href');
                if (href && (
                    link.textContent.toLowerCase().includes('download') ||
                    href.includes('download') ||
                    href.includes('/d/') ||
                    href.includes('dweds')
                )) {
                    const fullUrl = new URL(href, this.base_url).href;
                    this.debug('Found potential download link:', { fullUrl });
                    return { url: fullUrl };
                }
            }

            this.debug('No download URL found, falling back to response URL');
            return { url: response.url };
        } catch (error) {
            this.error('Failed to extract download URL', error);
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