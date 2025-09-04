const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let clients = {}; // { socketId: { balance, seconds } }

io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Assign initial balance (example: Rs 30 = 3 minutes)
    clients[socket.id] = { balance: 30, seconds: 0 }; 

    socket.emit("init", clients[socket.id]);

    // Every second, increase timer
    let interval = setInterval(() => {
        if (!clients[socket.id]) return;
        clients[socket.id].seconds++;

        // Every 60 sec, deduct Rs 10
        if (clients[socket.id].seconds % 60 === 0) {
            clients[socket.id].balance -= 10;
        }

        // Update client
        socket.emit("timer", clients[socket.id]);

        // Stop chat if balance 0
        if (clients[socket.id].balance <= 0) {
            socket.emit("chat_end", { reason: "Balance exhausted" });
            clearInterval(interval);
            socket.disconnect(true);
            delete clients[socket.id];
        }
    }, 1000);

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
        clearInterval(interval);
        delete clients[socket.id];
    });
});

server.listen(3000, () => console.log("Server running on http://localhost:3000"));