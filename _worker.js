import { parseHTML } from 'linkedom';

class DownloadFormSubmitter {
  constructor(verbose = false, devMode = false) {
    this.verbose = verbose;
    this.devMode = devMode;
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
      // Add additional headers that might help with Cloudflare
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    };
    this.base_url = "https://downloadwella.com";
    this.current_url = null;
    this.filename = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.retryDelay = 2000;

    if (devMode) {
      this.log('warning', "Development mode enabled - SSL verification disabled");
    }
  }
  
  // Add logging method
  log(level, message) {
    if (!this.verbose) return;
    
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    switch (level.toLowerCase()) {
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      case 'warning':
        console.warn(`${prefix} ${message}`);
        break;
      case 'info':
        console.log(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
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

  async getFetchOptions(method = 'GET', body = null) {
    const options = {
      method,
      headers: { ...this.headers },
      redirect: 'follow'
    };

    if (body) {
      options.body = body;
    }

    if (this.devMode) {
      // Add comprehensive SSL bypass options
      options.cf = {
        ssl: false,
        cacheEverything: true,
        cacheTtl: 300,
        minify: {
          javascript: true,
          css: true,
          html: true
        }
      };
      options.insecure = true;
      options.rejectUnauthorized = false;
    }

    return options;
  }

  async getPageContent(url) {
    return this.retryWithExponentialBackoff(async () => {
      try {
        this.log('info', `Fetching page: ${url}`);
        if (!url.includes('downloadwella.com')) {
          this.log('info', `Found direct url: ${url}`);
          return url;
        }

        // Try fetching with proxy if in dev mode
        if (this.devMode) {
          try {
            // First try with CloudFlare proxy
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const proxyResponse = await fetch(proxyUrl);
            if (proxyResponse.ok) {
              return proxyResponse;
            }
          } catch (proxyError) {
            this.log('warning', `Proxy request failed: ${proxyError.message}`);
          }
        }

        const fetchOptions = await this.getFetchOptions();
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const error = new Error(`Request failed with status code ${response.status}`);
          error.status = response.status;
          throw error;
        }

        return response;
      } catch (e) {
        const errorInfo = this.classifyError(e.status || 0, e.message);
        
        if (errorInfo.sslRelated) {
          // Try alternative proxy if first attempt failed
          try {
            const corsProxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
            const proxyResponse = await fetch(corsProxyUrl);
            if (proxyResponse.ok) {
              return proxyResponse;
            }
          } catch (proxyError) {
            this.log('error', `All proxy attempts failed: ${proxyError.message}`);
          }
        }
        
        throw e;
      }
    });
  }

  async submitForm(url) {
    try {
      this.current_url = url;
      this.filename = this.extractFilename(url);
      const fileId = this.extractFileId(url);

      if (!fileId) {
        throw new Error("Invalid URL format - could not extract file ID");
      }

      const result = await this.retryWithExponentialBackoff(async () => {
        this.log('info', "Processing download page...");

        if (!url.includes('downloadwella.com')) {
          this.log('info', `Found direct url: ${url}`);
          return { url: url };
        }

        const initialResponse = await this.getPageContent(url);
        const [formData, formAction] = await this.extractFormData(initialResponse);

        if (!formData || !formAction) {
          throw new Error("Could not extract form data from page");
        }

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

        this.log('info', "Waiting for form submission...");
        await new Promise(resolve => setTimeout(resolve, 2000));

        const submitUrl = new URL(formAction || '', this.base_url).href;
        this.log('info', "Submitting form...");
        
        const fetchOptions = await this.getFetchOptions('POST', finalFormData.toString());
        const response = await fetch(submitUrl, fetchOptions);

        if (!response.ok) {
          throw new Error(`Form submission failed with status code: ${response.status}`);
        }

        const downloadUrl = response.url;
        if (!downloadUrl) {
          throw new Error("Download URL could not be extracted");
        }

        return {
          url: downloadUrl,
          filename: this.filename,
          file_id: fileId
        };
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

  
  extractFilename(url) {
    try {
      const parsedUrl = new URL(url);
      const pathName = decodeURIComponent(parsedUrl.pathname);
      const filename = pathName.split('/').pop();
      return filename.endsWith('.html') ? filename.slice(0, -5) : filename;
    } catch (e) {
      this.log('error', `Error extracting filename: ${e.message}`);
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
        this.log('info', `File ID: ${fileId}`);
        return fileId;
      }
      this.log('error', "Could not extract file ID from URL");
      return null;
    } catch (e) {
      this.log('error', `Error extracting file ID: ${e.message}`);
      return null;
    }
  }
  
  async extractFormData(response) {
    try {
      const html = await response.text();
      const formMatch = html.match(/<form[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/i);
      
      if (!formMatch) {
        this.log('warning', "No form found in page");
        return [null, null];
      }

      const actionUrl = formMatch[1];
      const formContent = formMatch[2];
      const formData = {};
      
      const inputRegex = /<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/g;
      let match;
      while ((match = inputRegex.exec(formContent)) !== null) {
        formData[match[1]] = match[2];
      }

      if (Object.keys(formData).length > 0) {
        return [formData, actionUrl];
      }

      this.log('warning', "No form data found in page");
      return [null, null];
    } catch (e) {
      this.log('error', `Error extracting form data: ${e.message}`);
      return [null, null];
    }
  }
}

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