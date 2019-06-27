const net = require('net');

var others = [];

var serversocket = net.createServer();

serversocket.listen(3000);

serversocket.on('connection', socket => {
    socket.on('data', data => {
        const peer = JSON.parse(data.toString());
        console.log(`${peer.userID} registered with port ${peer.port}`);
        socket.write(JSON.stringify(others));
        others.push(peer);
        socket.destroy();
    });

    socket.on('close', (err) => {/* client closed... */ });
});