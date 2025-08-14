const http = require("http");
const WebSocketServer = require("websocket").server
const PORT = 8080;
let connection = null;

//create a raw http server (this will help us create the TCP which will then pass to the websocket to do the job)
const httpserver = http.createServer((req, res) => {
 // Optional: serve a tiny page or 404 for normal HTTP
 res.writeHead(404);
 res.end('Use WebSocket upgrade');
});

 //pass the httpserver object to the WebSocketServer 
 // library to do all the job, this class will override the req/res 
const websocket = new WebSocketServer({
    "httpServer": httpserver
})


httpserver.listen(PORT, () => console.log(`My server is listening on port ${PORT}`))


//when a legit websocket request comes listen to it and get the connection .. once you get a connection thats it! 
websocket.on("request", request=> {

    connection = request.accept(null, request.origin)
    connection.on("close", () => console.log("CLOSED!!!"))
    connection.on("message", message => {

        console.log(`Received message ${message.utf8Data}`)
        connection.send(`Server ${PORT} responded to your message: ${message.utf8Data}`)
    })


    

})
