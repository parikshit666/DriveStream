const { google } = require('googleapis');
const axios = require('axios');
const cliProgress = require('cli-progress');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HISTORY_FILE = 'download_history.csv';
const VIDEOS_FILE = 'videos.csv';

// 1. Load configuration from env.json
let config;
try {
    const configData = fs.readFileSync('env.json', 'utf8');
    config = JSON.parse(configData);
} catch (error) {
    console.error('Error: Could not find or read env.json. Please ensure it exists.');
    process.exit(1);
}

const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, REFRESH_TOKEN, FOLDER_ID, CONCURRENCY_LIMIT = 3, MAX_RETRIES = 3, RATE_LIMIT = '' } = config;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oauth2Client });
const multibar = new cliProgress.MultiBar({
    clearOnDone: false,
    hideCursor: true,
    format: '{bar} {percentage}% | {filename} | {status}'
}, cliProgress.Presets.shades_classic);

/**
 * Checks if a file exists in the target Google Drive folder.
 */
async function checkFileExists(fileName, folderId) {
    try {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        return res.data.files.length > 0;
    } catch (error) {
        console.error(`Error checking file existence for ${fileName}:`, error.message);
        return false;
    }
}

/**
 * Helper to retry a function with exponential backoff.
 */
async function withRetry(fn, maxRetries = MAX_RETRIES) {
    let lastError;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < maxRetries) {
                const delay = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

/**
 * Logs download status to history file.
 */
function logToHistory(url, fileName, fileSize, status) {
    const date = new Date().toISOString();
    const row = `"${date}","${url}","${fileName || ''}","${fileSize || 0}","${status}"\n`;
    if (!fs.existsSync(HISTORY_FILE)) {
        fs.writeFileSync(HISTORY_FILE, 'datetime,url,filename,filesize,status\n');
    }
    fs.appendFileSync(HISTORY_FILE, row);
}

/**
 * Removes a URL from videos.csv (Atomic-ish).
 */
function removeUrlFromCsv(urlToRemove) {
    try {
        if (!fs.existsSync(VIDEOS_FILE)) return;
        const csvContent = fs.readFileSync(VIDEOS_FILE, 'utf8');
        const lines = csvContent.split('\n');
        const header = lines[0];
        const remainingLines = lines.slice(1).filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            return trimmed.replace(/^"|"$/g, '') !== urlToRemove;
        });
        fs.writeFileSync(VIDEOS_FILE, [header, ...remainingLines].join('\n') + '\n');
    } catch (error) {
        console.error('Error updating videos.csv:', error.message);
    }
}

/**
 * Consolidated metadata retrieval using yt-dlp JSON dump.
 */
function getYtDlpMetadata(url, referer = url) {
    try {
        // Use -J for JSON dump, --flat-playlist to avoid expanding playlists, -f best for single file info
        const cmd = `yt-dlp --no-check-certificate --user-agent "${USER_AGENT}" --add-header "Referer:${referer}" -J -f "best" "${url}"`;
        const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const json = JSON.parse(output);
        return {
            title: json.title + (json.ext ? `.${json.ext}` : ''),
            size: json.filesize || json.filesize_approx || 0,
            url: json.url // Direct media URL if available
        };
    } catch (e) {
        return null;
    }
}

/**
 * Manual extraction fallback for proprietary players.
 */
async function extractVideoUrl(url) {
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': USER_AGENT, 'Referer': url },
            timeout: 15000
        });
        const html = response.data;

        // Patterns: HTML5, Data Attributes, JSON configs (including PlayerJS)
        const patterns = [
            /<(?:video|source)[^>]+src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm|mov)[^"']*)["']/i,
            /data-(?:src|video|url)=["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm|mov)[^"']*)["']/i,
            /["']?file["']?\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm|mov|m4v)[^"']*)["']/i,
            /["']?url["']?\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm|mov|m4v)[^"']*)["']/i,
            /["']?video_url["']?\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm|mov|m4v)[^"']*)["']/i,
            /["']?playlist["']?\s*:\s*\[\s*{\s*["']?file["']?\s*:\s*["'](https?:\/\/[^"']+)["']/i,
            /"config"\s*:\s*"(https?:\/\/player\.tnaflix\.com\/video\/config\.php\?[^"]+)"/i,
            /flashvars\s*=\s*{[^}]*config\s*:\s*"(https?:\/\/[^"]+)"/i
        ];

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
                let foundUrl = match[1].replace(/\\/g, '');
                if (foundUrl.includes('config.php')) {
                    const xmlRes = await axios.get(foundUrl, { headers: { 'User-Agent': USER_AGENT, 'Referer': url } });
                    const fileMatch = xmlRes.data.match(/<file[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/file>/i);
                    if (fileMatch) return fileMatch[1];
                }
                return foundUrl;
            }
        }
    } catch (e) {}
    return null;
}

/**
 * Checks if the refresh token is valid.
 * If not, prompts the user to generate a new one.
 */
