// server-h1.js
const http = require('http');
const crypto = require('crypto');

/* ------The WebSockets Frame -----

0                   1                   2                   3
     0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
    +-+-+-+-+-------+-+-------------+-------------------------------+
    |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
    |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
    |N|V|V|V|       |S|             |   (if payload len==126/127)   |
    | |1|2|3|       |K|             |                               |
    +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
    |     Extended payload length continued, if payload len == 127  |
    + - - - - - - - - - - - - - - - +-------------------------------+
    |                               |Masking-key, if MASK set to 1  |
    +-------------------------------+-------------------------------+
    | Masking-key (continued)       |          Payload Data         |
    +-------------------------------- - - - - - - - - - - - - - - - +
    :                     Payload Data continued ...                :
    + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
    |                     Payload Data continued ...                |
    +---------------------------------------------------------------+

*/

//the websockets opcodes
const OPC = { CONT:0x0, TEXT:0x1, BIN:0x2, CLOSE:0x8, PING:0x9, PONG:0xA };

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

//large buffer may have one or more websocket frames
function parseFrames(buffer, onFrame) {
 let off = 0; //offset
 
 //we loop through the buffer data arrived and capture frames 
 //one "Read" can give us tons of frames

 while (buffer.length - off >= 2) {
   const b0 = buffer[off]; //get the first byte
   const b1 = buffer[off + 1]; //get the second byte
   const fin = (b0 & 0x80) !== 0; //the fin bit is the first bit     (1000,0000)
   const opcode = b0 & 0x0f;     //the opcodes are the last 4 bits   (0000,1111)
   const masked = (b1 & 0x80) !== 0; //the mask bit is the first bit (1000,0000)
   let len = b1 & 0x7f;             //the length is the last 7 bits  (0111,1111)


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
   if (masked) { //mask key is 4 bytes
     if (buffer.length - pos < 4) break; 
     maskKey = buffer.subarray(pos, pos + 4); pos += 4;
   }

   //get the payload
   if (buffer.length - pos < len) break; // incomplete payload
   let payload = buffer.subarray(pos, pos + len);

   if (masked) {
     const out = Buffer.allocUnsafe(len);
     for (let i = 0; i < len; i++) 
        out[i] = payload[i] ^ maskKey[i % 4]; 

     payload = out;
   }

   //found a full frame, trigger the function
   const frame = { "fin": fin, "opcode": opcode, "payload": payload }
   onFrame(frame);

   //move to the last bit of the buffer and continue reading, there may be more frames....
   off = pos + len;
 }

 //of course we may get half of a frame so lefovers are important..

 return buffer.subarray(off); // leftover bytes (partial frame)
}

//building a frame so we can send it to the client
function buildFrame({ opcode, payload = Buffer.alloc(0), fin = true }) 
{
 const first = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
 const len = payload.length;
 if (len < 126) {
   return Buffer.concat([Buffer.from([first, len]), payload]); // server frames unmasked
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


// ---- HTTP/1.1 server with WS Upgrade ----
const server = http.createServer((req, res) => {
 // Optional: serve a tiny page or 404 for normal HTTP
 res.writeHead(404);
 res.end('Use WebSocket upgrade');
});

server.on('upgrade', (req, socket, head) => {
 // Basic handshake checks
 const upgrade = (req.wsheaders.upgrade || '').toLowerCase();
 const connection = (req.headers.connection || '').toLowerCase();
 const key = req.headers['sec-websocket-key'];
 const version = req.headers['sec-websocket-version'];
 const ok =
   upgrade === 'websocket' &&
   connection.split(/,\s*/).includes('upgrade') &&
   key && version === '13';
 if (!ok) {
    //raw tcp socket
   socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
   socket.destroy();
   return;
 }
 // Compute Sec-WebSocket-Accept
 const accept = crypto
   .createHash('sha1')
   .update(key + WS_GUID)
   .digest('base64');
 // Complete the upgrade
 const responseHeaders = [
   'HTTP/1.1 101 Switching Protocols',
   'Upgrade: websocket',
   'Connection: Upgrade',
   `Sec-WebSocket-Accept: ${accept}`,
   '\r\n'
 ];
 socket.write(responseHeaders.join('\r\n'));
 socket.setNoDelay(true);
 // If there were leftover bytes from the HTTP parser (head), prepend them
 let leftover = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
 let textBuf = null;

 //declare send function
 const send = (opcode, payload) => socket.write(buildFrame({ "opcode": opcode, "payload": payload }));

 const onFrame = (wsframe) => {
 
       
       switch (wsframe.opcode) {

         case OPC.TEXT: {
           textBuf = textBuf ? Buffer.concat([textBuf, wsframe.payload]) : wsframe.payload;
           if (wsframe.fin) {
             const msg = textBuf.toString('utf8');
             console.log(`[client TEXT] ${msg}`);      // 👈 plain text received
             send(OPC.TEXT, Buffer.from(msg, 'utf8')); // echo back
             textBuf = null;
           }
           break;
         }
         case OPC.CONT: {
           if (!textBuf) textBuf = Buffer.alloc(0);
           textBuf = Buffer.concat([textBuf, wsframe.payload]);
           if (fin) {
             const msg = textBuf.toString('utf8');
             console.log(`[client TEXT] ${msg}`);
             send(OPC.TEXT, Buffer.from(msg, 'utf8'));
             textBuf = null;
           }
           break;
         }
         case OPC.BIN:
           console.log(`[client BIN] ${wsframe.payload.length} bytes`);
           send(OPC.BIN, wsframe.payload); // optional echo
           break;
         case OPC.PING:
           send(OPC.PONG, wsframe.payload);
           break;
         case OPC.CLOSE:
           // Echo CLOSE and end TCP socket
           socket.write(buildFrame({ "opcode": OPC.CLOSE, "payload": wsframe.payload }));
           socket.end();
           break;
         default:
           // ignore reserved/unknown
           break;
       }
     }

 //when we read a chunk
 const onBytes = (chunk) => { 

   //whatever we had of leftover concat it, could be partial frame
   leftover = Buffer.concat([leftover, chunk]);
   
   try {
     leftover = parseFrames(leftover, onFrame);
   } catch (e) {
     // Protocol error → 1002 and close
     const code = Buffer.from([0x03, 0xEA]); // 1002
     const reason = Buffer.from('protocol error');
     socket.write(buildFrame({ "opcode": OPC.CLOSE, "payload": Buffer.concat([code, reason]) }));
     socket.end();
   }
 };

 if (leftover.length) onBytes(Buffer.alloc(0)); // process initial leftover if any

 //this will call socket read and give us a bunch of bytes
 //we will need to parse them to find "websocket Frames"
//read system call 
 socket.on('data', onBytes);
 socket.on('end',  () => socket.end());
 socket.on('error', () => socket.destroy());
});


const PORT = 8080;
server.listen(PORT, () => {
 console.log(`HTTP/1.1 WS server on ws://localhost:${PORT}`);
});