var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var redis = require('redis');
var request = require('request');

var helper = require('../routes/helper');
format.extend(String.prototype);
// Initiating the redisClient
var redisClient = redis.createClient();
redisClient.on('error', function(msg) {
  console.error(msg);
});

function storeAppUsers() {
  var outlet_id = process.env.OUTLET_ID;
  var hq_url = process.env.HQ_URL;
  var URL = '/users/getAllUsers';
  // Getting the response from HQ
  request(hq_url + URL,
    function (error, response, body) {
    if (error || (response && response.statusCode != 200)) {
      console.error('{}: {} {}'.format(hq_url, error, body));
      return;
    }
    // Storing it in redis
    redisClient.set(helper.application_users_node,
              JSON.stringify(body),
              function(store_err, store_reply){
      if (store_err) {
        console.error('error while inserting in redis- {}'.format(store_err));
      }
      debug('successfully stored Application users');
    });
  });
}

module.exports = storeAppUsers;
