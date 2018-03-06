var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var redis = require('redis');
var request = require('request');
var async = require("async");
var helper = require('../routes/helper');
var PlaceOrderModel = require("../models/PlaceOrderModel");
var firebase = require('firebase');
var internetAvailable = require("internet-available");
format.extend(String.prototype);
var moment = require('moment');
// Initiating the redisClient
var redisClient = redis.createClient();
redisClient.on('error', function (msg) {
    console.error(msg);
});


/*
created  on fir 17 aug
by peerbits
*/

function storeDispenserQueue() {
    internetAvailable({
        timeout: 1000,
        retries: 3,
    }).then(function () {
        async.series([
            function (callback) {
                searchobj = { is_send_to_HQ: false };
                var fields = {
                    __v: false,
                    is_set_on_HQ: false,
                };
                var sort = { "sort": { "time": -1 } };
                taskarray = [];
                taskobject = {};
                PlaceOrderModel.find(searchobj, fields, sort, function (err, order) {
                    if (typeof order != "undefined" && order.length > 0) {
                        batch = {};
                        for (var index = 0; index < order.length; index++) {
                            var element = order[index];
                            if (typeof element.sides == "undefined") {
                                element.sides = {};
                            }
                            if (typeof element.order_details == "undefined") {
                                element.order_details = {};
                            }
                            taskelement = {
                                "name": element.name,
                                "order_details": element.order_details,
                                "sides": element.sides,
                                "counter_code": element.counter_code,
                                "payment_mode": element.payment_mode,
                                "outlet_id": process.env.OUTLET_ID,
                                "order_barcodes": element.order_barcodes.split(","),
                                "mobile_num": element.mobile_num,
                                "credit_card_no": element.credit_card_no,
                                "cardholder_name": element.cardholder_name,
                                "bill_no": element.bill_no,
                                "food_details": element.food_details,
                                "unique_Random_Id": element.unique_Random_Id,
                                "outlet_order_id": element.outlet_order_id.toString(),
                                "is_mobile_order": element.is_mobile_order
                            };
                            //process.exit();
                            taskarray.push(taskelement);
                        }
                        taskobject[helper.batch_order_details_node] = taskarray;
                        // Put the data in firebase
                        var ref = new Firebase(process.env.FIREBASE_QUEUE);
                        ref = ref.child("tasks").push(taskobject, function (error, result) {
                            // if (error) {
                            console.log('************************************************');
                            console.log('error', error);
                            console.log('************************************************');

                            // }
                            console.log('************************************************');
                            console.log('result', result);
                            console.log('************************************************');
                        });

                        // send the bulk update to Firebase
                        callback(null, 1);
                    } else {
                        callback(null, 1);
                    }

                });
            },
            function (callback) { //make the changes on the place order details in mongo
                search_order_item = { is_send_to_HQ: false };
                var fields = {
                    __v: false,
                    is_set_on_HQ: false,
                };
                var sort = { "sort": { "time": -1 } };
                order_items = {};
                order_items.is_send_to_HQ = true;
                PlaceOrderModel.find(searchobj, fields, sort, function (err, order) {
                    console.log('##############################');
                    console.log('in seding details to HQ', order);
                    console.log('##############################');
                    if (typeof order != "undefined" && order.length > 0) {
                        PlaceOrderModel.update(search_order_item, { $set: order_items }, { "multi": true },
                            function (err, numberAffected, rawResponse) {
                                //handle it
                                console.log('##############################');
                                console.log('numberAffected', numberAffected);
                                console.log('##############################');
                                callback(null, 1);
                            });
                    } else {
                        callback(null, 1);
                    }
                });

            },
            function (callback) { //sending the details to the HQ 
                redisClient.lrange(helper.dispense_local_status_node, 0, -1, function (err, reply) {
                    if (typeof reply != "undefined" && reply.length > 0) {
                        datasenderror = [];
                        for (var index = 0; index < reply.length; index++) {
                            var dispens_obj = JSON.parse(reply[index]);
                            debug("Sending dispense status data as- ", dispens_obj);
                            var ref = new Firebase(process.env.FIREBASE_QUEUE);
                            ref.child('tasks').push(dispens_obj, function (error, reply) {
                                if (error) {
                                    datasenderror.push(error);
                                } else {

                                }
                            });
                        }
                        if (datasenderror.length > 0) {
                            callback(datasenderror.join(","), null);
                            return;
                        } else {
                            redisClient.del(helper.dispense_local_status_node, function (error, reply) {
                                if (error) {
                                    console.log('##############################');
                                    console.log('eror', error);
                                    console.log('##############################');
                                }
                                callback(null, 1);
                                return;
                            });

                        }

                    } else {
                        callback(null, 1);
                        return;
                    }
                });
            }
        ],function(error,data){
            if (error) {
                console.log('##############################');
                console.log('Store Dispense Queue Error', storeDispenserQueue);
                console.log('##############################');
                return;
            }
            console.log('##############################');
            console.log('reply store order details ', reply);
            console.log('##############################');


        });
    })
}