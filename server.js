const WebSocket = require('ws');
const sodium = require('libsodium-wrappers');
const readline = require('readline');
const http = require('http');
const fs = require('fs');
const net = require('net');

const htmlContent = fs.readFileSync('./index.html', 'utf8');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Read Unix socket path from command line
const socketPath = process.argv[2];
if (!socketPath) {
    console.error('Please provide a Unix socket path as the first argument.');
    process.exit(1);
}

// Unix socket server setup
let unixSockets = [];
const unixServer = net.createServer(socket => {
    unixSockets.push(socket);
    socket.on('close', () => {
        unixSockets = unixSockets.filter(s => s !== socket);
    });
    socket.on('error', () => {
        unixSockets = unixSockets.filter(s => s !== socket);
    });
});
unixServer.listen(socketPath, () => {
    console.log(`Unix socket server listening on ${socketPath}`);
});

// Track pressed keys and current stroke
let pressedKeys = new Set();
let currentStroke = new Set();

function handleKeyEvent(letter, type, half) {
    const index = getStenoIndex(letter, half);
    if (type === 'press') {
        pressedKeys.add(index);
        currentStroke.add(index);
    } else {
        pressedKeys.delete(index);
    }

    if (pressedKeys.size === 0) {
        const bytes = generateTxBoltBytes(currentStroke);
        const buffer = Buffer.from(bytes);
        unixSockets.forEach(socket => {
            try {
                socket.write(buffer);
            } catch (e) {
                console.error('Error writing to Unix socket:', e);
            }
        });
        currentStroke.clear();
    }
}

function getStenoIndex(letter, half) {
    const isLeft = half === 'left';
    switch (letter) {
        case '#': return 22;
        case 'T': return isLeft ? 1 : 18;
        case 'P': return isLeft ? 3 : 14;
        case 'H': return 5;
        case 'S': return isLeft ? 0 : 19;
        case 'K': return 2;
        case 'W': return 4;
        case 'R': return isLeft ? 6 : 13;
        case 'A': return 7;
        case 'O': return 8;
        case '*': return 9;
        case 'F': return 12;
        case 'L': return 16;
        case 'D': return 20;
        case 'B': return 15;
        case 'G': return 17;
        case 'Z': return 21;
        case 'E': return 10;
        case 'U': return 11;
        default: throw new Error(`Unknown key: ${letter}`);
    }
}

function generateTxBoltBytes(currentStroke) {
    const bytes = [];
    for (let keySet = 0; keySet < 4; keySet++) {
        let byte = 0;
        const bitCount = keySet === 3 ? 5 : 6;
        for (let i = 0; i < bitCount; i++) {
            const index = keySet * 6 + i;
            if (currentStroke.has(index)) {
                byte |= 1 << i;
            }
        }
        if (byte !== 0) {
            byte |= keySet << 6;
            bytes.push(byte);
        }
    }
    return bytes;
}

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

        ws.send(serverKeys.publicKey);

        ws.on('message', async (message) => {
            try {
                if (!clientPublicKey) {
                    clientPublicKey = new Uint8Array(message);
                    console.log('Client fingerprint:', sodium.to_base64(
                        sodium.crypto_generichash(32, clientPublicKey)
                    ));

                    const { sharedRx: rx, sharedTx: tx } = sodium.crypto_kx_server_session_keys(
                        serverKeys.publicKey, serverKeys.privateKey, clientPublicKey
                    );
                    serverRx = rx;

                    let connectionAccepted = false;

                    rl.question('Accept connection? (y/n) ', answer => {
                        if (answer.toLowerCase() !== 'y') {
                            ws.close();
                        } else {
                            connectionAccepted = true;
                        }
                    });

                    ws.once('message', header => {
                        try {
                            decryptState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
                                new Uint8Array(header), serverRx
                            );
                        } catch (error) {
                            console.log(error);
                            return;
                        }

                        ws.on('message', ciphertext => {
                            try {
                                const decrypted = sodium.crypto_secretstream_xchacha20poly1305_pull(
                                    decryptState, new Uint8Array(ciphertext)
                                );
                                const event = JSON.parse(sodium.to_string(decrypted.message));
                                if (!connectionAccepted) {
                                    console.log("Event received but connection isn't accepted. Ignoring.");
                                    return;
                                }
                                handleKeyEvent(event.letter, event.type, event.half);
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
