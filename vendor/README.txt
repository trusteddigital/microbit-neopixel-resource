This folder is for manually-hosted third-party libraries.

If your browser blocks loading microbit-connection from a CDN (for example due to Tracking Prevention), download the UMD build and save it here as:

  vendor/microbit-connection.umd.js

Download URL (example):
https://unpkg.com/microbit-connection/dist/microbit-connection.umd.js

After saving the file, reload the app (http://localhost:8000). The app will try the CDN first and automatically fall back to this local copy if the CDN is blocked.
