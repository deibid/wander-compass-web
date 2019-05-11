const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);


const geo = require('./geospace-analysis');
geo.attachIO(io);

const events = require('./events');


app.use(express.static(path.resolve(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(__dirname, '/index.html');
});


io.on('connection', (socket) => {
  console.log('User connected');

  geo.test();

  io.on('disconnected', (socket) => {
    console.log('User disconnected');
  });


  socket.on(events.NEW_LOCATION, (msg) => {

    //TODO> Pass the code to the backend
    console.log(`New location from phone ${JSON.stringify(msg, null, null)}`);
    geo.onNewLocation(msg);
    // geo.onNewLocation();
    // io.emit(EVENT_NEW_LOCATION, msg);
  });

});

http.listen(process.env.PORT || 3000, () => {
  console.log("Listening on port 3000...");
})


