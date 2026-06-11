const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');
const cliProgress = require('cli-progress');

const CONFIG_FILE = 'env.json';

async function setupAuth() {
    // 1. Load config
    let config;
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (error) {
        console.error('Error: Could not read env.json');
        process.exit(1);
    }

    const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = config;
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

    console.log('\n' + '='.repeat(60));
    console.log('GOOGLE DRIVE API - AUTHENTICATION SETUP');
    console.log('='.repeat(60));

    // Progress bar for loading
    const progressBar = new cliProgress.SingleBar({
        format: 'Generating Auth URL | {bar} | {percentage}%',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    }, cliProgress.Presets.shades_classic);

    progressBar.start(100, 0);
    
    // Simulate loading for better UX
    for (let i = 0; i <= 100; i += 20) {
        progressBar.update(i);
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 2. Generate Auth URL
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive'],
        prompt: 'consent'
    });

    progressBar.stop();

    console.log('\n1. Visit this URL in your browser to authorize the app:');
    console.log('\x1b[36m%s\x1b[0m', authUrl);
    console.log('\n2. After authorizing, you will be redirected to a page.');
    console.log('   Copy the "code" parameter from the URL in your browser address bar.');
    console.log('   (e.g., ...?code=4/0Af...&scope=...)');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('\n3. Paste the authorization code here: ', async (code) => {
        try {
            // 3. Exchange code for tokens
            const { tokens } = await oauth2Client.getToken(code);
            
            if (tokens.refresh_token) {
                // 4. Update env.json
                config.REFRESH_TOKEN = tokens.refresh_token;
                fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
                
                console.log('\n' + '='.repeat(60));
                console.log('\x1b[32mSUCCESS!\x1b[0m Refresh token generated and saved to env.json.');
                console.log('You can now run "node app.js" to start your downloads.');
                console.log('='.repeat(60) + '\n');
            } else {
                console.error('\n\x1b[31mERROR:\x1b[0m No refresh token received.');
                console.log('Note: Refresh tokens are only sent the FIRST time you authorize.');
                console.log('Try going to https://myaccount.google.com/permissions, remove the app, and try again.');
            }
        } catch (error) {
            console.error('\n\x1b[31mERROR:\x1b[0m Failed to exchange code for token.');
            console.error(error.message);
        } finally {
            rl.close();
        }
    });
}

setupAuth();
