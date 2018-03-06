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

function storeFoodItemExpiry() {
  var outlet_id = process.env.OUTLET_ID;
  var hq_url = process.env.HQ_URL;
  var food_item_expiry_URL = '/food_item/expiry_times/';
  // Getting the response from HQ
  request(hq_url + food_item_expiry_URL + outlet_id,
    function (error, response, body) {
    if (error || (response && response.statusCode != 200)) {
      console.error('{}: {} {}'.format(hq_url, error, body));
      return;
    }
      redisClient.del("itemexpirydetails");
    // Storing it in redis
    redisClient.lpush("itemexpirydetails",
              body,
              function(err, reply){
                if (err) {
                  console.error('error while inserting in redis- {}'.format(err));
      }
      debug('successfully stored expiry Details');
      console.log('expiry------------',reply);
    });
  });
}

module.exports = storeFoodItemExpiry;
