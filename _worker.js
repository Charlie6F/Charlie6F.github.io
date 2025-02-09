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
    this.current_url = null;
    this.filename = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.retryDelay = 2000; // Initial delay in milliseconds

    if (devMode) {
      this.log('warning', "Development mode enabled - SSL verification disabled");
    }
  }

  // Add error classification method
  classifyError(status, message) {
    // Cloudflare specific error codes
    const cloudflareErrors = {
      520: 'Unknown Error',
      521: 'Web Server Is Down',
      522: 'Connection Timed Out',
      523: 'Origin Is Unreachable',
      524: 'A Timeout Occurred',
      525: 'SSL Handshake Failed',
      526: 'Invalid SSL Certificate',
      527: 'Railgun Error',
      530: 'Origin DNS Error'
    };

    if (status in cloudflareErrors) {
      return {
        type: 'CLOUDFLARE_ERROR',
        code: status,
        description: cloudflareErrors[status],
        retryable: status !== 525 && status !== 526, // Don't retry SSL-related errors
        sslRelated: status === 525 || status === 526
      };
    }

    if (message.includes('SSL') || message.includes('certificate')) {
      return {
        type: 'SSL_ERROR',
        code: status,
        description: 'SSL Certificate Verification Failed',
        retryable: false,
        sslRelated: true
      };
    }

    return {
      type: 'GENERAL_ERROR',
      code: status,
      description: message,
      retryable: status >= 500 && status !== 526,
      sslRelated: false
    };
  }

  async retryWithExponentialBackoff(operation) {
    while (this.retryCount < this.maxRetries) {
      try {
        return await operation();
      } catch (error) {
        const errorInfo = this.classifyError(error.status || 0, error.message);
        
        if (!errorInfo.retryable) {
          throw {
            ...error,
            classified: errorInfo
          };
        }

        this.retryCount++;
        if (this.retryCount === this.maxRetries) {
          throw {
            ...error,
            classified: errorInfo,
            message: `Failed after ${this.maxRetries} retries: ${error.message}`
          };
        }

        const delay = this.retryDelay * Math.pow(2, this.retryCount - 1);
        this.log('warning', `Attempt ${this.retryCount}/${this.maxRetries} failed. Retrying in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async getPageContent(url) {
    return this.retryWithExponentialBackoff(async () => {
      try {
        this.log('info', `Fetching page: ${url}`);
        if (!url.includes('downloadwella.com')) {
          this.log('info', `Found direct url: ${url}`);
          return url;
        }

        const fetchOptions = {
          headers: this.headers,
          redirect: 'follow'
        };

        if (this.devMode) {
          fetchOptions.insecure = true;
          this.log('info', 'SSL verification disabled for development');
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const error = new Error(`Request failed with status code ${response.status}`);
          error.status = response.status;
          throw error;
        }

        return response;
      } catch (e) {
        const errorInfo = this.classifyError(e.status || 0, e.message);
        
        if (errorInfo.sslRelated && !this.devMode) {
          this.log('warning', 'SSL verification failed - enabling development mode and retrying');
          this.devMode = true;
          return this.getPageContent(url);
        }
        
        throw e;
      }
    });
  }

  // Update the submitForm method to use the new error handling
  async submitForm(url) {
    try {
      this.current_url = url;
      this.filename = this.extractFilename(url);
      const fileId = this.extractFileId(url);

      if (!fileId) {
        throw new Error("Invalid URL format - could not extract file ID");
      }

      const result = await this.retryWithExponentialBackoff(async () => {
        // ... rest of the submitForm implementation ...
        // (keeping the core logic the same, just wrapped in retry)
      });

      return result;
    } catch (e) {
      const errorInfo = e.classified || this.classifyError(e.status || 0, e.message);
      
      throw {
        error: 'Download failed',
        details: e.message,
        errorInfo: errorInfo,
        type: e.name,
        url: url,
        devMode: this.devMode,
        retryAttempts: this.retryCount
      };
    }
  }

  // ... rest of the methods remain the same ...
}

// Update the download API route handler
const apiRoutes = {
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
      
      const errorResponse = {
        error: 'Download failed',
        details: error.details || error.message,
        errorInfo: error.errorInfo,
        type: error.type,
        url: downloadUrl,
        devMode: devMode,
        retryAttempts: error.retryAttempts || 0,
        suggestion: error.errorInfo?.sslRelated ? 
          'Try enabling development mode to bypass SSL verification' : 
          'Please try again later'
      };
      
      return new Response(JSON.stringify(errorResponse), {
        status: error.errorInfo?.code || 502,
        headers: { 
          'Content-Type': 'application/json',
          'X-Error-Type': error.errorInfo?.type || 'download_failed',
          ...(devMode && { 'X-Dev-Mode': 'true' })
        }
      });
    }
  },
  // ... other routes remain the same ...
};

export { DownloadFormSubmitter };

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