var redis = require('redis');
var format = require('string-format');
var request = require('request');
var requestretry = require('requestretry');
var express = require('express');
var helper = require('../routes/helper');
var async = require('async');
var debug = require('debug')('staffroaster_function:server');
var internetAvailable = require("internet-available"); /* peerbits, rajesh end*/
format.extend(String.prototype);


// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function(msg) {
    console.error(msg);
});


//fetch all the staff roaster details which are not there on the HQ
// send them to HQ 
// Fetch ans set the staff roaster details in redis


function getStaffroasterdetails() {

    console.log('##############################');
    console.log('staff roaster details called');
    console.log('##############################');
    internetAvailable({
            timeout: 1000,
            retries: 3,
        })
        .then(function() {
            //var STAFF_ROSTER_URL = '/outlet/staff_roster/' + process.env.OUTLET_ID;
            var STAFF_ROSTER_URL = '/outlet/staff_roster_offline/' + process.env.OUTLET_ID;
            async.waterfall([
                //getting food items
                function(callback) {
                    var hq_url = process.env.HQ_URL;
                    var GET_FOOD_ITEM_LIST_URL = '/outlet/food_item_list/';
                    var outlet_id = process.env.OUTLET_ID;
                    request(hq_url + GET_FOOD_ITEM_LIST_URL + outlet_id, { maxAttempts: 5 },
                        function(error, response, body) {
                            if (error || (response && response.statusCode != 200)) {
                                callback('{}: {} {}'.format(hq_url, error, body), null);
                                return;
                            }
                            redisClient.set(helper.food_item_list_node, body, function(error, reply) {
                                if (error) {
                                    console.log('##############################');
                                    console.log('error', error);
                                    console.log('##############################');
                                }
                                callback(null, JSON.parse(body));
                                return;
                            });
                        });
                },
                //getting non fooditems
                function(data, callback) {
                    var hq_url = process.env.HQ_URL;
                    var GET_NON_FOOD_TYPES_URL = '/outlet/non_food_types';
                    request(hq_url + GET_NON_FOOD_TYPES_URL, { maxAttempts: 5 },
                        function(error, response, body) {
                            if (error || (response && response.statusCode != 200)) {
                                callback('{}: {} {}'.format(hq_url, error, body), null);
                                redisClient.get(helper.non_food_item_list_node, function(error, reply) {
                                    if (reply == null) {
                                        reply = "{}";
                                    }
                                    callback(null, JSON.parse(reply));
                                });
                                return;
                            }
                            redisClient.set(helper.non_food_item_list_node, body, function(error, reply) {
                                if (error) {
                                    console.log('##############################');
                                    console.log('error', error);
                                    console.log('##############################');
                                }
                                callback(null, body);
                                return;
                            });
                        });
                },
                // function to get all the details from redis which are not Send to HQ
                function(data, callback) {
                    console.log('##############################');
                    console.log('function  1');
                    console.log('##############################');

                    redisClient.get(helper.staff_roaster_node, function(err, reply) {
                        if (reply != null) {
                            alldetails = JSON.parse(reply);
                            var len = alldetails.length;
                            data_to_send = [];
                            console.log('##############################');
                            console.log('alldetails', alldetails);
                            console.log('##############################');
                            // return;
                            for (i = 0; i < len; i++) {
                                if (!alldetails[i].is_set_on_HQ) {
                                    var data = {};
                                    data.user_id = alldetails[i].id;
                                    data.shift = alldetails[i].shift;
                                    data.time = alldetails[i].time;
                                    data_to_send.push(data);
                                }
                            }
                            callback(null, data_to_send);
                        } else {
                            data_to_send = [];
                            callback(null, data_to_send);
                        }

                    });
                },
                // Send those data which were not send to HQ Previously to HQ
                function(data_to_send, callback) {
                    console.log('##############################');
                    console.log('data_to_send == ' + data_to_send);
                    console.log('##############################');
                    var calls = [];
                    console.log('##############################');
                    console.log('data_to_send.length;', JSON.stringify(data_to_send));
                    console.log('##############################');
                    console.log("HQ_URL", STAFF_ROSTER_URL);


                    if (data_to_send.length > 0) {
                        var len = data_to_send.length;
                        requestretry({
                                url: process.env.HQ_URL + STAFF_ROSTER_URL,
                                method: "POST",
                                forever: true,
                                json: { "data": data_to_send }
                            },
                            function(error, response, body) {
                                console.log('##############################');
                                console.log('in send body', body);
                                console.log('##############################');
                                if (error || (response && response.statusCode != 200)) {
                                    console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                                    console.log("error from sending dat to HQ");
                                    callback(err, null);
                                }
                                callback(null, body);
                            });

                    } else {
                        callback(null, data_to_send);
                    }

                },


            ], function(err, result) {
                if (err) {
                    console.log('##############################');
                    console.log('error in waterfall' + err);
                    console.log('##############################');

                }
                var STAFF_ROSTER_URL = '/outlet/staff_roster/' + process.env.OUTLET_ID;
                console.log('##############################');
                console.log('process.env.HQ_URL + STAFF_ROSTER_URL in get', process.env.HQ_URL + STAFF_ROSTER_URL);
                console.log('##############################');

                // requesting the HQ to get the staff list
                requestretry({
                        url: process.env.HQ_URL + STAFF_ROSTER_URL,
                        method: "GET",
                        maxAttempts: 25,
                    },
                    function(error, response, body) {
                        if (error || (response && response.statusCode != 200)) {
                            console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                            console.log("erro from getting data of staff roster in HQ" + error);
                            return;
                        }
                        body = JSON.parse(body);
                        var len = body.length;
                        for (i = 0; i < len; i++) {
                            body[i].is_set_on_HQ = true;
                        }
                        body = JSON.stringify(body);
                        console.log('##############################');
                        //console.log('body', body);
                        console.log('##############################');
                        // setting the data in redis if no error occurs
                        redisClient.set(helper.staff_roaster_node, body, function(err, reply) {
                            if (err) {
                                console.log("error in setting the data from HQ to redis" + error);
                                callback(err, null);
                            }
                            console.log('##############################');
                            console.log('misc/getStaffrosterdetils set a roster detials ' + reply);
                            console.log('##############################');
                        });

                    });

            });
        })
        .catch(function(err) {
            console.log('##############################');
            console.log('no internet');
            console.log('##############################');

        });


}





module.exports = getStaffroasterdetails;