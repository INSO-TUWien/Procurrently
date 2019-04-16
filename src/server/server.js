const net = require('net');

var others = [];

var socket = net.createServer();

socket.listen(3000,'localhost');

socket.on('connection', socket=>{
    socket.on('data',data=>{
        const peer = JSON.parse(data.toString());
        console.log(`${peer.userID} registered with port ${peer.port}`);
        socket.write(JSON.stringify(others));
        others.push(peer);
    })
});