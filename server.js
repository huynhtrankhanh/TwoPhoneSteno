const WebSocket = require('ws');
const sodium = require('libsodium-wrappers');
const readline = require('readline');
const http = require('http');
const fs = require('fs');
const htmlContent = fs.readFileSync('./index.html', 'utf8');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

(async () => {
  await sodium.ready;
  const serverKeys = sodium.crypto_kx_keypair();

  console.log('Server fingerprint:', sodium.to_base64(
    sodium.crypto_generichash(32, serverKeys.publicKey)
  ));

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(htmlContent);
  });

  const wss = new WebSocket.Server({ server });

  server.listen(8080, () => {
    console.log('HTTP server: http://localhost:8080');
    console.log('WebSocket server: ws://localhost:8080');
  });

  wss.on('connection', async (ws) => {
    let clientPublicKey, serverRx, decryptState;

    // Send server public key immediately
    ws.send(serverKeys.publicKey);

    ws.on('message', async (message) => {
      try {
        if (!clientPublicKey) {
          // Receive client public key
          clientPublicKey = new Uint8Array(message);
          console.log('Client fingerprint:', sodium.to_base64(
            sodium.crypto_generichash(32, clientPublicKey)
          ));

          // Derive shared keys
          const { sharedRx: rx, sharedTx: tx } = sodium.crypto_kx_server_session_keys(
            serverKeys.publicKey, serverKeys.privateKey, clientPublicKey
          );
          serverRx = rx;

          // Ask for connection confirmation
          const answer = await new Promise(resolve =>
            rl.question('Accept connection? (y/n) ', resolve)
          );

          if (answer.toLowerCase() !== 'y') {
            ws.close();
            return;
          }

          // Wait for encryption header
          ws.once('message', header => {
            decryptState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
              new Uint8Array(header), serverRx
            );

            // Handle encrypted messages
            ws.on('message', ciphertext => {
              try {
                const decrypted = sodium.crypto_secretstream_xchacha20poly1305_pull(
                  decryptState, new Uint8Array(ciphertext)
                );
                const event = JSON.parse(sodium.to_string(decrypted.message));
                console.log(`[${new Date().toISOString()}] ${event.half} ${event.letter} ${event.type}`);
              } catch (e) {
                console.error('Decryption error:', e);
                ws.close();
              }
            });
          });
        }
      } catch (e) {
        console.error('Connection error:', e);
        ws.close();
      }
    });
  });
})();
