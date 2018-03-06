var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var redis = require('redis');
var request = require('request');
var helper = require('../routes/helper');
var async = require('async');
var startPrint = require('../misc/printer').startPrint;
var sendUpdatedSMS = require('../misc/printer').sendUpdatedSMS;
var requestretry = require('requestretry');
var firebase = require('firebase');
var internetAvailable = require("internet-available");
format.extend(String.prototype);
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function(msg) {
    console.log(msg);
    //process.exit;cl
});

function sendRefundReplaceData() {

    console.log('##############################');
    console.log('in funciton sendRefundReplaceData');
    console.log('##############################');
  
    internetAvailable({
            timeout: 1000,
            retries: 3,
        })
        .then(function() {
            async.parallel({
                refund_data_to_send: function(callback) {
                    redisClient.lrange(helper.refund_data_list_node, 0, 50, function(error, refunddata) {
                        callback(null, refunddata);
                    });
                },
                replace_data_to_send: function(callback) {
                    redisClient.lrange(helper.replace_data_to_send_node, 0, 50, function(error, replace_data_to_send) {
                        callback(null, replace_data_to_send);
                    });
                },
            }, function(err, results) {
                async.series([
                        function (callback) {
                            searchobj = { is_send_to_HQ: false };
                            var fields = {
                                __v: false,
                                is_send_to_HQ: false,
                            };
                            var sort = { "sort": { "time": -1 } };
                            taskarray = [];
                            taskobject = {};
                            PlaceOrderModel.find(searchobj, fields, sort, function (err, order) {
                                console.log('************************************************');
                                console.log('err', err);
                                console.log('************************************************');
                                console.log('************************************************');
                                console.log('order', order);
                                console.log('************************************************');
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
                                            "is_mobile_order": element.is_mobile_order,
                                            "current_time": element.current_time
                                        };
                                        //process.exit();
                                        taskarray.push(taskelement);
                                    }
                                    taskobject[helper.batch_order_details_node] = taskarray;

                                    console.log('************************************************');
                                    console.log('taskarray', taskarray);
                                    console.log('************************************************');
                                    //process.exit();
                                    // Put the data in firebase
                                    var ref = new Firebase(process.env.FIREBASE_QUEUE);
                                    ref = ref.child("tasks").push(taskobject, function (error, result) {
                                        if (error) {
                                        console.log('************************************************');
                                        console.log('error', error);
                                        console.log('************************************************');
                                            callback(error, null);   
                                            return;     
                                        }
                                        console.log('************************************************');
                                        console.log('result', result);
                                        console.log('************************************************');
                                        callback(null, result);  
                                        return;
                                    });

                                    // send the bulk update to Firebase
                                   
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
                        // function (callback) { //sending the details to the HQ 
                        //     redisClient.lrange(helper.dispense_local_status_node, 0, -1, function (err, reply) {
                        //         if (typeof reply != "undefined" && reply.length > 0) {
                        //             datasenderror = [];
                        //             for (var index = 0; index < reply.length; index++) {
                        //                 var dispens_obj = JSON.parse(reply[index]);
                        //                 debug("Sending dispense status data as- ", dispens_obj);


                        //                 debug("Sending dispense status data as- ", dispens_obj);

                        //                 var ref = new Firebase(process.env.FIREBASE_QUEUE);
                        //                 ref.child('tasks').push(dispens_obj, function (error, reply) {
                        //                     if (error) {
                        //                         datasenderror.push(error);
                        //                         callback(error, null);
                        //                         return;
                        //                     } else {
                        //                         callback(null, reply);
                        //                         return;
                        //                     }
                        //                 });
                        //             }   
                        //             if (datasenderror.length > 0) {
                        //                 callback(datasenderror.join(","), null);
                        //                 return;
                        //             } else {
                        //                 redisClient.del(helper.dispense_local_status_node, function (error, reply) {
                        //                     if (error) {
                        //                         console.log('##############################');
                        //                         console.log('eror', error);
                        //                         console.log('##############################');
                        //                     }
                        //                     callback(null, 1);
                        //                     return;
                        //                 });

                        //                //callback(null, 1);

                        //             }

                        //         } else {
                        //             callback(null, 1);
                        //             return;
                        //         }
                        //     });
                        // },
                        function(callback) {
                            calls = [];
                            refund_data_to_send = results.refund_data_to_send;
                            refund_data_to_send.forEach(function(refundata) {
                                funtion_to_call = "";
                                funtion_to_call = function(callback) {
                                    original_data = refundata;
                                    refundata = JSON.parse(refundata);
                                    console.log("refundata", refundata);
                                    REFUND_ORDER_ITEMS_URL = process.env.HQ_URL + '/outlet/refund_items_offline/' + "-1";
                                    console.log("before HQ request retry", REFUND_ORDER_ITEMS_URL);
                                    requestretry({
                                            url: REFUND_ORDER_ITEMS_URL,
                                            json: refundata,
                                            maxAttempts: 5,
                                            _timeout: 1000,
                                            method: "POST"
                                        },
                                        function(error, response, body) {
                                            console.log("after request retry");
                                            if (
                                                error ||
                                                (response && response.statusCode != 200)
                                            ) {
                                                console.log("outlet_app.js :: showorders " + "{}: errror = {} {}".format(REFUND_ORDER_ITEMS_URL, error, JSON.stringify(response)));
                                                callback(error, null);
                                                return;
                                            }
                                            console.log('************************************************');
                                            console.log('original_data', original_data);
                                            console.log('************************************************');
                                            console.log('************************************************');
                                            console.log('JSON.stringify(refundata)', JSON.stringify(refundata));
                                            console.log('************************************************');
                                            removeelementsfromlistfunction(helper.refund_data_list_node, JSON.stringify(refundata), function(error, reply) {
                                                console.log('************************************************');
                                                console.log('removed element');
                                                console.log('************************************************');
                                                callback(null, 1);
                                            });

                                        }
                                    );
                                };

                                calls.push(funtion_to_call);
                            });

                            console.log('************************************************');
                            console.log('calls', calls);
                            console.log('************************************************');
                            callallfunctions(calls, function(error, reply) {
                                console.log('************************************************');
                                console.log('from call all funciton');
                                console.log('************************************************');
                                callback(null, reply);
                            });
                        },
                        function(callback) {
                            calls = [];
                            replace_data_to_send = results.replace_data_to_send;
                            console.log('##############################');
                            console.log('replace_data_to_send', replace_data_to_send.length);
                            console.log('##############################');

                            replace_data_to_send.forEach(function(replacedata) {
                                funtion_to_call = "";
                                funtion_to_call = function() {
                                    // console.log('##############################');
                                    // console.log('replacedata typeof ', replacedata ,typeof replacedata);
                                    // console.log('##############################');
                                    replacedata = JSON.parse(replacedata);
                                    var hq_url = process.env.HQ_URL;
                                    var REPLACE_ITEMS_URL = hq_url + '/outlet/replace_items_offline/' + "-1";
                                    // console.log('##############################');
                                    // console.log('replacedata typeof2 ', replacedata ,typeof replacedata);
                                    // console.log('##############################');
                                    requestretry({
                                            url: REPLACE_ITEMS_URL,
                                            json: replacedata,
                                            maxAttempts: 5,
                                            _timeout: 1000,
                                            method: "POST"
                                        },
                                        function(error, response, body) {
                                            if (error || (response && response.statusCode != 200)) {
                                                console.log("outlet_app.js :: showorders " + "{}: errror = {} {}".format(REPLACE_ITEMS_URL, error, JSON.stringify(response)));
                                                callback(error, null);
                                                return;
                                            }
                                            console.log('##############################');
                                            //console.log('body', body);
                                            console.log('##############################');
                                            redisClient.lrem(helper.replace_data_to_send_node, 1, JSON.stringify(replacedata), function(error, reply) {
                                                console.log('##############################');
                                                console.log('reply', reply);
                                                console.log('##############################');
                                                callback(null, reply);
                                                return;
                                            });
                                        }
                                    );
                                };
                                calls.push(funtion_to_call);
                            });
                            console.log('##############################');
                            console.log('calls', calls);
                            console.log('##############################');
                            callallfunctions(calls, function(error, reply) {
                                callback(null, reply);
                            });
                        },

                    ],
                    function(error, reply) {
                        if (error) {
                            console.log('##############################');
                            console.log('eroror', error);
                            console.log('##############################');
                        }
                        console.log('##############################');
                        console.log('reply', reply);
                        console.log('##############################');
                    });

            });
        })
        .catch(function(err) {
            console.log('##############################');
            console.log('internet is not online refund replace');
            console.log('##############################');

        });

}


//if call stack of all the calles parrallely
//call all functions start
function callallfunctions(calls, callback) {
    async.series(calls, function(err, result) {
        /* this code will run after all calls finished the job or
            when any of the calls passes an error */

        if (err) {
            console.log('##############################');
            console.log(err);
            console.log('##############################');
        }
        console.log('##############################');
        console.log('all function called');
        console.log('##############################');
        callback(null, result)
    });
}


function callallfunctionsinloop(datatoloop, callfunction, callback) {
    async.map(datatoloop, callfunction, function(err, reply) {
        if (err) {
            console.log(err);
        }
        console.log('##############################');
        console.log('reply', reply);
        console.log('##############################');
        callback(err, reply);
    });
}

function removeelementsfromlistfunction(node, string, callback) {
    redisClient.lrem(node, 0, string, function(err, reply) {
        if (err) {
            console.error("data not deleted form sending cron");
        }
        console.log('##############################');
        console.log('removed item node', reply, node, string);
        console.log('##############################');
        callback(null, reply);
    });
}




module.exports = sendRefundReplaceData;