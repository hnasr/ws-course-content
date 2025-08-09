// client-tls.js
const fs = require('fs');
const http2 = require('http2');
const {
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_PROTOCOL,
  HTTP2_HEADER_STATUS
} = http2.constants;

// Connect to secure HTTP/2 server
const client = http2.connect('https://localhost:8443', {
  ca: fs.readFileSync('server.crt'),          // trust our self-signed cert
  settings: { enableConnectProtocol: true }   // allow :protocol = websocket
});

client.on('connect', () => {
  const headers = {
    [HTTP2_HEADER_METHOD]: 'CONNECT',
    [HTTP2_HEADER_PROTOCOL]: 'websocket'
  };

  const stream = client.request(headers);
  console.log('Connecting via extended CONNECT...');

  stream.on('response', (headers) => {
    const status = headers[HTTP2_HEADER_STATUS];
    if (status !== 200) {
      console.error(`CONNECT failed with status ${status}`);
      client.close();
      return;
    }
    console.log('Extended CONNECT established!');

    // ---- Minimal text frame send/receive ----
    const OPCODES = { TEXT:0x1, CLOSE:0x8 };

    function buildFrame(opcode, payload) {
      const first = 0x80 | opcode; // FIN=1
      const len = payload.length;
      const head = (len < 126) ? Buffer.from([first, len | 0x80]) :
                   (() => { throw new Error('Demo: short payloads only'); })();
      const mask = Buffer.from([1, 2, 3, 4]); // static mask for demo
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = payload[i]// ^ mask[i & 3];
      return Buffer.concat([head, mask, masked]);
    }

    stream.on('data', (chunk) => {
      // For demo: assuming server sends single small TEXT frames
      const opcode = chunk[0] & 0x0f;
      const length = chunk[1] & 0x7f;
      const payload = chunk.subarray(2, 2 + length);
      console.log('Server says:', payload.toString());
    });

    // Send "Hello over TLS h2 WS" as TEXT frame
    stream.write(buildFrame(OPCODES.TEXT, Buffer.from('Hello over TLS h2 WS')));

    // Close after a second
    setTimeout(() => {
      stream.write(buildFrame(OPCODES.CLOSE, Buffer.alloc(0)));
      stream.close();
      client.close();
    }, 1000);
  });
});

client.on('error', (err) => console.error('Client error:', err));
