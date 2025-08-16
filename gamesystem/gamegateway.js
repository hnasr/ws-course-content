//clients connect to the gateway
//gateway connects to the backends 


const backends = {
"game7443": {"url": "localhost:7443", "players": {}} ,
"game6443": {"url": "localhost:6443", "players": {}} ,
"game5443": {"url": "localhost:5443", "players": {}} ,
"game4443": {"url": "localhost:4443", "players": {}} 
}

 


// Always use HTTPS for upstreams
const targets = Object.values(backends).map(b =>
  new URL(`https://${b.url.replace(/^https?:\/\//, "")}`)
);


const https = require("https");
const fs = require("fs")
const WebSocketServer = require("websocket").server
const WebSocketClient = require("websocket").client


let rr = 0;
const pick = () => targets[(rr++) % targets.length];
const agent = new https.Agent({ keepAlive: true });


Object.keys(backends).forEach(b=> {
    const client = new WebSocketClient()
    client.connect( "wss://" + backends[b].url, null, null, null, {rejectUnauthorized: false })
    client.on("connect", connection =>  {
        backends[b].ws = connection
        connection.on("message", msg => {
        //get a message from backend b
        //need to find the players and loop on them

        msgObj = JSON.parse(msg.utf8Data)
        //if we get a join success from the server only send it to the user

        if (msgObj.cmd == "join" && msgObj.status == "ok") {
            backends[msgObj.game].players[msgObj.user].send(msg.utf8Data)
        }
        else
        {
            console.log("received from backend "+ b + msg.utf8Data)
        Object.keys(backends[msgObj.game].players).forEach(p=> {
                backends[msgObj.game].players[p].send(msg.utf8Data)
            })
        }
           
      
    })
    }) 
    
 }) 

const PORT = process.argv[2] || 8443;
let connection = null;

//create a raw https server (this will help us create the TCP which will then pass to the websocket to do the job)
const httpserver = https.createServer({
  key: fs.readFileSync( 'keys/server.key'),
  cert: fs.readFileSync('keys/server.crt')
}, (req, res) => {

  let t = pick();
  const headers = { ...req.headers, host: t.host };
  
  const url = new URL(req.url, `http://${req.headers.host}`);

  const gameId = url.searchParams.get("gameId"); // "123"
  if (gameId) 
     t = new URL(`https://${backends[gameId].url.replace(/^https?:\/\//, "")}`)
       

  const opts = {
    protocol: "https:",
    hostname: t.hostname,
    port: t.port,
    method: "GET",
    path: req.url,       // same path + query
    headers,
    agent,
    // For self-signed certs in dev, uncomment the next line:
     rejectUnauthorized: false,
  };

  https.request(opts, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  }).end(); // GET has no body

});

 //pass the httpserver object to the WebSocketServer 
 // library to do all the job, this class will override the req/res 
const websocket = new WebSocketServer({
    "httpServer": httpserver
})


httpserver.listen(PORT, () => console.log(`My server is SECURED listening on port ${PORT}`))


//when a legit websocket request comes listen to it and get the connection .. once you get a connection thats it! 
websocket.on("request", request=> {

    connection = request.accept(null, request.origin)
    connection.on("close", () => console.log("CLOSED!!!"))
    connection.on("message", message => {
        const msgObj = JSON.parse(message.utf8Data)
         if ( msgObj.cmd == "join") {
             //forward to the correct backend
             backends[msgObj.game].players[msgObj.user] = connection
         }

          backends[msgObj.game].ws.sendUTF (message.utf8Data)
        
    })


    

})
