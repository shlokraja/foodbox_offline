var debug = require('debug')('getfooditems:server');
var format = require('string-format');
var request = require('request');
//var firebase = require('firebase');
var helper = require('../routes/helper');
var redis = require('redis');
var async = require('async');
var FoodItemModel = require('../models/FoodItemModel');
// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });

redisClient.on('error', function(msg) {
    console.error(msg);
});


//function to fetch the data from HQ url and store the same in redis with hash object
/*
    Steps
    1. Try to connect to food items url (trying to connect the url 5 times with 5 sec delay)
    2. if we get connected then 
        2.1 Get the data and store it as a string
    3. if we may not get connected then return false
*/



function storeFoodItems() {
    // Posting it to HQ
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;
    var FOOD_ITEM_HQ_URL = hq_url + '/food_item/price_info/' + outlet_id;
    var food_items = [];
    var data = {};

    request(FOOD_ITEM_HQ_URL, { timeout: 30000 }, function(error, response, body) {

       

        if (error || (response && response.statusCode != 200)) {
            console.error('route storefooditems.js error in storing  the data from hq {}: {} {}'.format(FOOD_ITEM_HQ_URL, error, body));
            console.log('##############################');
            console.log('storeFoodItems js error in storing  the da  calledd response', error);
            console.log('##############################');
            return;
        } else {


            if (body !== "undefined" && body != null) {
                async.waterfall([
                        function(callback) {
                            try {
                                callback(error, JSON.parse(body));
                            } catch (err) {
                                callback(err, null);
                            }
                        },
                        function(data, callback) {
                            maindata = data;
                            if (typeof data == "sttring" && data != "") {
                                maindata = JSON.parse(data);
                            }
                            FoodItemModel.collection.drop();
                            var bulk = FoodItemModel.collection.initializeOrderedBulkOp();
                            for (var index = 0; index < data.length; index++) {
                                var element = maindata[index];
                                var query = {};
                                query.id = element.id;
                                bulk.find(query).upsert().updateOne(element);
                            }
                            bulk.execute(function(err, res) {
                                callback(error, res);
                            });
                        },
                        function(data, callback) {
                            redisClient.set(helper.outlet_menu_items, body, function(err, reply) {
                                callback(error, body)
                            });
                        },
                        function(foodbox_items, callback) {
                            if (typeof foodbox_items == "string") {
                                foodbox_items = JSON.parse(foodbox_items);
                            }
                            veg_non_veg_array = {};
                            foodbox_items.map(function(item, index) {
                                veg_non_veg_array[item.id] = item.veg
                            });
                            redisClient.set(helper.veg_nonveg_node, JSON.stringify(veg_non_veg_array), function(error, reply) {
                                callback(error, foodbox_items);
                            });
                        },
                        function(foodbox_items, callback) {
                            if (typeof foodbox_items == "string") {
                                foodbox_items = JSON.parse(foodbox_items);
                            }
                            map_master_id = {};
                            foodbox_items.map(function(item, index) {
                                map_master_id[item.id] = item.master_id;
                            });
                            redisClient.set(helper.map_master_id_node, JSON.stringify(map_master_id), function(error, reply) {
                                callback(error, foodbox_items);
                            });
                        },
                        //get expiry time with the callback 
                        function(foodbox_items, callback) {
                            if (typeof foodbox_items == "string") {
                                foodbox_items = JSON.parse(foodbox_items);
                            }
                            var parsed_response = foodbox_items;
                            for (var i = 0; i < parsed_response.length; i++) {
                                var food_item_id = parsed_response[i].id;
                                var expiry_time = parsed_response[i].expiry_time;
                                redisClient.hset(helper.expiry_time_node, food_item_id, expiry_time, function(err, reply) {
                                    callback(err, reply);
                                });
                            }

                        }
                    ],
                    function(error, reply) {
                        if (error) {
                            console.log('************************************************');
                            console.log('error', error);
                            console.log('************************************************');
                        }
                        console.log('************************************************');
                        console.log('reply', reply);
                        console.log('************************************************');

                    })

            }
        }
    });



}
module.exports = storeFoodItems;