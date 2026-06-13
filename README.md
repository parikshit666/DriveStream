
# DriveStream

A robust Node.js script that automates the process of downloading videos from various platforms (YouTube, Vimeo, etc.) and direct URLs, then uploading them directly to a specific Google Drive folder.

## 🎬 Demo

https://github.com/user-attachments/assets/02ab1913-7c12-4a68-8af4-992f958ac8d6

## 🚀 Features

- **Bulk Processing**: Reads multiple URLs from a `videos.csv` file.
- **High Compatibility**: Uses `yt-dlp` to support hundreds of video sites.
- **Direct Streaming**: Streams content directly from the source to Google Drive.
- **Robust Reliability**: 
    - **Duplicate Detection**: Automatically skips files that already exist in the target Google Drive folder.
    - **Automatic Retries**: Retries failed downloads/uploads with exponential backoff.
    - **Resumable Uploads**: Uses Google Drive's resumable upload protocol for stable transfers of large files.
- **Performance Control**:
    - **Dynamic Concurrency**: Process multiple videos simultaneously (configurable).
    - **Bandwidth Throttling**: Optionally limit download speeds to preserve network bandwidth.
- **Progress Tracking**: Real-time terminal progress bars for each download/upload.
- **Secure Configuration**: Stores sensitive API credentials and folder IDs in a separate `env.json` file.

## 📋 Prerequisites

Before running the script, ensure you have the following installed:

1.  **Node.js** (v14 or higher)
2.  **npm** (Node Package Manager)
3.  **yt-dlp**: Must be installed and accessible in your system's PATH.
    - [yt-dlp Installation Guide](https://github.com/yt-dlp/yt-dlp#installation)
4.  **Google Cloud Project**: You need a project with the **Google Drive API** enabled and OAuth 2.0 credentials.

## 🛠️ Setup

### 1. Install Dependencies
Run the following command in the project directory:
```bash
npm install
```

### 2. Configure Credentials (`env.json`)
Create `env.json` in the root directory with your Google API details:
```json
{
  "CLIENT_ID": "your_client_id",
  "CLIENT_SECRET": "your_client_secret",
  "REDIRECT_URI": "https://developers.google.com/oauthplayground",
  "REFRESH_TOKEN": "",
  "FOLDER_ID": "your_google_drive_folder_id",
  "CONCURRENCY_LIMIT": 3,
  "MAX_RETRIES": 3,
  "RATE_LIMIT": "1M"
}
```
- **CONCURRENCY_LIMIT**: Number of simultaneous downloads (default: 3).
- **MAX_RETRIES**: Number of times to retry a failed download (default: 3).
- **RATE_LIMIT**: Bandwidth limit (e.g., "1M" for 1MB/s, "500K" for 500KB/s). Leave empty for no limit.

### 3. Generate Refresh Token
Run the interactive setup script to authorize the application and generate your refresh token automatically:
```bash
node setup-auth.js
```
Follow the on-screen prompts to:
1. Visit the generated URL.
2. Authorize the app with your Google account.
3. Paste the `code` from the redirect URL back into the terminal.

### 4. Prepare Input (`videos.csv`)
Add your video or file URLs to the `videos.csv` file under the `url` column:
```csv
url
https://www.youtube.com/watch?v=aqz-KE-bpKQ
https://vimeo.com/76979871
https://example.com/some-file.pdf
```

## 📂 Usage

To start the bulk extraction and upload process, run:
```bash
node app.js
```

## ⚙️ How It Works

1.  **Initialization**: The script loads your credentials from `env.json` and authenticates with Google Drive.
2.  **CSV Parsing**: It reads all URLs listed in `videos.csv`.
3.  **Metadata Extraction**: For each URL, it attempts to use `yt-dlp` to get the video title and file size.
4.  **Streaming**: 
    - It spawns a `yt-dlp` process to stream the video to `stdout`.
    - If `yt-dlp` fails (for non-video links), it falls back to `axios` to get a file stream.
5.  **Uploading**: The stream is piped directly to the Google Drive API's `files.create` method, targeted at your `FOLDER_ID`.
6.  **Progress**: The `cli-progress` bar updates in real-time as bytes are transferred.

## 💡 Pro-Tip: Extracting Direct URLs

If a direct URL from the browser's address bar doesn't work (e.g., for embedded players), you can use the [DownloadHelper](https://www.downloadhelper.net/) Chrome extension to extract the actual video source URL. Once the extension detects the video, copy the "Media Link" and add it to your `videos.csv`.

## ⚠️ Troubleshooting

- **"No supported JavaScript runtime found"**: Some YouTube extractions require a JS runtime (like Node.js or Deno) to be explicitly visible to `yt-dlp`. Usually, having Node.js in your PATH is enough.
- **"Refresh Token Expired"**: If the script fails with an authentication error, you may need to generate a new `REFRESH_TOKEN` via the Google OAuth 2.0 Playground.
- **"ffmpeg not found"**: `yt-dlp` uses `ffmpeg` to merge high-quality video/audio streams. While the script works without it, installing `ffmpeg` is recommended for the best video quality.
