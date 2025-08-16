const https = require("https");
const fs = require("fs")

const PORT = process.argv[2] || 7443;
const gameId = "game" + PORT
const gameState = {}
gameState[gameId] = {
    "items": [{
        "item": "tv",
        "url": "tv.png",
        "hp": 100,
        "user":""
    },
    {
        "item": "table",
        "url": "table.png",
         "hp": 100,
        "user":""
    },
    {
        "item": "chair",
        "url": "chair.png",
         "hp": 100,
        "user":""
    } 
    ], 
    "players": []
} 

 

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
        
        const ind = fs.readFileSync(__dirname + "/index.html").toString()
        
        res.write(ind.replace("thegameid", gameId));
        res.end();
    }

    if (req.url =='/reset' ) {
        
        //reset game state
        //best is to close all websockets connections (this is tmp)
        gameState[gameId].players=[]
        gameState[gameId].items.forEach (i => i.hp=100)
        Object.keys(users).forEach (k => users[k]= null) 

        res.writeHead(302, { Location: "/" });
        res.end(); 
    }

     if (req.url =='/chair.png' || req.url =='/tv.png' || req.url =='/table.png'  ) {
        res.writeHead(200);
        res.write(fs.readFileSync(__dirname + req.url));
        res.end();
    }

    if (req.url.includes("/items") ) {
        res.setHeader("Content-Type", "application/json")
        res.writeHead(200);

        res.write(JSON.stringify(gameState[gameId]))
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
    console.log("accepted a connection")
    connection.on("message", message => {
        console.log(message)
        const msgObj = JSON.parse(message.utf8Data)
        //{"cmd": "chat", "room": room, "userId": user, "message": msg}
        if ( msgObj.cmd == "join") //join game request
        {   
            //store the connection for this user
            if (users[msgObj.user]) //can't join , in use.. 
            {                
               connection.send(JSON.stringify({"cmd": "join", "status": `fail, color ${msgObj.user} in use`, "user": msgObj.user,"game": msgObj.game} ) )
               return;
            }
            
            //join..
            users[msgObj.user] = connection;
            //update game
            gameState[gameId].players.push(msgObj.user)
            //send to everyone that someone joined
            gameState[gameId].players.forEach (u => users[u].send( JSON.stringify({"cmd": "join", "game": msgObj.game, "user": msgObj.user, "players": gameState[gameId].players} )))
            connection.send(JSON.stringify({"cmd": "join", "status": "ok", "user": msgObj.user,"game": msgObj.game} ) )

           
        }

         if ( msgObj.cmd == "hit") //hit an item.
        { 
            //player has hit an item.. 
            //for each player in the game, send new state
            //get item 
            const theItem =  gameState[gameId].items.filter(i => i.item === msgObj.item)[0];
            theItem.hp-= 10; //watch for serilization 
            if (theItem.hp <= 0) {
                theItem.hp=0;
                theItem.user=  msgObj.user //the winner
            }
            gameState[gameId].players.forEach (u => users[u].send( JSON.stringify({"cmd": "hit", "game": msgObj.game, "user": msgObj.user, "item": msgObj.item, "hp": theItem.hp} )))
            connection.send(JSON.stringify({"cmd": "hit","game":msgObj.game,  "status": "ok"} ) )
        }

     })


    

})
