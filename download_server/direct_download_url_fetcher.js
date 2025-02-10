 const axios = require('axios');
const { URL, URLSearchParams } = require('url');
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs'); // Node.js file system module
const util = require('util');
const logger = {
    info: (msg) => console.log(`INFO: ${msg}`),
    warning: (msg) => console.warn(`WARNING: ${msg}`),
    error: (msg) => console.error(`ERROR: ${msg}`),
};
const logging = require('debug')('download-server');

class DownloadFormSubmitter {
    constructor(verify_ssl = false, verbose = false) {
        this.verify_ssl = verify_ssl;
        this.verbose = verbose;

        if (!verify_ssl && verbose) {
           logger.warning("SSL verification disabled");
        }

        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive'
        };

        this.base_url = "https://downloadwella.com";
        this.current_url = null;
        this.filename = null;
    }

    extractFilename(url) {
        try {
            const parsedUrl = new URL(url);
            const pathName = decodeURIComponent(parsedUrl.pathname);
            const filename = path.basename(pathName);
            return filename.endsWith('.html') ? filename.slice(0, -5) : filename;
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

    async getPageContent(url) {
        try {
            if (this.verbose) {
                logger.info(`Fetching page: ${url}`);
            }
            if (!url.includes('downloadwella.com')) {
                logger.info('found direct url: ${url}')
                return url
            }    
            const response = await axios.get(url, {
                headers: this.headers,
                validateStatus: () => true, // Don't throw for non 2xx responses
                httpsAgent: this.verify_ssl ? undefined : new (require('https').Agent)({ rejectUnauthorized: false }), // bypass SSL verification
                timeout: 30000, // in milliseconds
                maxRedirects: 5 // Default is 5
            });

            if (response.status >= 200 && response.status < 300) {
              return response;
            } else {
               logger.error(`Page fetch failed with status code: ${response.status} - ${response.statusText}`)
               throw new Error(`Request failed with status code ${response.status}`);
            }
        } catch (e) {
             logger.error(`Page fetch failed: ${e.message}`);
            throw e;
        }
    }

    extractFormData(htmlContent) {
         try {
             const dom = new JSDOM(htmlContent);
             const document = dom.window.document;
             const form = document.querySelector('form');
             const formData = {};
             let actionUrl = null;

             if (form) {
               if(this.verbose){
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
                 if(Object.keys(formData).length > 0){
                   return [formData, actionUrl]
                 }
             }
             logger.warning("No form data found in page");
            return [null, null]
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
                 logger.info('found direct url: ${url}')
                 return {"url": url}
         }    
         const initialResponse = await this.getPageContent(url);
         const [formData, formAction] = this.extractFormData(initialResponse.data);

        const finalFormData = {
            op: 'download2',
            id: fileId,
            rand: '',
            referer: '',
            method_free: 'Free Download',
            method_premium: ''
        };

          if (formData) {
            Object.assign(finalFormData, formData);
        }
        if (!finalFormData.method_free) {
            finalFormData.method_free = 'Free Download';
        }

         this.headers['Origin'] = this.base_url;
         this.headers['Referer'] = url;
         this.headers['Content-Type'] = 'application/x-www-form-urlencoded';

         if (this.verbose) {
              logger.info("Waiting for form submission...");
         }
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

        const submitUrl = new URL(formAction || '', this.base_url).href;
         if (this.verbose) {
              logger.info("Submitting form...");
         }
        const response = await axios.post(
             submitUrl,
            new URLSearchParams(finalFormData).toString(),
            {
                headers: this.headers,
                validateStatus: () => true,
                httpsAgent: this.verify_ssl ? undefined : new (require('https').Agent)({ rejectUnauthorized: false }),
                timeout: 30000,
                maxRedirects: 5,
                responseType: 'stream' //  set responseType so axios returns a stream

            }
        );


         if (response.status >= 200 && response.status < 300) {

              // Check for content disposition header to extract the url
            const contentDisposition = response.headers['content-disposition'];
            let downloadUrl;

            if (contentDisposition) {
                 downloadUrl = response.request.res.responseUrl; // Get the final resolved URL
                  if (this.verbose) {
                       logger.info(`Download url found using content-disposition: ${downloadUrl}`);
                  }
            }
            else if(response.request.res.responseUrl){ //fallback if no content-disposition is set
                 downloadUrl = response.request.res.responseUrl
                 if (this.verbose) {
                      logger.warning(`Download url found with fallback: ${downloadUrl}`);
                 }
            }
            else{
                logger.error("Download URL could not be extracted");
                return null;
            }


            return {
                url: downloadUrl,
                filename: this.filename,
                file_id: fileId
           };

          } else {
              logger.error(`Form submission failed with status code: ${response.status} - ${response.statusText}`);
              return null;
          }

      } catch (e) {
        logger.error(`Request failed: ${e.message}`);
        throw e;
      }
  }
}

async function getDirectUrl(url, verbose = false) {
    try {
        const downloader = new DownloadFormSubmitter(false, verbose);
        const result = await downloader.submitForm(url);
        if (result) {
            return result.url;
        }
        return null;
    } catch (e) {
        logger.error(`Failed to get direct URL: ${e.message}`);
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
        console.log("Usage: node script.js <download_url>");
        process.exit(1);
    }

    const downloadUrl = args[0];
    try {
        logging(downloadUrl)
        const downloader = new DownloadFormSubmitter(false, true);
        const result = await downloader.submitForm(downloadUrl);

        if (result) {
            console.log("\nDownload Information:");
            console.log(`Filename: ${result.filename}`);
            console.log(`File ID: ${result.file_id}`);
            console.log(`\nDirect download URL:\n${result.url}`);
             return result
        } else {
            logger.error("Failed to get download URL");
            process.exit(1);
        }
    } catch (e) {
       logger.error(`Script failed: ${e.message}`);
        process.exit(1);
    }
}


if (require.main === module) {
    main();
}


module.exports = { getDirectUrl };