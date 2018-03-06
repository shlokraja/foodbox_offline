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
// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function(msg) {
    console.error(msg);
});

/*
    Main logic 
    1) get the data from the redis for the bill
    2) reverse the data got from the redis
    3) send the detail to the the HQ and Direct bill url
    4) remove details send to the HQ from Redis
    5) send UPDATE RECOVERY URL DATA
    6) send the Stock count and Lock count TO HQ
    
*/
function sendStoredBillToHQ() {
    console.log('##############################');
    console.log('in funciton sendStoredBillToHQ');
    console.log('##############################');


    async.parallel({

        bill_print_info: function(callback) {
            redisClient.lrange(helper.bill_print_info_node, 0, -1, function(err, reply) {
                if (err) {
                    console.log('##############################');
                    console.log('err in geting redis data for bill print' + err);
                    console.log('##############################');
                }
                var bill_print_info = [];
                if (reply !== "undefined") {
                    len = reply.length;
                    if (len > 0) {
                        for (i = 0; i < len; i++) {
                            bill_print_info.push(JSON.parse(reply[i]));
                        }
                    }

                }
                callback(null, bill_print_info);
            });
        },
        cur_dispense_id: function(callback) {
            redisClient.get(helper.dispense_id_node, function(err, reply) {
                if (err) {
                    console.log('##############################');
                    console.log('err in geting redis dispense id node in sendStoredBillToHQ' + err);
                    console.log('##############################');
                    return;
                }
                callback(null, reply);
            });
        },
        cur_bill_no: function(callback) {
            redisClient.get(helper.bill_no_node, function(err, reply) {
                if (err) {
                    console.log('##############################');
                    console.log('err in geting redis dispense id node in sendStoredBillToHQ' + err);
                    console.log('##############################');
                    return;
                }
                callback(null, reply);
            });
        },
        current_stock_count: function(callback) {
            // Getting the stock count here
            redisClient.get(helper.stock_count_node, function(err, reply) {
                if (err) {
                    callback("error while retreiving from redis- {}".format(err), null);
                    return;
                }
                callback(null, reply);
            });
        },
        checkinternet: function(callback) {
            internetAvailable({
                    timeout: 1000,
                    retries: 3,
                })
                .then(function() {
                    callback(null, true);
                })
                .catch(function(err) {
                    callback(null, false);
                });

            //callback(null,false);
        },


    }, function(err, result) {
        console.log('************************************************');
        console.log('result in store bill to HQ', result);
        console.log('************************************************');

        async.series([
function (callback) { //sending the details to the HQ 
                redisClient.lrange(helper.dispense_local_status_node, 0, -1, function (err, reply) {
                    if (typeof reply != "undefined" && reply.length > 0) {
                        datasenderror = [];
                        for (var index = 0; index < reply.length; index++) {
                            var dispens_obj = JSON.parse(reply[index]);
                            debug("Sending dispense status data as- ", dispens_obj);


                            debug("Sending dispense status data as- ", dispens_obj);

                            var ref = new Firebase(process.env.FIREBASE_QUEUE);
                            ref.child('tasks').push(dispens_obj, function (error, reply) {
                                if (error) {
                                    datasenderror.push(error);
                                    callback(error, null);
                                    return;
                                } else {
                                    callback(null, reply);
                                    return;
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

                            //callback(null, 1);

                        }

                    } else {
                        callback(null, 1);
                        return;
                    }
                });
            },


        ],function(error,callback){
            if(error){
                console.log('##############################');
                console.log('eroror', error);
                console.log('##############################');
            }

            if (result.checkinternet) {
                bill_info = result.bill_print_info;
                direct_bill_info = result.direct_bill_print_info;
                len = bill_info.length;

                for (i = len - 1; i >= 0; i--) {
                    if (typeof bill_info[i] !== 'undefined') {
                        bill_to_print = JSON.parse(bill_info[i]["bill_to_print"]);
                        bill_no = bill_info[i]["bill_no"];
                        date = bill_info[i]["date"];
                        time = bill_info[i]["time"];
                        savings = bill_info[i]["savings"];
                        mobile_num = bill_info[i]["mobile_num"];
                        outlet_phone_no = bill_info[i]["outlet_phone_no"];
                        startPrint(bill_to_print, bill_no, date, time, savings, mobile_num, outlet_phone_no);
                        redisClient.lrem(helper.bill_print_info_node, 1, JSON.stringify(bill_info[i]));
                    }
                }



                var UPDATE_RECOVERY_DETAILS_URL = process.env.HQ_URL; + '/outlet/update_recovery_details/' + process.env.OUTLET_ID;
                // Store the recovery details in the HQ
                // it works for sending only so it can send the data after new order occurs and internet is present
                requestretry({
                    url: UPDATE_RECOVERY_DETAILS_URL,
                    forever: true,
                    method: "POST",
                    json: {
                        "bill_no": result.cur_bill_no,
                        "dispense_id": result.cur_dispense_id
                    }
                }, function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        debug('{}: {} {}'.format(UPDATE_RECOVERY_DETAILS_URL, error, body));
                        return;
                    }
                    debug("Updated HQ with the recovery details");
                });


                var stock_count = JSON.parse(result.current_stock_count);
                //Merging with the lock counts and sending to browser and firebase
                var item_id_list = [];
                for (var item_id in stock_count) {
                    item_id_list.push(item_id + '_locked_count');
                    item_id_list.push(item_id + '_mobile_locked_count');
                }

                redisClient.mget(item_id_list, function (l_err, l_reply) {
                    for (var item_id in stock_count) {
                        if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
                            stock_count[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                        } else {
                            stock_count[item_id]["locked_count"] = 0;
                        }

                        if (l_reply[item_id_list.indexOf(item_id + '_mobile_locked_count')]) {
                            stock_count[item_id]["mobile_locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_mobile_locked_count')]);
                        } else {
                            stock_count[item_id]["mobile_locked_count"] = 0;
                        }
                    }

                    // broadcasting the new stock count to all connected clients
                    // io.emit(helper.stock_count_node, stock_count);
                    // io.sockets.emit(helper.stock_count_node, stock_count);

                    // Put the data in firebase
                    var rootref = new firebase(process.env.FIREBASE_CONN);
                    var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                    stock_count_node.set(stock_count);


                });



            } else {
                console.log('##############################');
                console.log('internet is not present from store bill to HQ or bill details not there');
                console.log('##############################');

            }

        });




      
    });




}

module.exports = sendStoredBillToHQ;