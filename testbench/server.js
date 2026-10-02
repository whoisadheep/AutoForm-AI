/**
 * @file testbench/server.js
 * @description Local HTTP server for testing AutoForm AI on non-Google forms.
 * Serves the edge-case testbench at http://localhost:5000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const HTML_FILE = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
    fs.readFile(HTML_FILE, (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading testbench');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  AutoForm AI Universal Quiz Testbench Running!`);
    console.log(`  Open this URL in your browser: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
