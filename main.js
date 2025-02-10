const cors = require('cors');
const express = require('express');
const proxy = require('express-http-proxy');
const { spawn } = require('child_process');
const path = require('path');
const debug = require('debug');
const logging = debug('orchestrator');
// Enable debug for both orchestrator and download-server
debug.enable('orchestrator,download-server');

const secure= true
const app = express();
const HOSTNAME = '0.0.0.0';
const mainPort = 8080;

const serverPaths = {
    //secureProxyServer: path.join(__dirname, 'Image_Provider_Server', 'Secure_image_proxy_server.js'),
    //proxyServer: path.join(__dirname, 'Image_Provider_Server', 'proxy_server_images.js'),
    //appServer: path.join(__dirname, 'YouTube_Trailer_Server', 'app.js'),
    downloadServer: path.join(__dirname, 'download_server', 'server.js'),
};

const serverPorts = {
    secureProxyServer:8010,
    proxyServer: 8010,
    appServer: 5000,
    downloadServer: 8011,
};

const servers = {};

function startServer(name, scriptPath, port) {
    logging(`Starting ${name} on port ${port}...`);
    try {
        // Verify the file exists
        require.resolve(scriptPath);
        const serverProcess = spawn('node', [scriptPath]);
        
        serverProcess.stdout.on('data', (data) => {
            logging(`${name} stdout: ${data}`);
        });

        serverProcess.stderr.on('data', (data) => {
            logging(`${name} stderr: ${data}`);
            // Log actual error messages from the child process
            console.error(`${name} error:`, data.toString());
        });

        serverProcess.on('close', (code) => {
            logging(`${name} process exited with code ${code}`);
            delete servers[name];
        });

        serverProcess.on('error', (err) => {
            logging(`Failed to start ${name} process: ${err}`);
            console.error(`${name} spawn error:`, err);
        });

        servers[name] = serverProcess;
        logging(`${name} started successfully.`);
    } catch (error) {
        logging(`Failed to resolve script path for ${name}: ${error.message}`);
        console.error(`Failed to start ${name}:`, error);
    }
}

function stopServer(name) {
    if (servers[name]) {
        logging(`Stopping ${name}...`);
        servers[name].kill('SIGINT');
        delete servers[name];
        logging(`${name} stopped.`);
    } else {
        logging(`No server with name: ${name}`);
    }
}

function stopAllServers() {
    for (const name in servers) {
        stopServer(name);
    }
}

// Start all servers
//if (!secure)
    //startServer('proxyServer', serverPaths.proxyServer, serverPorts.proxyServer);
    
// if (secure)
    //startServer('secureProxyServer', serverPaths.secureProxyServer, serverPorts.secureProxyServer);
        
//startServer('appServer', serverPaths.appServer, serverPorts.appServer);
startServer('downloadServer', serverPaths.downloadServer, serverPorts.downloadServer);

// Update corsOptions to include bore.pub with port
const corsOptions = {
    origin: [
        'https://bore.pub',
        'http://bore.pub',
        /\.bore\.pub$/,  // This will allow any subdomain of bore.pub
        'https://nkiri.com', 
        'https://optimum-current-hawk.ngrok-free.app',
        'https://charlie6f.github.io',
        'http://localhost:8000',
        'http://localhost:8551',
        'http://bore.pub:8020',
        'http://bore.pub:7359',
        'https://ominous-space-fishstick-pjgvrxjqjwrjh9476-8080.app.github.dev',
        'http://bore.pub:8133',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204,
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
    exposedHeaders: ['ngrok-skip-browser-warning']
};

// CORS options
app.use(cors(corsOptions));

// Configure proxy routes
//if (!secure)
    //app.use('/image-proxy', proxy(`http://${HOSTNAME}:${serverPorts.proxyServer}`));
    
//if (secure)
    //app.use('/image-proxy', proxy(`http://${HOSTNAME}:${serverPorts.secureProxyServer}`));
    
// In main.js, update the proxy configurations:
//app.use(['/youtube-api'], proxy(`http://${HOSTNAME}:${serverPorts.appServer}`, {
    //proxyReqPathResolver: function (req) {
        //return '/search-route' + req.url;
    //},
    //proxyErrorHandler: function(err, res, next) {
        //logging('YouTube API Proxy Error:', err);
        //next(err);
    //}
//}));


app.use(['/','/download'], proxy(`http://${HOSTNAME}:${serverPorts.downloadServer}`,{
    proxyErrorHandler: function(err, res, next) {
        logging('Download Server Proxy Error:', err);
        next(err);
    }
}));

// Start the main express server to listen for request
app.listen(mainPort, HOSTNAME => {
    logging(`Main server listening on port ${mainPort}`);
});

// Handle process termination (e.g., Ctrl+C)
process.on('SIGINT', () => {
    logging('Orchestrator shutting down...');
    stopAllServers();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    logging('Uncaught exception:', err);
    stopAllServers();
    process.exit(1);
});
