# Run the checker locally

Use a complete seal-check checkout at the [documented source revision](../evidence/sources.md), Python 3, and a browser with WebAssembly and cryptography support. Serve the repository root, which contains index.html and wasm/. Opening the HTML with a file URL does not provide the HTTP fetch environment the kernel expects.

Checker · Linux Bash · working directory: an empty parent directory. These checkout and pin commands were exercised for this guide:

```bash
git clone https://github.com/velvetmonkey/seal-check.git
cd seal-check
git checkout --detach a93003a1e4b2c536a52637f184e6a2cd26eb5bbf
```

Then, from that seal-check checkout:

```bash
python3 -m http.server 8763 --bind 127.0.0.1
```

Open `http://127.0.0.1:8763/` in that browser. This exact local server was used for the fresh demo walkthrough. Wait for the kernel status, then follow [your first receipt](your-first-receipt.md). Stop the server with Ctrl+C when finished.

If the kernel cannot load, check that the server root contains wasm/seal.wasm and that the browser can fetch it. Keep the entire checkout together; replacing a single kernel file can violate its pinned identity. Use HTTPS for a remotely hosted deployment or a browser-supported local origin for local testing.

The initial checkout and browser asset requests are distinct from receipt checking. Once delivered, the checker processes receipt contents locally. A served local page still depends on the checkout and browser you trust.

Previous: [Keys and safe sharing](keys-and-sharing.md).
Up: [Check receipts](README.md).
Next: [Receipt checking reference](reference/README.md).
