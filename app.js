var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var cors = require('cors');
var debug = require('debug')('outlet_app:server');
var routes = require('./routes/index');
var menu_display = require('./routes/menu_display');
var order_app = require('./routes/order_app');
var plcio = require('./routes/plcio');
var outlet_app = require('./routes/outlet_app');
var beverage_orders = require('./routes/beverage_orders');
var users = require('./routes/users');
var mongoose = require('mongoose');


var app = express();

app.engine('hjs', require('hogan-express'));
if (app.get('env') === 'production') {
    app.enable('view cache');
}
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hjs');

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(logger('[:date[web]] ":method :url HTTP/:http-version" :status'));

// Enabling cors for all origins
app.use(cors());

// to remove 304 not modified
app.get('/*', function(req, res, next) {
    res.setHeader('Last-Modified', (new Date()).toUTCString());
    next();
});
// Setting up the routes here
app.use('/', routes);
app.use('/menu_display', menu_display);
app.use('/order_app', order_app);
app.use('/plcio', plcio);
app.use('/outlet_app', outlet_app);
app.use('/beverage_orders', beverage_orders);
app.use('/users', users);
// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});
global.loggedinuserid = 0;

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});


process.on("uncaughtException", function(err) {
    // handle the error safely 
    debug(err);
    console.log("Process Error : ${err}", err);
    //process.exit();
});


var isConnectedBefore = false;

mongoose.Promise = global.Promise;
//Set u
//Set up default mongoose connection

var connect = function () {
    try {
        mongoose.connect('mongodb://localhost:27017/freshlyDB', {
            reconnectTries: 10, // Never stop trying to reconnect
            reconnectInterval: 500, // Reconnect every 500ms
            useMongoClient: true,
        },function (error) {
            // Check error in initial connection. There is no 2nd param to the callback.
            console.log('************************************************');
            console.log('error in connection with mongodb plz check',error);
            console.log('************************************************');
            
        });
    } catch (err) {
        mongoose.createConnection('mongodb://localhost:27017/freshlyDB', {
            reconnectTries: 10, // Never stop trying to reconnect
            reconnectInterval: 500, // Reconnect every 500ms
            useMongoClient: true,
        }, function (error) {
            // Check error in initial connection. There is no 2nd param to the callback.
            console.log('************************************************');
            console.log('error in connection with mongodb plz check', error);
            console.log('************************************************');
        });
    }
};

connect();

//Get the default connection
var db = mongoose.connection;

db.on('disconnected', function () {
    console.log('Lost MongoDB connection...');
    db.close();
    if (!isConnectedBefore)
        connect();
});

db.on('reconnected', function () {
    console.log('MongoDB reconnected!');
});

//Bind connection to error event (to get notification of connection errors)
//db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.on('connected', function () {
    isConnectedBefore = true;
    console.log('Connection established to MongoDB');
});

db.on('error', function (error) {
    console.error('Error in MongoDb connection: ' , error);
    mongoose.disconnect();
    db.close();
});

db.on('close', function (error) {
   console.log('************************************************');
   console.log('database close',error);
   console.log('************************************************');
});

module.exports = app;