async function validateToken() {
    try {
        const { token } = await oauth2Client.getAccessToken();
        if (!token) throw new Error('No access token returned');
        return true;
    } catch (error) {
        console.error('\n' + '='.repeat(50));
        console.error('AUTHENTICATION ERROR: Refresh token is invalid or expired.');
        console.error('='.repeat(50));
        console.log('\nPlease run the following command to re-authorize:');
        console.log('\x1b[33mnode setup-auth.js\x1b[0m');
        console.error('='.repeat(50) + '\n');

        process.exit(1);
    }
}

/**
 * Core download/upload logic.
 */
async function processUrl(url) {
    const rawUrl = url;
    url = url.replace(/&amp;/g, '&');
    const originalUrl = url;
    
    let fileName = path.basename(url.split('?')[0]) || 'downloading...';
    const bar = multibar.create(100, 0, { filename: fileName.substring(0, 20), status: 'Initializing' });

    try {
        await withRetry(async () => {
            let stream;
            let totalLength = 0;
            let targetUrl = url;

            // 1. Metadata & Extraction
            let metadata = getYtDlpMetadata(targetUrl);
            if (!metadata) {
                const extracted = await extractVideoUrl(url);
                if (extracted) {
                    targetUrl = extracted;
                    metadata = getYtDlpMetadata(targetUrl, originalUrl);
                }
            }

            if (metadata) {
                fileName = metadata.title;
                totalLength = metadata.size;
            } else {
                // For direct links, try to get filename from headers first
                try {
                    const head = await axios.head(targetUrl, { headers: { 'User-Agent': USER_AGENT, 'Referer': originalUrl }, timeout: 5000 });
                    const cd = head.headers['content-disposition'];
                    if (cd && cd.includes('filename=')) fileName = cd.split('filename=')[1].replace(/['"]/g, '');
                    totalLength = parseInt(head.headers['content-length']) || 0;
                } catch (e) {}
            }

            // 2. Duplicate Detection
            bar.update(0, { filename: fileName.substring(0, 20), status: 'Checking existence' });
            const exists = await checkFileExists(fileName, FOLDER_ID);
            if (exists) {
                bar.update(100, { status: 'Already Exists (Skipped)' });
                bar.stop();
                logToHistory(originalUrl, fileName, totalLength, 'SKIPPED (Duplicate)');
                removeUrlFromCsv(rawUrl);
                return;
            }

            // 3. Streaming & Uploading
            if (metadata) {
                bar.update(0, { status: 'Streaming' });

                const args = [
                    '--no-check-certificate', '--user-agent', USER_AGENT,
                    '--add-header', `Referer:${originalUrl}`,
                    '-f', 'best', '-o', '-', targetUrl
                ];
                if (RATE_LIMIT) args.push('--ratelimit', RATE_LIMIT);

                const ytDlpProcess = spawn('yt-dlp', args);
                stream = ytDlpProcess.stdout;
            } else {
                bar.update(0, { status: 'Fallback (Axios)' });
                const response = await axios({
                    url: targetUrl, method: 'GET', responseType: 'stream',
                    headers: { 'User-Agent': USER_AGENT, 'Referer': originalUrl }
                });
                stream = response.data;
                totalLength = parseInt(response.headers['content-length']) || totalLength;
            }

            if (totalLength) bar.setTotal(totalLength);

            let downloaded = 0;
            stream.on('data', (chunk) => {
                downloaded += chunk.length;
                bar.update(downloaded);
            });

            await drive.files.create({
                requestBody: { name: fileName, parents: [FOLDER_ID] },
                media: { body: stream },
                // Enable resumable uploads for better reliability with large files
                uploadType: 'resumable'
            });

            bar.update(totalLength || downloaded, { status: 'Success' });
            bar.stop();
            logToHistory(originalUrl, fileName, totalLength || downloaded, 'SUCCESS');
            removeUrlFromCsv(rawUrl);
        });

    } catch (error) {
        bar.update(0, { status: `Error: ${error.message.substring(0, 15)}` });
        bar.stop();
        logToHistory(originalUrl, fileName, 0, `FAILED: ${error.message}`);
    }
}

/**
 * Concurrent Worker Pool
 */
async function main() {
    try {
        await validateToken();
        if (!fs.existsSync(VIDEOS_FILE)) return console.error('videos.csv not found.');
        const csvContent = fs.readFileSync(VIDEOS_FILE, 'utf8');
        const lines = csvContent.split('\n');
        const firstLine = (lines[0] || '').toLowerCase().trim();
        const urls = lines.slice(firstLine.includes('url') ? 1 : 0)
            .map(l => l.trim().replace(/^"|"$/g, ''))
            .filter(l => l && l.startsWith('http'));

        console.log(`Starting processing for ${urls.length} URLs (Concurrency: ${CONCURRENCY_LIMIT})...\n`);

        const queue = [...urls];
        const workers = Array(Math.min(CONCURRENCY_LIMIT, queue.length)).fill(null).map(async () => {
            while (queue.length > 0) {
                const url = queue.shift();
                await processUrl(url);
            }
        });

        await Promise.all(workers);
        multibar.stop();
        console.log('\nAll tasks completed.');
    } catch (error) {
        console.error('Main error:', error.message);
    }
}

main();
