require('colors');

const app = require('express')(),
    http = require('http').createServer(app),
    io = require('socket.io')(http),
    redis = require("redis"),
    redisClient = redis.createClient(),
    requestIp = require('request-ip');

function consoleLog(event, method, msg = undefined) {
    console.log(event.red + '.' + method.yellow + (msg !== undefined ? (' => ' + msg) : ''));
}

app.get('/', (req, res) => {
    res.sendFile(`${__dirname}/index.html`);
});

io.on('connect', (socket) => {

    socket.room = null;

    socket.on('join', (username, room) => {
        if(room === null) {
            socket.emit('disconnect');
        }
        socket.ip = requestIp.getClientIp(socket.request);
        socket.username = username;
        socket.room = room;
        socket.join(socket.room, (err, res) => {
            console.log(res);
            if(res) {
                consoleLog('chat', `[${socket.room}]`, `[${socket.username}]`.bold + ' join channel with IP ' + `${socket.ip}`.yellow);
            }
        });

        const json = JSON.stringify({username: socket.username});
        io.to(socket.room).emit('join', json);
        socket.emit('join', json);

        redisClient.lrange(`users:${socket.room}`, 0, 10, (err, res) => {
            for (let data of res) {
                const json = JSON.parse(data);
                socket.emit('get_users', json);
            }
        });

        redisClient.lrange(`messages:${socket.room}`, 0, 10, (err, res) => {
            for (let data of res.reverse()) {
                const json = JSON.parse(data);
                if(json.username === socket.username){
                    socket.emit('get_personnal_messages', json.message);
                } else {
                    socket.emit('get_messages', json);
                }
            }
        });

        const user = {username:socket.username, ip: socket.ip};
        redisClient.lpush(`users:${socket.room}`, JSON.stringify(user), (err, reply) => {
            console.log('redis lpush => ' + reply);
        });

        socket.emit('room', socket.room);
    });

    socket.on('message', (message) => {
        consoleLog('chat', 'message', `${message}`.yellow);
        const json = {username: socket.username, message: message};
        redisClient.lpush(`messages:${socket.room}`, JSON.stringify(json), (err, reply) => {
            console.log('redis lpush => ' + reply);
        });
        socket.emit('personnal_message', json.message);
        socket.to(socket.room).broadcast.emit('message', json);
    });

    socket.on('typing', function(){
        socket.to(socket.room).broadcast.emit('typing', socket.username);
    });

    socket.on('disconnect', () => {
        consoleLog('socket', 'disconnect', ('[' + socket.username + ']').bold + ' socket closed');
        if (socket.username !== undefined) {
            const json = {userdeco: socket.username};
            socket.to(socket.room).broadcast.emit('get_disconnect', json);
            redisClient.keys(`users:${socket.room}`, (err, users) => {
                if(users){
                    users.forEach(user => {
                        redisClient.del(user);
                    });
                }
            });
            socket.leave(socket.room);
            socket.room = null; socket.username = null;
        }
    });
});

http.listen(3000, () => console.log('Listening on ' + 'http://localhost:3000\n'.green));