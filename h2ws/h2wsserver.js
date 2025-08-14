// server-tls.js
const fs = require('fs');
const http2 = require('http2');
const {
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_PROTOCOL,
  HTTP2_HEADER_STATUS
} = http2.constants;

const OPC = { CONT:0x0, TEXT:0x1, BIN:0x2, CLOSE:0x8, PING:0x9, PONG:0xA };

function parseFrames(buffer, onFrame) {
  let off = 0;
  while (buffer.length - off >= 2) {
    const b0 = buffer[off];
    const b1 = buffer[off + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = off + 2;

    if (len === 126) {
      if (buffer.length - pos < 2) break;
      len = buffer.readUInt16BE(pos); pos += 2;
    } else if (len === 127) {
      if (buffer.length - pos < 8) break;
      const hi = buffer.readUInt32BE(pos);
      const lo = buffer.readUInt32BE(pos + 4);
      pos += 8;
      if (hi !== 0) throw new Error('Frame >4GB not supported in demo');
      len = lo >>> 0;
    }

    let maskKey;
    if (masked) {
      if (buffer.length - pos < 4) break;
      maskKey = buffer.subarray(pos, pos + 4); pos += 4;
    }

    if (buffer.length - pos < len) break;

    let payload = buffer.subarray(pos, pos + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }

    onFrame({ fin, opcode, payload });
    off = pos + len;
  }
  return buffer.subarray(off);
}

function buildFrame({ opcode, payload = Buffer.alloc(0), fin = true }) {
  const first = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  const len = payload.length;
  if (len < 126) {
    return Buffer.concat([Buffer.from([first, len]), payload]);
  } else if (len <= 0xffff) {
    const h = Buffer.alloc(4);
    h[0] = first; h[1] = 126; h.writeUInt16BE(len, 2);
    return Buffer.concat([h, payload]);
  } else {
    const h = Buffer.alloc(10);
    h[0] = first; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6);
    return Buffer.concat([h, payload]);
  }
}

const server = http2.createSecureServer({
  key: fs.readFileSync('keys/server.key'),
  cert: fs.readFileSync('keys/server.crt'),
  allowHTTP1: true,
  settings: { enableConnectProtocol: true }
});

server.on('stream', (stream, headers) => {
  const method = headers[HTTP2_HEADER_METHOD];
  const proto  = headers[HTTP2_HEADER_PROTOCOL];

  if (method === 'CONNECT' && proto === 'websocket') {
    stream.respond({ [HTTP2_HEADER_STATUS]: 200 });

    let leftover = Buffer.alloc(0);
    let textBuf = null; // accumulate TEXT/CONT fragments

    const send = (opcode, payload) => stream.write(buildFrame({ opcode, payload }));

    stream.on('data', (chunk) => {
      leftover = Buffer.concat([leftover, chunk]);
      try {
        leftover = parseFrames(leftover, ({ fin, opcode, payload }) => {
          switch (opcode) {
            case OPC.TEXT: {
              textBuf = textBuf ? Buffer.concat([textBuf, payload]) : payload;
              if (fin) {
                const msg = `From Server ${PORT} to client stream id ${stream.id} msg: ${textBuf.toString('utf8')}`
                console.log(`[client TEXT] ${msg} `);      // 👈 plain text from client
                send(OPC.TEXT, Buffer.from(msg, 'utf8')); // echo back
                textBuf = null;
              }
              break;
            }
            case OPC.CONT: {
              if (!textBuf) textBuf = Buffer.alloc(0);
              textBuf = Buffer.concat([textBuf, payload]);
              if (fin) {
                const msg = textBuf.toString('utf8');
                console.log(`[client TEXT] ${msg}`);      // 👈 plain text from client
                send(OPC.TEXT, Buffer.from(msg, 'utf8'));
                textBuf = null;
              }
              break;
            }
            case OPC.BIN:
              console.log(`[client BIN] ${payload.length} bytes`);
              send(OPC.BIN, payload); // optional echo
              break;
            case OPC.PING:
              send(OPC.PONG, payload);
              break;
            case OPC.CLOSE:
              stream.write(buildFrame({ opcode: OPC.CLOSE, payload }));
              stream.close();
              break;
            default:
              // ignore reserved/unknown
              break;
          }
        });
      } catch (e) {
        const code = Buffer.from([0x03, 0xEA]); // 1002
        const reason = Buffer.from('protocol error');
        stream.write(buildFrame({ opcode: OPC.CLOSE, payload: Buffer.concat([code, reason]) }));
        stream.close();
      }
    });
  } else {
    stream.respond({ [HTTP2_HEADER_STATUS]: 404 });
    stream.end('Not Found');
  }
});

const PORT = process.argv[2] || 7443;
console.log("using port " + PORT)
server.listen(PORT, () => {
  console.log(`HTTPS/2 server on https://localhost:${PORT} (RFC 8441) `);
});
