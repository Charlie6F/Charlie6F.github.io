import { parseHTML } from 'linkedom';

// Configure allowed origins
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

// Logger implementation for CloudFlare environment
const logger = {
    info: (msg) => console.log(`INFO: ${msg}`),
    warning: (msg) => console.warn(`WARNING: ${msg}`),
    error: (msg) => console.error(`ERROR: ${msg}`),
};

class DownloadFormSubmitter {
    constructor(verify_ssl = false, verbose = false) {
        this.verify_ssl = verify_ssl;
        this.verbose = verbose;
        this.maxRetries = 3;
        this.retryDelay = 1500; // Increased delay to 1.5 seconds

        if (!verify_ssl && verbose) {
            logger.warning("SSL verification disabled");
        }

        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        };

        this.base_url = "https://downloadwella.com";
        this.current_url = null;
        this.filename = null;

        // CloudFlare-specific fetch options
        this.fetchOptions = {
            cf: {
                ssl: {
                    verifyMode: "none",
                    rejectUnauthorized: false,
                    certificateMode: "insecure"
                },
                cacheTtl: 0,
                cacheEverything: false,
                scrapeShield: false,
                apps: false,
                minify: {
                    javascript: false,
                    css: false,
                    html: false
                }
            }
        };
    }

    extractFilename(url) {
        try {
            const parsedUrl = new URL(url);
            const pathName = decodeURIComponent(parsedUrl.pathname);
            return pathName.split('/').pop().replace(/\.html$/, '');
        } catch (e) {
            logger.error(`Error extracting filename: ${e.message}`);
            return "downloaded_file";
        }
    }

    extractFileId(url) {
        try {
            const parsedUrl = new URL(url);
            const pathName = parsedUrl.pathname;
            const match = pathName.match(/\/([a-zA-Z0-9]+)(?:\/|$)/);
            if (match) {
                const fileId = match[1];
                if (this.verbose) {
                    logger.info(`File ID: ${fileId}`);
                }
                return fileId;
            }
            logger.error("Could not extract file ID from URL");
            return null;
        } catch (e) {
            logger.error(`Error extracting file ID: ${e.message}`);
            return null;
        }
    }

    async fetchWithRetry(url, options, retryCount = 0) {
        try {
            // Merge default CloudFlare options with provided options
            const mergedOptions = {
                ...options,
                cf: {
                    ...this.fetchOptions.cf,
                    ...options.cf
                }
            };

            // Add custom headers for SSL bypass
            mergedOptions.headers = {
                ...mergedOptions.headers,
                'X-Forwarded-Proto': 'https',
                'X-SSL-Bypass': 'true'
            };

            if (this.verbose) {
                logger.info(`Attempt ${retryCount + 1} - Fetching: ${url}`);
            }

            const response = await fetch(url, mergedOptions);

            // Handle various SSL-related status codes
            if (response.status === 526 || response.status === 525 || response.status === 495) {
                if (retryCount < this.maxRetries) {
                    logger.warning(`CloudFlare SSL error (${response.status}), retry attempt ${retryCount + 1}`);
                    
                    // Increase delay with each retry
                    const currentDelay = this.retryDelay * (retryCount + 1);
                    await new Promise(resolve => setTimeout(resolve, currentDelay));
                    
                    // Try alternative SSL configurations on retries
                    mergedOptions.cf.ssl = {
                        ...mergedOptions.cf.ssl,
                        certificateMode: retryCount === 1 ? "loose" : "insecure",
                        verifyMode: retryCount === 2 ? "loose" : "none"
                    };
                    
                    return this.fetchWithRetry(url, mergedOptions, retryCount + 1);
                }
                throw new Error(`SSL verification failed after ${this.maxRetries} retries (Status: ${response.status})`);
            }

            return response;
        } catch (error) {
            if (error.message.includes('SSL') && retryCount < this.maxRetries) {
                logger.warning(`SSL error, retry attempt ${retryCount + 1}: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retryCount + 1)));
                return this.fetchWithRetry(url, options, retryCount + 1);
            }
            throw error;
        }
    }

    async getPageContent(url) {
        try {
            if (!url.includes('downloadwella.com')) {
                logger.info(`Found direct url: ${url}`);
                return { text: async () => url };
            }

            const fetchOptions = {
                method: 'GET',
                headers: this.headers,
                ...this.fetchOptions
            };

            const response = await this.fetchWithRetry(url, fetchOptions);

            if (!response.ok) {
                throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
            }

            return response;
        } catch (e) {
            logger.error(`Page fetch failed: ${e.message}`);
            throw e;
        }
    }

    extractFormData(htmlContent) {
        try {
            const { document } = parseHTML(htmlContent);
            const form = document.querySelector('form');
            const formData = {};
            let actionUrl = null;

            if (form) {
                if (this.verbose) {
                    logger.info("Form found");
                }
                for (const inputTag of form.querySelectorAll('input')) {
                    const name = inputTag.getAttribute('name');
                    const value = inputTag.getAttribute('value') || '';
                    if (name) {
                        formData[name] = value;
                    }
                }
                actionUrl = form.getAttribute('action');
                if (Object.keys(formData).length > 0) {
                    return [formData, actionUrl];
                }
            }
            logger.warning("No form data found in page");
            return [null, null];
        } catch (e) {
            logger.error(`Error extracting form data: ${e.message}`);
            return [null, null];
        }
    }

    async submitForm(url) {
        try {
            this.current_url = url;
            this.filename = this.extractFilename(url);
            const fileId = this.extractFileId(url);

            if (!fileId) {
                throw new Error("Invalid URL format - could not extract file ID");
            }
            
            if (this.verbose) {
                logger.info("Processing download page...");
            }

            if (!url.includes('downloadwella.com')) {
                logger.info(`Found direct url: ${url}`);
                return { url: url };
            }

            const initialResponse = await this.getPageContent(url);
            
            if (typeof initialResponse.text !== 'function') {
                return { url: initialResponse.text };
            }

            const htmlContent = await initialResponse.text();
            const [formData, formAction] = this.extractFormData(htmlContent);

            const finalFormData = new URLSearchParams({
                op: 'download2',
                id: fileId,
                rand: '',
                referer: '',
                method_free: 'Free Download',
                method_premium: '',
                ...formData
            });

            this.headers['Origin'] = this.base_url;
            this.headers['Referer'] = url;
            this.headers['Content-Type'] = 'application/x-www-form-urlencoded';

            if (this.verbose) {
                logger.info("Waiting for form submission...");
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));

            const submitUrl = new URL(formAction || '', this.base_url).href;
            
            if (this.verbose) {
                logger.info("Submitting form...");
            }

            const response = await this.fetchWithRetry(submitUrl, {
                method: 'POST',
                headers: this.headers,
                body: finalFormData.toString(),
                redirect: 'follow',
                ...this.fetchOptions
            });

            if (response.ok) {
                const downloadUrl = response.url;
                
                if (this.verbose) {
                    logger.info(`Download url found: ${downloadUrl}`);
                }

                return {
                    url: downloadUrl,
                    filename: this.filename,
                    file_id: fileId
                };
            } else {
                throw new Error(`Form submission failed with status code: ${response.status}`);
            }

        } catch (e) {
            logger.error(`Request failed: ${e.message}`);
            throw e;
        }
    }
}

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
            const downloader = new DownloadFormSubmitter(!devMode, devMode);
            const result = await downloader.submitForm(downloadUrl);
            
            if (!result) {
                throw new Error('Failed to get download URL');
            }
            
            return new Response(JSON.stringify(result), {
                headers: { 
                    'Content-Type': 'application/json',
                    ...(devMode && { 'X-Dev-Mode': 'true' })
                }
            });
        } catch (error) {
            console.error('Download error:', error);
            
            const errorResponse = {
                error: 'Download failed',
                details: error.message,
                url: downloadUrl,
                devMode: devMode,
                suggestion: error.message.includes('SSL') ? 
                    'Try enabling development mode to bypass SSL verification' : 
                    'Please try again later'
            };
            
            return new Response(JSON.stringify(errorResponse), {
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

// Update the download route with better error handling
apiRoutes['/api/download'] = async (request) => {
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
        const downloader = new DownloadFormSubmitter(false, devMode);
        const result = await downloader.submitForm(downloadUrl);
        
        return new Response(JSON.stringify(result), {
            headers: { 
                'Content-Type': 'application/json',
                ...(devMode && { 'X-Dev-Mode': 'true' })
            }
        });
    } catch (error) {
        console.error('Download error:', error);
        
        const errorResponse = {
            error: 'Download failed',
            details: error.message,
            url: downloadUrl,
            devMode: devMode,
            retryAttempts: 3,
            errorType: error.message.includes('SSL') ? 'SSL_ERROR' : 'FETCH_ERROR',
            suggestion: 'Please try again in a few moments'
        };
        
        return new Response(JSON.stringify(errorResponse), {
            status: error.message.includes('SSL') ? 526 : 502,
            headers: { 
                'Content-Type': 'application/json',
                'X-Error-Type': errorResponse.errorType,
                ...(devMode && { 'X-Dev-Mode': 'true' })
            }
        });
    }
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