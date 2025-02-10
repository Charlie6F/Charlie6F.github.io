const express = require('express');
const cors = require('cors');
const { URL } = require('url');
const debug = require('debug');
const { DownloadFormSubmitter } = require('./direct_download_url_fetcher');
const logging = debug('orchestrator');

// Enable debug for orchestrator
debug.enable('orchestrator');

const app = express();
const HOSTNAME = '0.0.0.0';
const port = 1000;

// CORS configuration
const corsOptions = {
    origin: [
        'https://servers-5407.onrender.com',
        'https://nkiri.com', 
        'https://optimum-current-hawk.ngrok-free.app',
        'https://charlie6f.github.io',
        'http://localhost:8000',
        'http://localhost:8551',
        'http://bore.pub:8020',
        'http://bore.pub:7359',
        'https://ominous-space-fishstick-pjgvrxjqjwrjh9476-8080.app.github.dev',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204,
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
    exposedHeaders: ['ngrok-skip-browser-warning']
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Create a single instance of DownloadFormSubmitter to be reused
const downloader = new DownloadFormSubmitter(false, true);

app.get(['/', '/download'], async (req, res) => {
    const url = req.query.url;
    logging(`Received request for: ${url}`);
    
    if (!url) {
        return res.status(400).json({ error: 'Missing "url" parameter' });
    }

    try {
        new URL(url);
    } catch (error) {
        return res.status(400).json({ error: 'Invalid "url" parameter', message: error.message });
    }

    try {
        const result = await downloader.submitForm(url);
        if (result && result.url) {
            res.json({ url: result.url });
            logging(`Successfully processed URL and got a download url`);
        } else {
            res.status(500).json({ error: 'Failed to get direct download URL' });
            logging(`Failed to get direct download URL`);
        }
    } catch (error) {
        logging("Error processing request:", error);
        let errorMessage = "Internal server error";
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        res.status(500).json({ error: "Internal server error", message: errorMessage });
    }
});

// Start the express server
app.listen(port, HOSTNAME, (error) => {
    if (!error) {
        logging(`Server listening at http://${HOSTNAME}:${port}`);
    } else {
        logging(`Server error: ${error}`);
    }
});

// Handle process termination
process.on('SIGINT', () => {
    logging('Server shutting down...');
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    logging('Uncaught exception:', err);
    console.error('Uncaught exception:', err);
    process.exit(1);
});