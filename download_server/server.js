const express = require('express');
const cors = require('cors');
const { getDirectUrl } = require('./direct_download_url_fetcher');
const logging = require('debug')('download-server');
const app = express();
const port = 8011;
const HOSTNAME = '0.0.0.0';

// CORS configuration
const corsOptions = {
    origin: ['bore.pub', 'http://bore.pub:7359','http://bore.pub:8133', 'http://bore.pub:7259', 'http://localhost:8080', 'http://bore.pub:8020', 'https://nkiri.com', 'https://optimum-current-hawk.ngrok-free.app', 'https://charlie6f.github.io', 'http://localhost:8000','https://ominous-space-fishstick-pjgvrxjqjwrjh9476-8080.app.github.dev','https://ominous-space-fishstick-pjgvrxjqjwrjh9476-9564.app.github.dev',],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204,
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
    exposedHeaders: ['ngrok-skip-browser-warning']
};

// Apply CORS middleware
app.use(cors(corsOptions));

app.get(['/','/download'], async (req, res) => {
    const url = req.query.url;
    logging(`Received request for: ${url}`)
    if (!url) {
        return res.status(400).json({ error: 'Missing "url" parameter' });
    }

    try {
        new URL(url);
    } catch (error) {
        return res.status(400).json({ error: 'Invalid "url" parameter', message: error.message });
    }

    try {
        const directUrl = await getDirectUrl(url, true);
        if (directUrl) {
            res.json({ url: directUrl });
            logging(`Successfully processed URL and got a download url`)
        } else {
            res.status(500).json({ error: 'Failed to get direct download URL' });
            logging(`Failed to get direct download URL`)
        }
    } catch (error) {
        logging("Error processing request:", error);
        let errorMessage = "Internal server error";
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        res.status(500).json({ error: "Internal server error", message: errorMessage })
    }
});

app.listen(port, HOSTNAME, (error) => {
    if (!error)
        logging(`Server listening at http://${HOSTNAME}:${port}`);
    else
        logging(`Server.js error: ${error}`);
        
});        
