// direct_download_url_fetcher_web.js

const logger = {
    info: (msg) => console.log(`INFO: ${msg}`),
    warning: (msg) => console.warn(`WARNING: ${msg}`),
    error: (msg) => console.error(`ERROR: ${msg}`),
};

// --- Helper Functions ---

function createDom(htmlContent) {
    try {
      if (!htmlContent) {
          throw new Error("HTML content is empty or null.");
      }
      return new DOMParser().parseFromString(htmlContent, 'text/html');
    } catch (error) {
        logger.error(`Error creating DOM: ${error.message}`);
        return null;
    }
}

function extractFormData(document) {
    try {
        const form = document.querySelector('form');
        const formData = {};
        let actionUrl = null;

        if (form) {
            logger.info("Form found");
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

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Correct implementation, already in provided code.
function extractFilename(url) {
  try {
    const parsedUrl = new URL(url);
    const pathName = decodeURIComponent(parsedUrl.pathname);
    const filename = path.basename(pathName);
    return filename.endsWith('.html') ? filename.slice(0, -5) : filename;
  } catch (e) {
    logger.error(`Error extracting filename: ${e.message}`);
    return "downloaded_file"; // Default filename
  }
}

function extractFileId(url) {
  try {
      const parsedUrl = new URL(url);
      const pathName = parsedUrl.pathname;
      const match = pathName.match(/\/([a-zA-Z0-9]+)(?:\/|$)/);
      if (match) {
          return match[1];
      }
     logger.error("Could not extract file ID from URL");
      return null;
  } catch (e) {
      logger.error(`Error extracting file ID: ${e.message}`);
      return null;
  }
}

// --- Main Logic ---

async function getDirectUrl(inputUrl, verbose = false) {
    if (!isValidUrl(inputUrl)) {
        logger.error("Invalid URL provided.");
        return null;
    }

    const fileId = extractFileId(inputUrl);
    if (!fileId) {
      logger.error("Could not extract file ID from URL");
      return null;
    }
    const filename = extractFilename(inputUrl);


    const baseURL = "https://downloadwella.com";
    const corsProxy = "https://api.allorigins.win/raw?url=";

    try {
        let finalFormData = {
            op: 'download2',
            id: fileId,
            rand: '',
            referer: '',
            method_free: 'Free Download',
            method_premium: ''
        };

        // --- Fetch Initial Page (using CORS Proxy) ---
        // *CRITICAL*: Encode the inputUrl BEFORE appending it to the proxy.
        const initialPageResponse = await fetch(corsProxy + encodeURIComponent(inputUrl));

        if (!initialPageResponse.ok) {
            throw new Error(`Initial page fetch failed: ${initialPageResponse.status} ${initialPageResponse.statusText}`);
        }
        const initialPageText = await initialPageResponse.text();

        // --- Process Initial Page (Extract Form Data) ---
        const initialDocument = createDom(initialPageText);
        if(!initialDocument){
           throw new Error("Failed to parse initial page HTML");
        }
        const [formData, formAction] = extractFormData(initialDocument);

        if (formData) {
            Object.assign(finalFormData, formData);
        }

        // --- Construct Submit URL ---
        const submitUrl = new URL(formAction || '', baseURL).href;

        // --- Prepare Form Data for Submission ---
        const encodedFormData = new URLSearchParams(finalFormData).toString();

        // --- Submit Form (using CORS Proxy) ---
        // *CRITICAL*: Encode the submitUrl BEFORE appending it to the proxy.
        const submitResponse = await fetch(corsProxy + encodeURIComponent(submitUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                // No Origin or Referer headers when using a CORS proxy.
            },
            body: encodedFormData,
            redirect: 'follow', // This is crucial: follow redirects.
        });


        if (!submitResponse.ok) {
            //check for rate limit
            if(submitResponse.status === 429){
             throw new Error('Rate limit exceeded. Please try again later.');
            }
            else{
               throw new Error(`Form submission failed: ${submitResponse.status} ${submitResponse.statusText}`);
            }
        }
        const downloadUrl = submitResponse.url; // fetch API gives us the final URL

        if (!downloadUrl) {
          logger.error('Could not determine final download URL');
          return null;
        }

        return {
            url: downloadUrl,
            filename,
            file_id: fileId
        };

    } catch (error) {
        logger.error(`Error in getDirectUrl: ${error.message}`);
        return null;
    }
}

// --- UI Logic (Example) ---

async function handleFormSubmit(event) {
    event.preventDefault();
    const urlInput = document.getElementById('urlInput');
    const resultDiv = document.getElementById('result');
    const downloadLink = document.getElementById('downloadLink');
    const filenameSpan = document.getElementById('filename');
    const fileIdSpan = document.getElementById('fileId');

    resultDiv.style.display = 'none';
    downloadLink.href = '#';
    filenameSpan.textContent = '';
    fileIdSpan.textContent = '';

    const inputUrl = urlInput.value.trim();
    if (!inputUrl) {
        alert("Please enter a URL.");
        return;
    }
    const verbose = true; // Set verbose to true or false

    try {
        const result = await getDirectUrl(inputUrl, verbose);

        if (result && result.url) {
            downloadLink.href = result.url;
            filenameSpan.textContent = result.filename;
            fileIdSpan.textContent = result.file_id;
            resultDiv.style.display = 'block';
        } else {
            alert("Failed to get direct download URL.");
        }
    } catch (error) {
        alert(`An error occurred: ${error.message}`);
    }
}

window.getDirectUrl = getDirectUrl;