const https = require("https");
const fs = require("fs")

const PORT = process.argv[2] || 7443;
const room1 = "room1_" + PORT
const room2 = "room2_" + PORT
const room3 = "room3_" + PORT
const rooms = [room1, room2, room3]

const chatters = {}
chatters[room1]= [] 
chatters[room2]= [] 
chatters[room3]= [] 

const users = {"user1": "con obj"}
const WebSocketServer = require("websocket").server
let connection = null;

//create a raw https server (this will help us create the TCP which will then pass to the websocket to do the job)
const httpserver = https.createServer({
  key: fs.readFileSync( 'keys/server.key'),
  cert: fs.readFileSync('keys/server.crt')
}, (req, res) => {

    if (req.url =='/' ) {
        res.writeHead(200);
        res.write(fs.readFileSync(__dirname + "/index.html"));
        res.end();
    }

    if (req.url =='/rooms' ) {
        res.setHeader("Content-Type", "application/json")
        res.writeHead(200);

        res.write(JSON.stringify(rooms))
        res.end();
    }
 
        
});

 //pass the httpserver object to the WebSocketServer 
 // library to do all the job, this class will override the req/res 
const websocket = new WebSocketServer({
    "httpServer": httpserver
})


httpserver.listen(PORT, () => console.log(`My server is SECURED listening on port ${PORT}`))


//when a legit websocket request comes listen to it and get the connection .. once you get a connection thats it! 

websocket.on("request", request=> {

    const connection = request.accept(null, request.origin)
    
    connection.on("message", message => {
        const msgObj = JSON.parse(message.utf8Data)
        //{"cmd": "chat", "room": room, "userId": user, "message": msg}
        if ( msgObj.cmd == "join") //join room request
        {
            //store the connection for this user
            users[msgObj.user] = connection;
            //update rooms
            chatters[msgObj.room].push(msgObj.user)
            connection.send(JSON.stringify({"cmd": "join", "status": "ok"} ) )
        }

         if ( msgObj.cmd == "chat") //chat to all users in the room 
        { 
            //for each user in the room 
            chatters[msgObj.room].forEach (u => users[u].send( JSON.stringify({"cmd": "chat", "room": msgObj.room, "user": msgObj.user, "message": msgObj.message} )))
            connection.send(JSON.stringify({"cmd": "chat", "status": "ok"} ) )
        }

     })


    

})
