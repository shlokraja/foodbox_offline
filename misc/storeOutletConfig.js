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

function storeOutletConfig() {
    var outlet_id = process.env.OUTLET_ID;
    var hq_url = process.env.HQ_URL;
    var OUTLET_CONFIG_URL = '/outlet/outlet_config/';
    // Getting the response from HQ
    request(hq_url + OUTLET_CONFIG_URL + outlet_id,
        function(error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                return;
            }

            try {
                configdata = JSON.parse(body);
                redisClient.set(helper.outlet_config_node,
                    body,
                    function(outlet_err, outlet_reply) {
                        if (outlet_err) {
                            console.error('error while inserting in redis- {}'.format(outlet_err));
                        }
                        debug('successfully stored outlet config');
                    });
            } catch (error) {
                // Storing it in redis
                console.log('************************************************');
                console.log('error,body', error, body);
                console.log('************************************************');
                //process.exit();
            }


        });
}

module.exports = storeOutletConfig;