var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var redis = require('redis');
var requestretry = require('requestretry');

format.extend(String.prototype);

function storeItemIds() {
    var outlet_id = process.env.OUTLET_ID;
    var hq_url = process.env.HQ_URL;
    var PRICE_INFO = '/food_item/price_info/';
    // Getting the response from HQ
    requestretry({
            url: hq_url + PRICE_INFO + outlet_id,
            timeout: 2000,
            method: "GET",
        },
        function(error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(PRICE_INFO, error, body));
                return;
            }
            console.log('************************************************');
            //console.log('body', body);
            console.log('************************************************');
           // process.exit();
            var parsed_response = JSON.parse(body);
           
            parsed_response.map(function(item) {
                OUTLET_ITEM_IDS.push(item.id);
            });
            console.log('OUTLET_ITEM_IDS', OUTLET_ITEM_IDS);
        });
}

module.exports = storeItemIds;