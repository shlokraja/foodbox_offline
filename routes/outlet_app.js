/*jshint esversion: 6 */
var express = require('express');
var router = express.Router();
var debug = require('debug')('outlet_app:server');
var redis = require('redis');
var format = require('string-format');
var firebase = require('firebase');
var request = require('request');
var requestretry = require('requestretry');
var async = require('async');
var _ = require('underscore');
var nodemailer = require('nodemailer');
var check_incoming_po = require('../misc/checkIncomingPOStatus');
var moment = require('moment');
var helper = require('./helper');


var internetAvailable = require("internet-available");
//var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectID;
var assert = require('assert');
var NonFoodIssue = require("../models/non_food_issues");
var FoodIssue = require("../models/food_issues");
var OrderModel = require("../models/OrderModel");
var OrderItemModel = require("../models/OrderItemModel");
var CashDetailModel = require("../models/CashDetailModel");
var offline_incomming_po = require('../misc/offline_incomming_po');
var cashdetails = require("../misc/cashdetails");
var ping = require('ping');
format.extend(String.prototype);
// Initiating the redisClient
var redisClient = redis.createClient({
    connect_timeout: 2000,
    retry_max_delay: 5000
});


redisClient.on('error', function (msg) {
    console.error(msg);
});

router.get('/checkInternet',function(req,res,next)
{
	var hosts = ['google.com'];
	hosts.forEach(function(host){
    		ping.sys.probe(host, function(isAlive){
        		var msg = isAlive ? 'host ' + host + ' is alive' : 'host ' + host + ' is dead';
        		console.log(msg);
			res.send(isAlive);
    		});
	});
});

// Routes coming from the outlet app itself
// This gets the test mode flag from the outlet dash and passes it down
// to the order app.
router.post('/test_mode', function (req, res, next) {
    var flag = req.body.flag;
    debug("Received test mode flag as - " + flag);
    // If flag is true, mark it as the start time in the DB, else as end time
    debug("Marking start time of test mode in the DB");
    var hq_url = process.env.HQ_URL;
    var TEST_MODE_TIME_URL = '/outlet/new_test_mode_time/';
    var outlet_id = process.env.OUTLET_ID;


    if (flag) {
        debug("Set Test Mode Timeout started");
        var TimeoutId = setTimeout(ClearTestMode, (60000 * process.env.TEST_MODE_TIME))
        var obj = new Object();
        obj.status = flag;
        obj.starttime = new Date();
        obj.endtime = null;
        redisClient.set(helper.test_mode_flag, flag);
        redisClient.set("test_mode_details", JSON.stringify(obj),
            function (set_err, set_reply) {
                if (set_err) {
                    console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                    return;
                }
            });
        debug("Set Test Mode Timeout Completed");
    } else {
        debug("in test mod false");
        ClearTestMode();
        res.send('success');
    }
});

router.post('/test_mode_preprint', function (req, res, next) {
    var flag = req.body.flag;
    // Pre-Printed Code - Start (New for pre-printed)

    // console.log('**************************** flag' + flag)
    //if (!flag) {
    //    console.log('**************************** remove test comparision executed')
    //    // deleting the barcode_comparision node
    //    redisClient.del(helper.barcode_comparision, function (del_err, del_reply) {
    //        if (del_err) {
    //            console.error("error while deleting barcode_comparision in redis- {}".format(b_err));
    //            return;
    //        }
    //    });
    //}

    // Pre-Printed Code - End

    debug("Received test mode flag as - " + flag);
    // If flag is true, mark it as the start time in the DB, else as end time
    debug("Marking start time of test mode in the DB");
    var hq_url = process.env.HQ_URL;
    var TEST_MODE_TIME_URL = '/outlet/test_mode_time/';
    var outlet_id = process.env.OUTLET_ID;
    requestretry({
        url: hq_url + TEST_MODE_TIME_URL + outlet_id,
        method: "POST",
        forever: true,
        json: {
            "start": flag
        }
    },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            // debug(body);
        });
    redisClient.set(helper.test_mode_flag,
        flag,
        function (set_err, set_reply) {
            if (set_err) {
                console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                return;
            }
        });
    debug("Sending the test mode flag to the order app");
    io.emit('test_mode', flag);
    io.sockets.emit('test_mode', flag);
    res.send('success');
});

//Clear Test mode function is to auto off the test mode based on the outlet configuration
//this will trigger from the test mode is started  after the timeout
function ClearTestMode() {
    hq_url = process.env.HQ_URL;
    debug("Clear Test Mode Timeout started");
    redisClient.get("test_mode_details", function (err, res) {
        if (err) {
            console.error('error while inserting in redis- {}'.format(set_stock_count_err));
            return;
        } else {
            var obj = JSON.parse(res);
            if (obj == null) {
                obj = {};
            }
            obj.endtime = new Date();
            redisClient.set(helper.test_mode_flag, false);
            console.log("in test mod false called");
            redisClient.set("test_mode_details", JSON.stringify(obj), function (set_err, res) {
                if (set_err) {
                    console.error('error while inserting in redis- {}'.format(set_err));
                    return;
                }
            });
            internetAvailable({
                timeout: 1000,
                retries: 3,
            })
                .then(function () {
                    requestretry({
                        url: hq_url + TEST_MODE_TIME_URL + outlet_id,
                        method: "POST",
                        maxAttempts: 10,
                        json: obj
                    }, function (error, response, body) {
                        if (error || (response && response.statusCode != 200)) {
                            console.error('{}: {} {}'.format(hq_url, error, body));
                            var details = {
                                "obj": obj,
                                "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                                "send_From": "clear_test_mode",
                            };
                            redisClient.lpush(helper.test_mode_details_node, JSON.stringify(details), function (err, reply) {
                                if (err) {
                                    console.log("err in clear test mod storing the details", err);
                                    return;
                                }
                            });
                            return;
                        }
                        debug(body);
                    });
                })
                .catch(function (err) {
                    var details = {
                        "obj": obj,
                        "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                        "send_From": "clear_test_mode",
                    };
                    redisClient.lpush(helper.test_mode_details_node, JSON.stringify(details), function (err, reply) {
                        if (err) {
                            console.log("err in clear test mod storing the details", err);
                            return;
                        }
                    });
                });

        }
    });
    io.emit('test_mode', false);
    io.sockets.emit('test_mode', false);
}

// This function notes down any issue that might have occured during
// test mode and sends it to the HQ to be noted in the DB
router.post('/test_mode_issue', function (req, res, next) {
    var issue_text = req.body.text;
    debug("Test mode issue received as- " + issue_text);
    var hq_url = process.env.HQ_URL;
    var TEST_MODE_ISSUES_URL = '/outlet/test_mode_issue/';
    var outlet_id = process.env.OUTLET_ID;
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            requestretry({
                url: hq_url + TEST_MODE_ISSUES_URL + outlet_id,
                method: "POST",
                timeout: 5000,
                json: {
                    "text": issue_text,
                    "userid": loggedinuserid
                }
            },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        console.error('{}: {} {}'.format(hq_url, error, body));
                        var details = {
                            "time": moment.utc().format("YYYY-MM-DD HH:mm:ss"),
                            "issue_text": issue_text,
                            "call": "test_mode_issue"
                        };
                        redisClient.lpush(helper.test_mode_issues_node, JSON.stringify(details), function (err, reply) {
                            if (err) {
                                console.log("details to send", err);
                                return;
                            }
                        });
                        res.send("success");
                        return;
                    }
                    res.send(body);
                });
        })
        .catch(function (err) {
            var details = {
                "time": moment.utc().format("YYYY-MM-DD HH:mm:ss"),
                "issue_text": issue_text,
                "call": "test_mode_issue"
            };
            redisClient.lpush(helper.test_mode_issues_node, JSON.stringify(details), function (err, reply) {
                if (err) {
                    console.log("details to send", err);
                    return;
                }
            });
            res.send("success");
        });

});

router.post('/beverage_control', function (req, res, next) {
    var data = req.body.data;
    var dataToSend = [];
    // flattening the dictionary to a list
    for (var item_id in data) {
        var item = data[item_id];
        item["id"] = item_id;
        dataToSend.push(item);
    }
    debug("Sending beverage signal as- ", JSON.stringify(dataToSend));
    io.emit('beverage_items', dataToSend);
    io.sockets.emit('beverage_items', dataToSend);
    res.send("success");
});

// This will mark the given barcodes to be spoiled in the stock_count
router.post('/mark_spoilage', function (req, res, next) {
    var barcodes = req.body.barcodes;
    var misc_notes = req.body.misc_notes;
    redisClient.get(helper.stock_count_node, function (err, reply) {
        if (err) {
            console.error("error while retreiving from redis- {}".format(err));
            res.status(500).send("error while retreiving from redis- {}".format(err));
            return;
        }
        var stock_count = JSON.parse(reply);
        for (var item_id in stock_count) {
            var item_node = stock_count[item_id];
            for (var i = 0; i < item_node["item_details"].length; i++) {
                var barcode = item_node["item_details"][i]["barcode"];
                // checking for the barcode in the item details
                if (barcodes.indexOf(barcode) != -1) {
                    debug("barcode- {} has spoiled".format(barcode));
                    stock_count[item_id]["item_details"][i]["spoiled"] = true;
                }
            }
        }
        //Sending signal to the order app
        io.emit(helper.stock_count_node, stock_count);
        io.sockets.emit(helper.stock_count_node, stock_count);
        // Setting the value in redis
        redisClient.set(helper.stock_count_node,
            JSON.stringify(stock_count),
            function (set_stock_count_err, set_stock_count_reply) {
                if (set_stock_count_err) {
                    console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                    return;
                }
            });
        // Put the data in firebase
        var rootref = new firebase(process.env.FIREBASE_CONN);
        var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
        stock_count_node.set(stock_count);

        // Marking the spoiled items in the final status table
        var hq_url = process.env.HQ_URL;
        var MARK_SPOILAGE_URL = hq_url + '/outlet/report_spoilage';
        requestretry({
            url: MARK_SPOILAGE_URL,
            method: "POST",
            forever: true,
            maxAttempts: 25,
            json: {
                "barcodes": barcodes,
                "misc_notes": misc_notes,
                "userid": loggedinuserid
            }
        }, function (bill_error, bill_response, bill_body) {
            if (bill_error || (bill_response && bill_response.statusCode != 200)) {
                console.error('{}: {} {}'.format(MARK_SPOILAGE_URL, bill_error, bill_body));
                return;
            }
            // debug(bill_body);
        });
        res.send('success');
    });
});

// This will mark entire stock as spoiled
router.post('/force_fail_entire_stock', function (req, res, next) {
    var misc_notes = null;
    var barcodes = [];
    var fail_all = req.body.fail_all;
    redisClient.get(helper.stock_count_node, function (err, reply) {
        if (err) {
            console.error("error while retreiving from redis- {}".format(err));
            res.status(500).send("error while retreiving from redis- {}".format(err));
            return;
        }
        var stock_count = JSON.parse(reply);

        for (var item_id in stock_count) {
            var item_node = stock_count[item_id];
            for (var i = 0; i < item_node["item_details"].length; i++) {
                var barcode = item_node["item_details"][i]["barcode"];
                var count = item_node["item_details"][i]["count"];
                for (var j = 0; j < count; ++j) {
                    barcodes.push(barcode);
                }
                stock_count[item_id]["item_details"][i]["spoiled"] = true;
            }
        }
        //Sending signal to the order app
        io.emit(helper.stock_count_node, stock_count);
        // Setting the value in redis
        redisClient.set(helper.stock_count_node,
            JSON.stringify(stock_count),
            function (set_stock_count_err, set_stock_count_reply) {
                if (set_stock_count_err) {
                    console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                    return;
                }
            });
        // Put the data in firebase
        var rootref = new firebase(process.env.FIREBASE_CONN);
        var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
        stock_count_node.set(stock_count);
        var hq_url = process.env.HQ_URL;
        var outlet_id = process.env.OUTLET_ID;
        var FORCE_FAILURE_URL = hq_url + '/outlet/force_failure';
        requestretry({
            url: FORCE_FAILURE_URL,
            method: "POST",
            forever: true,
            json: {
                "outlet_id": outlet_id,
                "barcodes": barcodes,
                "misc_notes": misc_notes,
                "fail_all": fail_all,
                "userid": loggedinuserid
            }
        }, function (bill_error, bill_response, bill_body) {
            if (bill_error || (bill_response && bill_response.statusCode != 200)) {
                console.error('{}: {} {}'.format(FORCE_FAILURE_URL, bill_error, bill_body));
                return;
            }
            // debug(bill_body);
            res.send('success');
        });
    });
});

// This is to update the inventory after removing the expired items
router.post('/signal_expiry_item_removal', function (req, res, next) {
    // clear out the expiry_slots queue from redis
    redisClient.del(helper.expiry_slots_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send("error while deleting expiry slots in redis- {}".format(err));
            return;
        }
        debug('Expired slots removed from redis');
    });
    // get the barcodes of all expired items from the redis queue and send
    // them to HQ
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res) {
        if (redis_err) {
            console.error(redis_err);
            res.status(500).send(redis_err);
            return;
        }
        var barcodes = [];
        var stock_count = JSON.parse(redis_res);
        for (var item_id in stock_count) {
            var item_node = stock_count[item_id];
            for (var i = 0; i < item_node["item_details"].length; i++) {
                if (item_node["item_details"][i]["expired"]) {
                    for (var j = 0; j < item_node["item_details"][i]["count"]; j++) {
                        barcodes.push(item_node["item_details"][i]["barcode"]);
                    }
                }
            }
        }
        var hq_url = process.env.HQ_URL;
        var REMOVE_EXPIRED_URL = hq_url + '/outlet/remove_expired_items';
        // changes done by peerbits
        // 06-Aug-2017
        internetAvailable({
            timeout: 1000,
            retries: 3,
        })
            .then(function () {
                requestretry({
                    url: REMOVE_EXPIRED_URL,
                    method: "POST",
                    json: {
                        "barcodes": barcodes,
                        "userid": loggedinuserid
                    }
                }, function (expire_error, expire_response, expire_body) {
                    if (expire_error || (expire_response && expire_response.statusCode != 200)) {
                        console.error('{}: {} {}'.format(hq_url, expire_error, expire_body));
                        var details = {
                            "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                            "barcode_details": barcodes,
                            "api": "signal_expriy_barcodes",
                        }
                        redisClient.lpush(helper.expiry_barcodes_node, JSON.stringify(details), function (err, reply) {
                            if (err) {
                                console.log('##############################');
                                console.log('err in storing expiry details', err);
                                console.log('##############################');
                            }
                        });
                        return;

                    }
                    // debug(expire_body);
                });
            })
            .catch(function (err) {
                var details = {
                    "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                    "barcode_details": barcodes,
                    "api": "signal_expriy_barcodes",
                }
                redisClient.lpush(helper.expiry_barcodes_node, JSON.stringify(details), function (err, reply) {
                    if (err) {
                        console.log('##############################');
                        console.log('err in storing expiry details', err);
                        console.log('##############################');
                    }
                });
            });

        res.send('success');
    });
});

router.post('/signal_unscanned_item_removal', function (req, res, next) {
    // clear out the expiry_slots queue from redis
    redisClient.del(helper.unscanned_slots_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send("error while retreiving from redis- {}".format(err));
            return;
        }
        debug('Unscanned slots removed from redis');
    });
    item_codes = req.body.item_codes;
    var hq_url = process.env.HQ_URL;
    var REMOVE_UNSCANNED_URL = hq_url + '/outlet/remove_unscanned_items';
    requestretry({
        url: REMOVE_UNSCANNED_URL,
        method: "POST",
        forever: true,
        json: {
            "item_codes": item_codes,
            "userid": loggedinuserid
        }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        // debug(body);
    });
    res.send('success');
});

// This will return the no. of unscanned slots for the outlet dash
router.get('/unscanned_slots', function (req, res, next) {
    // Get the unscanned slots and last load info first
    redisClient.get(helper.unscanned_slots_node,
        function (err, reply) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }
            var unscanned_slots = JSON.parse(reply);
            res.send({
                "unscanned_slots": unscanned_slots
            });
        });
});

router.post('/update_unscanned_items', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;

    // First removing the unscanned items slot in redis -
    redisClient.del(helper.unscanned_slots_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send(err);
            return;
        }
        debug('Unscanned slots removed from redis');
        res.send('success');
    });
});

router.get('/update_outstanding_po', function (req, res, next) {
    check_incoming_po();
    res.send('success');
});

router.get('/get_loading_issue_items', function (req, res, next) {
    redisClient.get(helper.loading_issue_items_node, function (err, reply) {
        if (err) {
            console.error("error while retrieving from redis- {}".format(err));
            res.status(500).send("error while retrieving from redis- {}".format(err));
            return;
        }
        var parsed_response = JSON.parse(reply);
        if (!parsed_response) {
            res.send({});
            return;
        }
        res.send({
            "unscanned": parsed_response.unscanned_slots,
            "loading_issue": parsed_response.loading_issue
        });
    });
});

//changes done by peerbits to store the issues data to be send after some time 
//date : 06-08-2017

router.post('/store_loading_issue_items', function (req, res, next) {
    // this will contact the HQ and update the final status of the latest po
    // and batch and mark the barcodes as 'loading_issue'
    var item_id_info = req.body.item_id_info;
    var hq_url = process.env.HQ_URL;
    var STORE_LOADING_ISSUE_ITEMS_URL = hq_url + '/outlet/report_loading_issue/' + process.env.OUTLET_ID;
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            // requestretry({
            //     url: STORE_LOADING_ISSUE_ITEMS_URL,
            //     method: "POST",
            //     json: { "item_id_info": item_id_info }

            // }, function(error, response, body) {
            //     if (error || (response && response.statusCode != 200)) {
            //         console.error('{}: {} {}'.format(hq_url, error, body));
            //         if (item_id_info != null) {
            //             var detail = {
            //                 "item_id_info": JSON.stringify(item_id_info),
            //                 "time": moment.utc().format("YYYY-MM-DD HH:mm:ss"),
            //                 "api": "store_loading_issue_items"
            //             };
            //             redisClient.lpush(helper.loading_item_issue_node, JSON.stringify(detail), function(err, reply) {
            //                 if (err) {
            //                     console.log("err cannot store loading item issue in the redis");
            //                 }
            //                 res.send("success");
            //             });
            //         } else {
            //             res.send("success");
            //         }
            //         return;
            //     } else {
            //         res.send(body);
            //     }

            // });

            request(STORE_LOADING_ISSUE_ITEMS_URL, {
                timeout: 1500
            },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        console.error('{}: {} {}'.format(hq_url, error, body));
                        if (item_id_info != null) {
                            var detail = {
                                "item_id_info": JSON.stringify(item_id_info),
                                "userid": loggedinuserid,
                                "time": moment.utc().format("YYYY-MM-DD HH:mm:ss"),
                                "api": "store_loading_issue_items"
                            };
                            redisClient.lpush(helper.loading_item_issue_node, JSON.stringify(detail), function (err, reply) {
                                if (err) {
                                    console.log("err cannot store loading item issue in the redis");
                                }
                                res.send("success");
                            });
                        } else {
                            res.send("success");
                        }
                        return;
                    } else {
                        res.send(body);
                    }
                });
        })
        .catch(function (err) {
            var detail = {
                "item_id_info": JSON.stringify(item_id_info),
                "time": moment.utc().format("YYYY-MM-DD HH:mm:ss"),
                "api": "store_loading_issue_items"
            };
            redisClient.lpush(helper.loading_item_issue_node, JSON.stringify(detail), function (err, reply) {
                if (err) {
                    console.log("err cannot store loading item issue in the redis");
                }
                res.send("success");
            });
        });

});




// This will signal the HQ that day has started and open the main page
// router.post('/start_of_day_signal', function (req, res, next) {
//     var supplies = req.body.supplies;
//     if (!supplies) {
//         res.status(400).send('Please fill the supplies field');
//         return;
//     }
//     outlet_register("sod", false);
//     var hq_url = process.env.HQ_URL;
//     var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status?phase=start_of_day';
//     requestretry({
//         url: SUPPLIES_STATUS_URL,
//         method: "POST",
//         forever: true,
//         json: { "supplies": supplies }
//     }, function (error, response, body) {
//         if (error || (response && response.statusCode != 200)) {
//             console.error('{}: {} {}'.format(hq_url, error, body));
//             return;
//         }
//         // debug(body);
//     });

//     // Deleting the zero sales node
//     redisClient.del(helper.zero_sales_count_node, function (del_err, del_reply) {
//         if (del_err) {
//             console.error("error while deleting zero sales in redis- {}".format(b_err));
//             return;
//         }
//         debug("Deleted the zero sales count node");
//     });

//     // Pre-Printed Code - Start (New for Pre-printed code)

//     //redisClient.get(helper.outlet_config_node, function (err, reply) {
//     //    if (err) {
//     //        debug('error while retreiving from redis- {}'.format(err), null);
//     //        return;
//     //    }
//     //    var outlet_config = JSON.parse(reply);
//     //    var city = outlet_config.city;
//     //    var outlet_id = pad(outlet_config.id, 3);
//     //    var test_barcode = city + outlet_id + 'TST';
//     //    console.log('***********************************************test_barcode' + test_barcode);
//     //    redisClient.get(helper.barcode_comparision, function (err, reply) {
//     //        if (err) {
//     //            debug('error while retreiving from redis- {}'.format(err));
//     //            return;
//     //        }
//     //        var dummy_array = [];
//     //        var current_count = 1;
//     //        for (var itemId = 9001; itemId <= 9003; itemId++) {
//     //            var end_count = current_count + 29;
//     //            for (var i = current_count; i <= end_count; i++) {
//     //                var test_data_matrix = 'TST' + pad(i, 6);
//     //                dummy_array.push({ data_matrix_code: test_data_matrix, barcode: test_barcode + itemId + '121020251700' });
//     //                current_count++;
//     //            }
//     //        }

//     //        redisClient.set(helper.barcode_comparision,
//     //            JSON.stringify(dummy_array),
//     //            function (err, rply) {
//     //                if (err) {
//     //                    console.log('*******************error while inserting in redis- {}'.format(err));
//     //                }

//     //            });
//     //    });
//     //});

//     // Pre-Printed Code - End

//     // Resetting the bill_no to 1 because its at the end of the day
//     redisClient.set(helper.bill_no_node, 1, function (b_err, b_reply) {
//         if (b_err) {
//             console.error("error while setting bill_no in redis- {}".format(b_err));
//             return;
//         }
//         debug("Set the bill no to 1");
//     });

//     redisClient.set(helper.dispense_id_node, 1, function (d_err, d_reply) {
//         if (d_err) {
//             callback("error while retreiving from redis- {}".format(d_err), null);
//             return;
//         }
//         debug("Set the dispense_id to 1");
//     });

//     redisClient.set(helper.start_of_day_flag, false, function (sod_err, sod_reply) {
//         if (sod_err) {
//             console.error("error while setting sod in redis- {}".format(sod_err));
//             return;
//         }
//         res.send('success');
//     });
// });



// This will signal the HQ that day has started and open the main page
// changes done by the peerbits to check if the internet is present or not if not then storing supplies data with time on localstorage=redis
//date:04-Aug-2017
router.post('/start_of_day_signal', function (req, res, next) {
    var supplies = req.body.supplies;
    if (!supplies) {
        res.status(400).send('Please fill the supplies field');
        return;
    }
    outlet_register("sod", false);
    var hq_url = process.env.HQ_URL;
    var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status?phase=start_of_day';
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            requestretry({
                url: SUPPLIES_STATUS_URL,
                method: "POST",
                forever: true,
                json: {
                    "supplies": supplies,
                    "userid": loggedinuserid
                }
            }, function (error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    var main_data_to_send = {};
                    main_data_to_send.is_set_on_HQ = false;
                    main_data_to_send.supplies = supplies;
                    main_data_to_send.time = moment.utc().format('YYYY-MM-DD HH:mm:ss');
                    redisClient.lpush(helper.supplies_detail_to_send_node, JSON.stringify(main_data_to_send), function (err, result) {
                        if (err) {
                            console.log('##############################');
                            console.log('err in pushing detail for supplies details', err);
                            console.log('##############################');
                        }
                    });
                }
                // debug(body);
            });
        })
        .catch(function (err) {
            var main_data_to_send = {};
            main_data_to_send.is_set_on_HQ = false;
            main_data_to_send.supplies = supplies;
            main_data_to_send.time = moment.utc().format('YYYY-MM-DD HH:mm:ss');
            redisClient.lpush(helper.supplies_detail_to_send_node, JSON.stringify(main_data_to_send), function (err, result) {
                if (err) {
                    console.log('##############################');
                    console.log('err in pushing detail for supplies details', err);
                    console.log('##############################');
                }
            });

        });

    //working on changin the todays cash details to 0
    cashdetails.stardofdaycount();

    //call a function to make eod tru for reconsile data
    offline_set_eod_rconsile_data("Y");

    // Deleting the zero sales node
    redisClient.del(helper.zero_sales_count_node, function (del_err, del_reply) {
        if (del_err) {
            console.error("error while deleting zero sales in redis- {}".format(b_err));
            return;
        }
        debug("Deleted the zero sales count node");
    });

    redisClient.del(helper.stock_count_node, function (del_err, del_reply) {
        if (del_err) {
            console.error("error while deleting stock_count in redis- {}".format(b_err));
            return;
        }
        debug("Deleted the stock count node");
    });

    // Pre-Printed Code - Start (New for Pre-printed code)

    //redisClient.get(helper.outlet_config_node, function (err, reply) {
    //    if (err) {
    //        debug('error while retreiving from redis- {}'.format(err), null);
    //        return;
    //    }
    //    var outlet_config = JSON.parse(reply);
    //    var city = outlet_config.city;
    //    var outlet_id = pad(outlet_config.id, 3);
    //    var test_barcode = city + outlet_id + 'TST';
    //    console.log('***********************************************test_barcode' + test_barcode);
    //    redisClient.get(helper.barcode_comparision, function (err, reply) {
    //        if (err) {
    //            debug('error while retreiving from redis- {}'.format(err));
    //            return;
    //        }
    //        var dummy_array = [];
    //        var current_count = 1;
    //        for (var itemId = 9001; itemId <= 9003; itemId++) {
    //            var end_count = current_count + 29;
    //            for (var i = current_count; i <= end_count; i++) {
    //                var test_data_matrix = 'TST' + pad(i, 6);
    //                dummy_array.push({ data_matrix_code: test_data_matrix, barcode: test_barcode + itemId + '121020251700' });
    //                current_count++;
    //            }
    //        }

    //        redisClient.set(helper.barcode_comparision,
    //            JSON.stringify(dummy_array),
    //            function (err, rply) {
    //                if (err) {
    //                    console.log('*******************error while inserting in redis- {}'.format(err));
    //                }

    //            });
    //    });
    //});

    // Pre-Printed Code - End

    // Resetting the bill_no to 1 because its at the end of the day
    redisClient.set(helper.bill_no_node, 1, function (b_err, b_reply) {
        if (b_err) {
            console.error("error while setting bill_no in redis- {}".format(b_err));
            return;
        }
        debug("Set the bill no to 1");
    });

    redisClient.set(helper.dispense_id_node, 1, function (d_err, d_reply) {
        if (d_err) {
            callback("error while retreiving from redis- {}".format(d_err), null);
            return;
        }
        debug("Set the dispense_id to 1");
    });
    /* delete done queue*/
    redisClient.del(helper.pending_done_node, function (del_err, del_reply) {
        if (del_err) {
            console.error("error while deleting pending_done_node in redis- {}".format(b_err));
            return;
        }
    });

    redisClient.set(helper.start_of_day_flag, false, function (sod_err, sod_reply) {
        if (sod_err) {
            console.error("error while setting sod in redis- {}".format(sod_err));
            return;
        }
        res.send('success');
    });
});


function offline_set_eod_rconsile_data(eod_to_set) {
    redisClient.lrange(helper.reconcile_data_node, 0, -1, function (err, reply) {
        maindataloop = reply;
        if (typeof maindataloop == "string") {
            maindataloop = JSON.parse(maindataloop);
        }
        for (var index = 0; index < maindataloop.length; index++) {
            element = maindataloop[index];
            for (var index2 = 0; index2 < element.length; index2++) {
                var element2 = element[index2];
                element[index2].is_eod_done = "y";
            }
            if (typeof element == "object") {
                redisClient.lset(helper.reconcile_data_node, index, JSON.stringify(element),
                    function (set_err, set_reply) {
                        console.log('************************************************');
                        console.log('index element', index, element);
                        console.log('************************************************');
                    });
            }
        }

    });
}


function pad(n, length) {
    var len = length - ('' + n).length;
    return (len > 0 ? new Array(++len).join('0') : '') + n
}

//The post method call HQ to activate mobile pending orders
router.post('/mobile_pending_orders', function (req, res, next) {
    // debug("*******************************mobile_pending_orders" + JSON.stringify(req.body));
    var hq_url = process.env.HQ_URL;
    var MOBILE_PENDING_URL = '/outlet_mobile/activate_mobile_order/';
    var outletid = req.body.outletid;
    var mobileno = req.body.mobileno;
    var referenceno = req.body.referenceno;

    request({
        url: hq_url + MOBILE_PENDING_URL,
        method: "POST",
        json: {
            "referenceno": referenceno,
            "mobileno": mobileno,
            "outletid": outletid
        }
    },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(body);
        });
});

function outlet_register(phases, isautomaticEOD) {
    var phase = phases;
    var hq_url = process.env.HQ_URL;
    var OUTLET_REGISTER_URL = hq_url + '/outlet_mobile/outlet_register_status';
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            request({
                url: OUTLET_REGISTER_URL,
                method: "POST",
                json: {
                    "phase": phase,
                    "outlet_id": process.env.OUTLET_ID,
                    "isautomaticEOD": isautomaticEOD
                }
            }, function (error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    var details = {
                        "phase": phases,
                        "suppplies": JSON.stringify(supplies),
                        "outlet_id": process.env.OUTLET_ID,
                        "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                        "apicalled": "automatic_sod_24hr_outlet"
                    };
                    redisClient.lpush(helper.outlet_register_status_node, details, function (err, reply) {
                        if (err) {
                            console.log('##############################');
                            console.log('erros in storing in redis ', err);
                            console.log('##############################');
                            return;
                        }
                    });
                    return;
                }
                //debug(body);
            });
        })
        .catch(function (err) {
            var details = {
                "phase": phases,
                "suppplies": JSON.stringify(supplies),
                "outlet_id": process.env.OUTLET_ID,
                "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                "apicalled": "automatic_sod_24hr_outlet"
            };
            redisClient.lpush(helper.outlet_register_status_node, details, function (err, reply) {
                if (err) {
                    console.log('##############################');
                    console.log('erros in storing in redis ', err);
                    console.log('##############################');
                    return;
                }
            });

        });
}

router.post('/automatic_sod_24hr_outlet', function (req, res, next) {
    var phase = 'sod';
    var hq_url = process.env.HQ_URL;
    var OUTLET_REGISTER_URL = hq_url + '/outlet_mobile/automatic_sod_24hr_outlet';
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            request({
                url: OUTLET_REGISTER_URL,
                method: "POST",
                maxAttempts: 5,
                json: {
                    "phase": phase,
                    "outlet_id": process.env.OUTLET_ID,
                    "userid": loggedinuserid
                }
            }, function (error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    calledon = {
                        "phase": "sod",
                        "outlet_id": process.env.OUTLET_ID,
                        "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                        "apicalled": "automatic_sod_24hr_outlet"
                    };

                    redisClient.lpush(helper.start_of_day_signal, JSON.stringify(calledon), function (err, reply) {
                        if (err) {
                            console.error("error while storing the start of the day storing on automatic_sod_24hr_outlet", err);
                            console.log("error while storing the start of the day storing on automatic_sod_24hr_outlet", err);
                            return;
                        }
                    });
                    return;
                }
            });
        })
        .catch(function (err) {
            calledon = {
                "phase": "sod",
                "outlet_id": process.env.OUTLET_ID,
                "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                "apicalled": "automatic_sod_24hr_outlet"
            };

            redisClient.lpush(helper.start_of_day_signal, JSON.stringify(calledon), function (err, reply) {
                if (err) {
                    console.error("error while storing the start of the day storing on automatic_sod_24hr_outlet", err);
                    console.log("error while storing the start of the day storing on automatic_sod_24hr_outlet", err);
                    return;
                }
            });
        });


    res.status(200).send('success');
    res.end();

});


//changes done by peerbits if offline then send the data after wards
//6 aug 2017


// This will signal the HQ that day has ended and return with a locked page
router.post('/end_of_day_signal', function (req, res, next) {
    var supplies = req.body.supplies;
    var isautomaticEOD = req.body.isautomaticEOD;
    if (!supplies) {
        res.status(400).send('Please fill the supplies field');
        return;
    }
    outlet_register("eod", isautomaticEOD);
    var checkinterneronline = true;
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            var hq_url = process.env.HQ_URL;
            var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status?phase=end_of_day';
            requestretry({
                url: SUPPLIES_STATUS_URL,
                method: "POST",
                json: {
                    "supplies": supplies,
                    "userid": loggedinuserid
                }
            }, function (error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    details = {
                        "phase": "eod",
                        "supplies": JSON.stringify(supplies),
                        "outlet_id": process.env.OUTLET_ID,
                        "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                        "apicalled": "automatic_sod_24hr_outlet"
                    };
                    redisClient.lpush(helper.store_eod_supplies_node, JSON.stringify(details), function (err, reply) {
                        if (err) {
                            console.log('##############################');
                            console.log('erros in storing in redis ', err);
                            console.log('##############################');
                            return;
                        }
                    });
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                //debug(body);
            });
            // Deleting the zero sales node
            redisClient.del(helper.zero_sales_count_node, function (del_err, del_reply) {
                if (del_err) {
                    console.error("error while deleting zero sales in redis- {}".format(b_err));
                    return;
                }
            });
            // Pre-Printed Code - End
            // Resetting the bill_no to 1 because its at the end of the day
            redisClient.set(helper.bill_no_node, 1, function (b_err, b_reply) {
                if (b_err) {
                    console.error("error while setting bill_no in redis- {}".format(b_err));
                    return;
                }
                redisClient.get(helper.dispense_id_node, function (dis_err, dis_reply) {
                    // Store the recovery details in the HQ
                    var UPDATE_RECOVERY_DETAILS_URL = hq_url + '/outlet/update_recovery_details/' + process.env.OUTLET_ID;
                    requestretry({
                        url: UPDATE_RECOVERY_DETAILS_URL,
                        method: "POST",
                        json: {
                            "bill_no": 1,
                            "dispense_id": JSON.parse(dis_reply)
                        }
                    }, function (error, response, body) {
                        if (error || (response && response.statusCode != 200)) {
                            console.error('{}: {} {}'.format(hq_url, error, body));
                            return;
                        }
                        debug("Updated HQ with the recovery details");
                    });
                });

                redisClient.del("loginuserdetails", function (del_err, del_reply) {
                    if (del_err) {
                        console.error("error while deleting loginuserdetails in redis- {}".format(b_err));
                        return;
                    }
                });
                redisClient.del("loginuserid", function (del_err, del_reply) {
                    if (del_err) {
                        console.error("error while deleting loginuserid in redis- {}".format(b_err));
                        return;
                    }
                });

                redisClient.del(helper.reconcile_summary_node, true, function (sod_err, sod_reply) {
                    if (sod_err) {
                        console.error("error while setting sod in redis- {}".format(sod_err));
                        res.status(500).send(sod_err);
                        return;
                    }
                });

                redisClient.del(helper.sales_summary_node, true, function (sod_err, sod_reply) {
                    if (sod_err) {
                        console.error("error while setting sod in redis- {}".format(sod_err));
                        res.status(500).send(sod_err);
                        return;
                    }
                });
                redisClient.del(helper.pending_done_node, function (del_err, del_reply) {
                    if (del_err) {
                        console.error("error while deleting pending_done_node in redis- {}".format(b_err));
                        return;
                    }
                });
                // Setting the start of day flag to true
                redisClient.set(helper.start_of_day_flag, true, function (sod_err, sod_reply) {
                    if (sod_err) {
                        console.error("error while setting sod in redis- {}".format(sod_err));
                        res.status(500).send(sod_err);
                        return;
                    }
                    res.send('success');
                });
            });

        })
        .catch(function (err) {
            details = {
                "phase": "eod",
                "supplies": JSON.stringify(supplies),
                "outlet_id": process.env.OUTLET_ID,
                "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                "apicalled": "automatic_sod_24hr_outlet"
            };
            redisClient.lpush(helper.store_eod_supplies_node, JSON.stringify(details), function (err, reply) {
                if (err) {
                    console.log('##############################');
                    console.log('erros in storing in redis ', err);
                    console.log('##############################');
                    return;
                }
            });
            // Deleting the zero sales node
            redisClient.del(helper.zero_sales_count_node, function (del_err, del_reply) {
                if (del_err) {
                    console.error("error while deleting zero sales in redis- {}".format(b_err));
                    return;
                }
            });
            // Pre-Printed Code - End
            // Resetting the bill_no to 1 because its at the end of the day
            redisClient.set(helper.bill_no_node, 1, function (b_err, b_reply) {
                if (b_err) {
                    console.error("error while setting bill_no in redis- {}".format(b_err));
                    return;
                }
                redisClient.get(helper.dispense_id_node, function (dis_err, dis_reply) {
                    // Store the recovery details in the HQ
                    var recovery_detail = {
                        "bill_no": 1,
                        "dispense_id": dis_reply,
                        "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),
                        "is_set_on_HQ": "false",
                    };
                    redisClient.lpush(helper.dispense_recovery_detail_node, JSON.stringify(recovery_detail), function (err, reply) {
                        if (err) {
                            console.error("recovery detail not stored from dispense_id_node signal", err);
                            return;
                        }
                    });
                });
                // start clearing summary queue
                redisClient.del(helper.reconcile_summary_node, true, function (sod_err, sod_reply) {
                    if (sod_err) {
                        console.error("error while setting sod in redis- {}".format(sod_err));
                        res.status(500).send(sod_err);
                        return;
                    }
                });

                redisClient.del(helper.sales_summary_node, true, function (sod_err, sod_reply) {
                    if (sod_err) {
                        console.error("error while setting sod in redis- {}".format(sod_err));
                        res.status(500).send(sod_err);
                        return;
                    }
                });
                // End deleteing the queue
                // Setting the start of day flag to true
                redisClient.set(helper.start_of_day_flag, true, function (sod_err, sod_reply) {
                    if (sod_err) {
                        console.error("error while setting sod in redis- {}".format(sod_err));
                        res.status(500).send(sod_err);
                        return;
                    }
                    res.send('success');
                });

            });
        });
});

router.post('/expire_all_items', function (req, res, next) {
    debug("Expiring all items in stock");
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res) {
        if (redis_err) {
            console.error(redis_err);
            return;
        }
        var parsed_response = JSON.parse(redis_res);
        for (var item_id in parsed_response) {
            var item_details = parsed_response[item_id]["item_details"];
            for (var i = 0; i < item_details.length; i++) {

                var current_barcode = item_details[i]["barcode"];
                var barcode_date = current_barcode.substring(16, 20) + "-" + current_barcode.substring(14, 16) + "-" + current_barcode.substring(12, 14);
                // new Date("2016-12-03") > new Date()

                // Donot update as "expired" for furture item barcodes 
                // If next day batch is 
                if (new Date(barcode_date) < new Date()) {
                    // If the item is already expired, no need to do anything
                    if (item_details[i]["expired"]) {
                        continue;
                    }
                    item_details[i]["expired"] = true;
                    // Pushing the data to redis to store the list of expired slots
                    var slots = item_details[i]["slot_ids"];
                    io.emit('expiry_slots', slots);
                    // Adding the list of expired slots to redis
                    redisClient.rpush(helper.expiry_slots_node, JSON.stringify(slots),
                        function (lp_err, lp_reply) {
                            if (lp_err) {
                                console.error(err);
                                return;
                            }
                        });
                }
            }
        }

        // push to redis
        redisClient.set(helper.stock_count_node,
            JSON.stringify(parsed_response),
            function (set_stock_count_err, set_stock_count_reply) {
                if (set_stock_count_err) {
                    console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                }
            });
        // get the lock counts
        var item_id_list = [];
        for (var item_id in parsed_response) {
            item_id_list.push(item_id + '_locked_count');
        }

        redisClient.mget(item_id_list, function (l_err, l_reply) {
            for (var item_id in parsed_response) {
                if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
                    parsed_response[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                } else {
                    parsed_response[item_id]["locked_count"] = 0;
                }
            }
            // Sending the data to the socket.io channel
            io.emit(helper.stock_count_node, parsed_response);
            io.sockets.emit(helper.stock_count_node, parsed_response);
            internetAvailable({
                timeout: 1000,
                retries: 3,
            })
                .then(function () {
                    // Put the data in firebase
                    var rootref = new firebase(process.env.FIREBASE_CONN);
                    var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                    stock_count_node.set(parsed_response);
                })
                .catch(function (err) {
                    parsed_response.is_set_on_HQ = "false";
                    parsed_response.time = moment.utc().format('YYYY-MM-DD HH:mm:ss');
                    redis.lpush(helper.firebase_data_to_send_node, JSON.stringify(parsed_response), function (error, reply) {
                        if (err) {
                            console.log('##############################');
                            console.log('data cannot be send to redis', err);
                            console.log('##############################');
                        }
                    });
                });



        });
    });
    res.send("success");
});

router.post('/store_last_load_infoold', function (req, res, next) {
    var po_id = req.body.po_id;
    var batch_id = req.body.batch_id;
    var rest_id = req.body.rest_id;
    var reconcile_items = req.body.reconcile_items;

    // update HQ that this batch has been received
    var hq_url = process.env.HQ_URL;
    var UPDATE_RECEIVED_TIME_URL = hq_url + '/outlet/update_received_time/' + process.env.OUTLET_ID;
    requestretry({
        url: UPDATE_RECEIVED_TIME_URL,
        method: "POST",
        json: {
            "po_id": po_id,
            "batch_id": batch_id,
            "rest_id": rest_id,
            "reconcile_items": reconcile_items
        }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        //debug(body);
    });

    // update redis with the last load info
    redisClient.get(helper.last_load_tmp_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send("error while last load info from redis- {}".format(err));
            return;
        }
        var parsed_response = JSON.parse(reply);
        if (parsed_response === null) {
            parsed_response = {};
        }
        parsed_response[rest_id] = [{
            "po_id": po_id,
            "batch_id": batch_id
        }];
        redisClient.set(helper.last_load_tmp_node, JSON.stringify(parsed_response), function (err, reply) {
            if (err) {
                console.error(err);
                return res.status(500).send(err);
            }
            res.send('success');
        });
    });
    // get_matrix_code(batch_id);
});



router.post('/store_last_load_info', function (req, res, next) {
    var po_id = req.body.po_id;
    var batch_id = req.body.batch_id;
    var rest_id = req.body.rest_id;
    var reconcile_items = req.body.reconcile_items;
    console.log("AutomaticReconcile function :: IncomingPOProcess:: function end  ################################################### reconcile_items:: " + JSON.stringify(reconcile_items));
    // update HQ that this batch has been received
    var hq_url = process.env.HQ_URL;
    var UPDATE_RECEIVED_TIME_URL = hq_url + '/outlet/update_received_time/' + process.env.OUTLET_ID;
    /* rajesh==> may be we need to add the connection code here and
    
                if not connection then need to add the success for execute below function
                    peerbits
                for updating on hq this is the  main url
            */
    /*inherited  from indras function*/
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            console.log("AutomaticReconcile function :: IncomingPOProcess:: function end  ################################################### reconcile_items:: " + JSON.stringify(reconcile_items));
            requestretry({
                url: UPDATE_RECEIVED_TIME_URL,
                method: "POST",
                json: {
                    "po_id": po_id,
                    "batch_id": batch_id,
                    "rest_id": rest_id,
                    "reconcile_items": reconcile_items,
                    "userid": loggedinuserid
                }
            }, function (error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    local_last_load_data = {
                        "po_id": po_id,
                        "is_set_on_HQ": 'n',
                        "batch_id": batch_id,
                        "rest_id": rest_id,
                        "reconcile_items": reconcile_items,
                        "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),

                    }

                    redisClient.lpush(helper.reconcile_data_last_load_node, JSON.stringify(local_last_load_data), function (err, reply) {
                        if (err) {
                            console.error("error while storing the data for the last load stock reconcile", err);
                            return;
                        } else {
                            console.error("data stored from last load info");
                        }
                    });
                    return;
                }
                //debug(body);
            });
        })
        .catch(function (err) {
            local_last_load_data = {
                "po_id": po_id,
                "is_set_on_HQ": 'n',
                "batch_id": batch_id,
                "rest_id": rest_id,
                "reconcile_items": reconcile_items,
                "time": moment.utc().format('YYYY-MM-DD HH:mm:ss'),

            }

            redisClient.lpush(helper.reconcile_data_last_load_node, JSON.stringify(local_last_load_data), function (err, reply) {
                if (err) {
                    console.error("error while storing the data for the last load stock reconcile", err);
                    return;
                } else {
                    console.error("data stored from last load info");
                }
            });
        });

    /*previouse code */
    // requestretry({
    //     url: UPDATE_RECEIVED_TIME_URL,
    //     method: "POST",
    //     json: { "po_id": po_id, "batch_id": batch_id, "rest_id": rest_id, "reconcile_items": reconcile_items }
    // }, function(error, response, body) {
    //     if (error || (response && response.statusCode != 200)) {
    //         console.error('{}: {} {}'.format(hq_url, error, body));
    //         return;
    //     }
    //     //debug(body);
    // });
    /*end previouse code */

    // update redis with the last load info
    redisClient.get(helper.last_load_tmp_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send("error while last load info from redis- {}".format(err));
            return;
        }
        var parsed_response = JSON.parse(reply);
        if (parsed_response === null) {
            parsed_response = {};
        }
        parsed_response[rest_id] = [{
            "po_id": po_id,
            "batch_id": batch_id
        }];
        console.log('##############################');
        console.log('parsed response' + JSON.stringify(parsed_response));
        console.log('##############################');

        redisClient.set(helper.last_load_tmp_node, JSON.stringify(parsed_response), function (err, reply) {
            if (err) {
                console.error(err);
                return res.status(500).send(err);
            }
            res.send('success');
        });
    });
    // get_matrix_code(batch_id);
});

router.post('/mark_po_received', function (req, res, next) {
    var allItems = req.body;
    var hq_url = process.env.HQ_URL;
    var UPDATE_RECEIVED_TIME_URL = hq_url + '/outlet/update_received_time/' + process.env.OUTLET_ID;

    allItems.map(function (item) {
        requestretry({
            url: UPDATE_RECEIVED_TIME_URL,
            method: "POST",
            json: {
                "po_id": item.po_id,
                "batch_id": item.batch_id,
                "rest_id": item.rest_id,
                "userid": loggedinuserid
            }
        }, function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            //debug(body);
        });
    });

    // deleting the last load info node
    redisClient.del(helper.last_load_info_node,
        function (set_err, set_reply) {
            if (set_err) {
                return debug(set_err);
            }
            debug("Deleted the last load info node");
            res.send('success');
        });
});

// This call contacts the HQ and returns the list of food_item issues
router.get('/food_item_issues', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var time = req.query.time;
    var GET_FOOD_ITEM_ISSUES_URL = '/outlet/food_item_issues/';
    var outlet_id = process.env.OUTLET_ID;

    // request(hq_url + GET_FOOD_ITEM_ISSUES_URL + outlet_id + '?time=' + time,
    //     { forever: true },
    //     function (error, response, body) {
    //         if (error || (response && response.statusCode != 200)) {
    //             console.error('{}: {} {}'.format(hq_url, error, body));
    //             res.status(500).send('{}: {} {}'.format(hq_url, error, body));
    //             return;
    //         }
    //         res.send(JSON.parse(body));
    //     });

    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {

            searchFoodIssueDocument(time, function (err, reply2) {
                if (reply2 != null || typeof reply2 != "undefined") {

                    reply2 = JSON.parse(reply2);
                    for (var index = 0; index < reply2.length; index++) {
                        var element = reply2[index];
                        reply2[index].green_signal_time = element.inserttime;
                    }
                    res.send(reply2);
                } else {
                    request(hq_url + GET_FOOD_ITEM_ISSUES_URL + outlet_id + '?time=' + time, {
                        timeout: 1500
                    },
                        function (error, response, body) {
                            if (error || (response && response.statusCode != 200)) {
                                console.error('{}: {} {}'.format(hq_url, error, body));
                                //res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                                searchFoodIssueDocument(time, function (err, reply1) {
                                    res.send(JSON.parse(reply1));
                                });
                                return;
                            }
                            inserttime = moment.utc().format("YYYY-MM-DD HH:mm:ss");
                            body = JSON.parse(body);
                            insertUpdateFoodIssueDocument(body, inserttime, true, function (err, reply) {
                                if (err) {
                                    console.log('##############################');
                                    console.log('err', err);
                                    console.log('##############################');
                                }
                                searchFoodIssueDocument(time, function (err, reply1) {
                                    reply1 = JSON.parse(reply1);
                                    for (var index = 0; index < reply1.length; index++) {
                                        var element = reply1[index];
                                        reply1[index].green_signal_time = element.inserttime;
                                    }
                                    res.status(200).contentType("application/json").send(reply1);
                                });
                            });
                        });

                }
            });

        })
        .catch(function (err) {
            console.log('##############################');
            console.log('offline data time', new Date());
            console.log('##############################');
            searchFoodIssueDocument(time, function (err, reply1) {
                if (err) {
                    console.log('##############################');
                    console.log('error', err);
                    console.log('##############################');
                    res.send("");
                    return;
                }
                reply1 = JSON.parse(reply1);
                for (var index = 0; index < reply1.length; index++) {
                    var element = reply1[index];
                    reply1[index].green_signal_time = element.inserttime;
                }
                //res.send(reply1);
                res.status(200).contentType("application/json").send(reply1);
            });

        });
});


function searchFoodIssueDocument(inserttime, callback) {
    obj = {
        inserttime: new RegExp(inserttime, "i")
    };
    console.log('##############################');
    console.log('obj', obj);
    console.log('##############################');

    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false,
        repoter: false,
    };
    FoodIssueModel.find(obj, fields, {
        sort: {
            inserttime: -1
        }
    }, function (err, issues) {
        if (err) {
            console.log('##############################');
            console.log('error', err);
            console.log('##############################');
        }

        issues = JSON.stringify(issues);
        // object of all the users
        callback(null, issues);
    });
}
// This call contacts the HQ and returns the list of non_food_item issues
router.get('/non_food_item_issues', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var time = req.query.time;
    var GET_NONFOOD_ITEM_ISSUES_URL = '/outlet/non_food_item_issues/';
    var outlet_id = process.env.OUTLET_ID;
    //changes done by the peerbits 10 aug to make non food item issues work offline 
    //date 10-Aug-2017
    console.log('##############################');
    console.log('hq_url' + hq_url);
    console.log('##############################');

    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            searchNonFoodIssueDocument(time, function (err, reply2) {
                if (reply2 != null || typeof reply2 != "undefined") {
                    res.send(JSON.parse(reply2));
                } else {
                    request(hq_url + GET_NONFOOD_ITEM_ISSUES_URL + outlet_id + '?time=' + time, {
                        maxAttempts: 5
                    },
                        function (error, response, body) {
                            if (error || (response && response.statusCode != 200)) {
                                console.error('{}: {} {}'.format(hq_url, error, body));
                                //res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                                searchNonFoodIssueDocument(time, function (err, reply1) {
                                    res.send(JSON.parse(reply1));
                                });
                                return;
                            }
                            inserttime = moment.utc().format("YYYY-MM-DD HH:mm:ss");
                            insertUpdateNonFoodIssueDocument(body, inserttime, true, function (err, reply) {
                                if (err) {
                                    console.log('##############################');
                                    console.log('err', err);
                                    console.log('##############################');
                                }
                                searchNonFoodIssueDocument(time, function (err, reply1) {
                                    res.status(200).contentType("application/json").send(reply1);
                                });
                            });
                        });
                }
            });



        })
        .catch(function (err) {
            console.log('##############################');
            console.log('offline data time', new Date());
            console.log('##############################');
            searchNonFoodIssueDocument(time, function (err, reply1) {
                if (err) {
                    console.log('##############################');
                    console.log('error', err);
                    console.log('##############################');
                    res.send("");
                    return;
                }
                //res.send(reply1);
                res.status(200).contentType("application/json").send(reply1);
            });
        });

});

router.get('/food_item_list', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    async.parallel({
        food_item_list: function (callback) {
            internetAvailable({
                timeout: 1000,
                retries: 3,
            })
                .then(function () {
                    var hq_url = process.env.HQ_URL;
                    var GET_FOOD_ITEM_LIST_URL = '/outlet/food_item_list/';
                    var outlet_id = process.env.OUTLET_ID;
                    request(hq_url + GET_FOOD_ITEM_LIST_URL + outlet_id, {
                        timeout: 1500
                    },
                        function (error, response, body) {
                            console.log('************************************************');
                            console.log('error', error);
                            console.log('************************************************');

                            if (error || (response && response.statusCode != 200)) {
                                //callback('{}: {} {}'.format(hq_url, error, body), null);
                                redisClient.get(helper.food_item_list_node, function (error, reply) {
                                    if (reply == null) {
                                        reply = "{}";
                                    }
                                    console.log('************************************************');
                                    console.log('reply', reply);
                                    console.log('************************************************');
                                    callback(null, JSON.parse(reply));
                                });
                                return;
                            }
                            redisClient.set(helper.food_item_list_node, body, function (error, reply) {
                                if (error) {
                                    console.log('##############################');
                                    console.log('error', error);
                                    console.log('##############################');
                                }
                                callback(null, JSON.parse(body));
                                return;
                            });
                        });
                })
                .catch(function (err) {
                    redisClient.get(helper.food_item_list_node, function (error, reply) {
                        if (reply == null) {
                            reply = "{}";
                        }
                        callback(null, JSON.parse(reply));
                    });
                });

        },
        non_food_types: function (callback) {
            internetAvailable({
                timeout: 1000,
                retries: 3,
            })
                .then(function () {
                    var hq_url = process.env.HQ_URL;
                    var GET_NON_FOOD_TYPES_URL = '/outlet/non_food_types';

                    request(hq_url + GET_NON_FOOD_TYPES_URL, {
                        timeout: 1500
                    },
                        function (error, response, body) {
                            console.log('************************************************');
                            console.log('error', error);
                            console.log('************************************************');
                            if (error || (response && response.statusCode != 200)) {
                                //callback('{}: {} {}'.format(hq_url, error, body), null);
                                redisClient.get(helper.non_food_item_list_node, function (error, reply) {
                                    if (reply == null) {
                                        reply = "{}";
                                    }
                                    callback(null, reply);
                                });
                                return;
                            }
                            redisClient.set(helper.non_food_item_list_node, body, function (error, reply) {
                                if (error) {
                                    console.log('##############################');
                                    console.log('error', error);
                                    console.log('##############################');
                                }
                                callback(null, body);
                                return;
                            });
                        });
                })
                .catch(function (err) {

                    redisClient.get(helper.non_food_item_list_node, function (error, reply) {
                        if (reply == null) {
                            reply = "{}";
                        }
                        callback(null, reply);
                    });
                });

        },
    }, function (err, results) {
        if (err) {
            console.error(err);
            res.status(500).send(err);
            return;
        }
        var food_item_list = results.food_item_list;
        var non_food_types = results.non_food_types;
        res.send({
            "food_item_list": food_item_list,
            "non_food_types": non_food_types
        });
    });
});



router.post('/update_item_issues', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var UPDATE_ITEM_ISSUES_URL = '/outlet/update_item_issues/';
    var outlet_id = process.env.OUTLET_ID;
    var barcode_details = req.body.barcode_details;
    var non_food_issue = req.body.non_food_issue;

    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            is_set_on_HQ = true;


            var options = {
                method: 'POST',
                uri: hq_url + UPDATE_ITEM_ISSUES_URL + outlet_id,
                body: {
                    "barcode_details": barcode_details,
                    "non_food_issue": non_food_issue
                },
                json: true,
                timeout: 1500,
                // JSON stringifies the body automatically
            };

            request(options,
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        console.error('{}: {} {}'.format(hq_url, error, body));
                        // res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                        // return;
                        is_set_on_HQ = false;
                    }
                    if (barcode_details.length > 0) {
                        saveFoodIssue(barcode_details, is_set_on_HQ,
                            function (err, reply) {
                                res.send(reply);
                                return;
                            });
                    } else {
                        saveNONFoodIssue(non_food_issue, is_set_on_HQ,
                            function (err, reply) {
                                res.send(reply);
                                return;
                            });
                    }
                });
        })
        .catch(function (err) {
            if (barcode_details.length > 0) {
                saveFoodIssue(barcode_details, false, function (err, reply) {
                    res.send(reply);
                });
            } else {
                saveNONFoodIssue(non_food_issue, false,
                    function (err, reply) {
                        res.send(reply);
                    });
            }
        });
});



function saveFoodIssue(main_barcode_details, is_set_on_HQ, callback) {
    main_barcode_details.forEach(function (barcode_details) {
        body = {};
        is_set_on_HQ = is_set_on_HQ;
        body.barcode = barcode_details.barcode;
        body.final_status = barcode_details.final_status;
        body.problem = barcode_details.problem;
        body.note = barcode_details.note;
        body.count = barcode_details.count;
        body.inserttime = JSON.parse(JSON.stringify(new Date()));
        body.is_set_on_HQ = is_set_on_HQ;


        search_order_by_barcode(body.barcode, function (error, order) {
            body.name = order[0].name;
            console.log('##############################');
            console.log('order', order);
            console.log('##############################');
            console.log('##############################');
            console.log('body', body);
            console.log('##############################');
            insertUpdateFoodIssueDocument(body, body.inserttime, body.is_set_on_HQ, function (error, reply) {
                if (error) {
                    console.log('##############################');
                    console.log('error', error);
                    console.log('##############################');
                }
                callback(null, "success");
            });
        });
    });
}

function search_order_by_barcode(barcode, callback) {
    obj = {
        barcode: new RegExp(barcode)
    };

    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false,
    };
    var sort = {
        "sort": {
            "time": -1
        }
    };
    console.log('##############################');
    console.log('serach objec ', obj);
    console.log('##############################');

    OrderItemModel.find(obj, fields, sort, function (err, orderitem) {
        if (err) {
            console.log('##############################');
            console.log('error', err);
            console.log('##############################');
        };
        console.log('##############################');
        console.log('serach orderitem ', orderitem);
        console.log('##############################');

        // orderitem = JSON.stringify(orderitem);
        // object of all the orderitems
        callback(null, orderitem);
    });
}

function insertUpdateFoodIssueDocument(body, inserttime, is_sent_to_HQ, callback) {
    console.log('##############################');
    console.log('body typeof length', body, typeof body, body.length);
    console.log('##############################');
    if (typeof body != "undefined") {
        searchissue = {};
        searchissue.barcode = body.barcode;
        newissue = Object.assign(body, FoodIssueModel._doc);
        newissue.inserttime = inserttime;
        newissue.is_sent_to_HQ = is_sent_to_HQ;
        FoodIssueModel.findOneAndUpdate(
            searchissue,
            newissue, {
                upsert: true,
                new: true
            },
            function (error, reply) {
                if (error) {
                    console.log('##############################');
                    console.log('error', error);
                    console.log('##############################');
                }
                callback(null, "sucess");
            }
        );
    } else {
        callback(null, "sucess");
    }



}

router.get('/get_sales_info_cashcard', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var AMOUNT_SOLD_CASHCARD_URL = '/outlet/getcashcard_sales_daymonth/';
    var outlet_id = process.env.OUTLET_ID;
    console.log("get_sales_info_cashcard :=", hq_url + AMOUNT_SOLD_CASHCARD_URL + outlet_id);
    today = new Date().toISOString().slice(0, 10);
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            console.log("get_sales_info_cashcard :=", hq_url + AMOUNT_SOLD_CASHCARD_URL + outlet_id);

            search_cashdetail(today, function (error, reply) {
                if (error) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                if (typeof reply[0] != "undefined") {
                    res.send(reply[0]);
                    return;
                } else {
                    request(hq_url + AMOUNT_SOLD_CASHCARD_URL + outlet_id, {
                        timeout: 10000
                    },
                        function (error, response, body) {
                            if (error || (response && response.statusCode != 200)) {
                                search_cashdetail(today, function (error, reply) {

                                    if (error) {
                                        console.error('{}: {} {}'.format(hq_url, error, body));
                                        res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                                        return;
                                    }
                                    if (typeof reply[0] != "undefined") {
                                        res.send(reply[0]);
                                        return;
                                    } else {
                                        console.error('{}: {} {}'.format(hq_url, error, body));
                                        res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                                        return;
                                    }

                                });
                            }
                            console.log('************************************************');
                            console.log('hq ', hq_url + AMOUNT_SOLD_CASHCARD_URL + outlet_id);
                            console.log('************************************************');

                            if (typeof body != "undefinded" && body != "") {
                                saveCashDetail(body, true, function (error, reply) {
                                    if (error) {
                                        console.error('{}: {} {}'.format(hq_url, error, body));
                                        res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                                        return;
                                    } else {
                                        res.send(reply);
                                        return;
                                    }
                                });
                            } else {
                                search_cashdetail(today, function (error, reply) {
                                    if (error) {
                                        console.error('{}: {} {}'.format(hq_url, error, body));
                                        res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                                        return;
                                    }
                                    if (typeof reply[0] != "undefined") {
                                        res.send(reply[0]);
                                        return;
                                    } else {
                                        console.error('{}: {} {}'.format(hq_url, error, body));
                                        res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                                        return;
                                    }

                                });
                            }

                        });
                }

            });
        })
        .catch(function (err) {
            search_cashdetail("", function (error, reply) {
                if (error) {
                    console.error('{}: {} {}'.format(hq_url, error));
                    res.status(500).send('{}: {} {}'.format(hq_url, error));
                    return;
                }
                if (typeof reply[0] != "undefined") {
                    res.send(reply[0]);
                    return;
                } else {
                    cashdetail = null;
                    saveCashDetail(JSON.stringify(cashdetail), false, function (error, reply) {
                        if (error) {
                            console.error('{}: {} {}'.format(hq_url, error, body));
                            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                            return;
                        } else {
                            res.send(reply);
                            return;
                        }
                    });
                }

            });
        });

});

function search_cashdetail(today, callback) {

    if (typeof today != "undefined" && today != "") {
        obj = {
            outlet_id: parseInt(process.env.OUTLET_ID),
            'time': new RegExp(today, "i")
        };
    } else {
        obj = {
            outlet_id: parseInt(process.env.OUTLET_ID)
        };
    }

    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false,
    };
    var sort = {};
    CashDetailModel.find(obj, fields, sort, function (err, cashdetail) {
        if (err) {
            console.log('##############################');
            console.log('error', err);
            console.log('##############################');
        };
        // cashdetail = JSON.stringify(cashdetail);
        // object of all the users
        callback(null, cashdetail);
    });
}

function saveCashDetail(body, set_to_HQ, callback) {
    if (body != null && typeof body != "undefined") {
        if (typeof body == "string") {
            cashdetail = JSON.parse(body);
        } else {
            cashdetail = body;
        }
        cashdetail = Object.assign(cashdetail, CashDetailModel._doc);
        cashdetail.is_sent_to_HQ = set_to_HQ;
        cashdetail.time = JSON.parse(JSON.stringify(new Date()));
        search_obj = {
            outlet_id: process.env.OUTLET_ID,
        };
        CashDetailModel.findOneAndUpdate(search_obj, cashdetail, {
            upsert: true,
            new: true
        }, function (error, reply) {
            if (error) {
                console.log('##############################');
                console.log('error', error);
                console.log('##############################');
                callback(error, null);
                return;
            }
            callback(null, reply);
        });
    }

}
// get no. of items sold since sod for food and other items
// get amount sold through cash since sod
// get amount sold in petty cash since sod
// get amount sold in food and snacks/drinks in that month
router.get('/get_sales_info', function (req, res, next) {
    // Doing an async parallel call to get the different infos
    async.parallel({
        amount_sold_cash: function (callback) {
            // This is the amount given to them at the start of the month
            var AMOUNT_SOLD_CASH_URL = '/outlet/amount_for_month/' + process.env.OUTLET_ID;
            console.log("amount_sold_cash url:-", process.env.HQ_URL + AMOUNT_SOLD_CASH_URL);
            internetAvailable({
                timeout: 1000,
                retries: 3,
            }).then(function () {
                request(process.env.HQ_URL + AMOUNT_SOLD_CASH_URL, {
                    timeout: 1500
                },
                    function (error, response, body) {
                        if (error || (response && response.statusCode != 200)) {
                            //callback('{}: {} {}'.format(process.env.HQ_URL, error, body), null);
                            redisClient.get(helper.outlet_config_node, function (error, reply) {
                                if (error) {
                                    callback(null, {
                                        "sum": 0
                                    });
                                } else {
                                    outlet_config = JSON.parse(reply);
                                    ammout = outlet_config.cash_at_start;
                                    callback(null, {
                                        "sum": ammout
                                    });
                                }

                            });
                            return;
                        } else {
                            if (!body) {
                                callback(null, {
                                    "sum": 0
                                });
                            } else {
                                callback(null, JSON.parse(body));
                            }
                        }
                    });
            }).catch(function () {
                redisClient.get(helper.outlet_config_node, function (error, reply) {
                    if (error) {
                        callback(null, {
                            "sum": 0
                        });
                    } else {
                        outlet_config = JSON.parse(reply);
                        ammout = outlet_config.cash_at_start;
                        callback(null, {
                            "sum": ammout
                        });
                    }

                });
            });

        },
        amount_sold_cashcard: function (callback) {
            // This is the amount given to them at the start of the month
            var AMOUNT_SOLD_CASHCARD_URL = '/outlet/getcashcard_sales_daymonth/' + process.env.OUTLET_ID;
            console.log("AMOUNT_SOLD_CASHCARD_URL :-", AMOUNT_SOLD_CASHCARD_URL);
            request(process.env.HQ_URL + AMOUNT_SOLD_CASHCARD_URL, {
                timeout: 1500
            },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        // callback('{}: {} {}'.format(process.env.HQ_URL, error, body), null);
                        callback(null, {
                            "sum": 0
                        });
                        return;
                    }
                    if (!body) {
                        callback(null, {
                            "sum": 0
                        });
                    } else {
                        callback(null, JSON.parse(body));
                    }
                });
        },
        amount_sold_pettycash: function (callback) {
            // This is the amount sold in petty cash for that month
            var AMOUNT_SOLD_PETTY_CASH_URL = '/outlet/amount_sold_pettycash/' + process.env.OUTLET_ID;
            request(process.env.HQ_URL + AMOUNT_SOLD_PETTY_CASH_URL, {
                timeout: 1500
            },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        //callback('{}: {} {}'.format(process.env.HQ_URL, error, body), null);
                        callback(null, {
                            "sum": 0
                        });
                        return;
                    }
                    if (!body) {
                        callback(null, {
                            "sum": 0
                        });
                    } else {
                        callback(null, JSON.parse(body));
                    }
                });
        },
        dataforpeetycashonlocal: function (callback) {
            redisClient.get(helper.petty_cash_node, function (error, reply) {
                if (reply != null) {
                    reply = JSON.parse(reply);
                    callback(null, reply);
                    return;
                } else {
                    callback(null, []);
                    return;
                }

            })
        },
        petty_cash_to_HQ_node: function (callback) {
            redisClient.lrange(helper.petty_cash_to_HQ_node, 0, -1, function (error, reply) {
                if (reply != null) {
                    callback(error, reply);
                } else {
                    callback(null, []);
                }
            });
        }
    },
        function (err, results) {

            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }
            dataforpeetycashonlocal = results.dataforpeetycashonlocal;
            if (typeof dataforpeetycashonlocal != "undefinded" || dataforpeetycashonlocal != null) {
                total = 0;
                //dataforpeetycashonlocal = JSON.parse(dataforpeetycashonlocal);
                for (var index = 0; index < dataforpeetycashonlocal.length; index++) {
                    var element = dataforpeetycashonlocal[index];
                    total += element.amount;
                }
                petty_cash_to_HQ_node = results.petty_cash_to_HQ_node;
                for (var index2 = 0; index2 < petty_cash_to_HQ_node.length; index2++) {
                    var element2 = JSON.parse(petty_cash_to_HQ_node[index2]);
                    total += element2.amount;
                }
                results.amount_sold_pettycash = {
                    "sum": total
                };
            }
            // console.log('************************************************');
            // console.log('petty_cash_to_HQ_node', petty_cash_to_HQ_node);
            // console.log('************************************************');

            res.send(results);
        });
});

router.get('/get_live_pos', function (req, res, next) {
    console.log("in get get_live_pos ");
    var hq_url = process.env.HQ_URL;
    var UPDATE_ITEM_ISSUES_URL = '/outlet/get_live_pos/';
    var outlet_id = process.env.OUTLET_ID;
    request(hq_url + UPDATE_ITEM_ISSUES_URL + outlet_id, {
        forever: true
    },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(body);
        });
});


router.get('/get_offline_pos', function (req, res, next) {
    console.log("in get offline pos");

    internetAvailable({
        timeout: 1000,
        retries: 3,
    }).then(function () {

        var hq_url = process.env.HQ_URL;
        var UPDATE_ITEM_ISSUES_URL = '/outlet/get_live_pos/';
        var outlet_id = process.env.OUTLET_ID;
        var data = {};
        request(hq_url + UPDATE_ITEM_ISSUES_URL + outlet_id, {
            timeout: 5000
        }, function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(body);


        });
    }).catch(function () {
        getOfflineReconsilecount(function (error, reply) {
            res.send(reply);
            return;
        });
    });
});


function getOfflineReconsilecount(callback) {
    redisClient.lrange(helper.reconcile_data_node, 0, -1, function (err, reply) {
        maindata = {};
        maindata.count = 0;
        maindataarray = [];
        main_po_ids = [];
        currentdate = new Date().toISOString().slice(0, 10);
        if (reply != null && typeof reply == "string") {
            reply = JSON.parse(reply);
        }
        if (reply != null) {
            for (var index = 0; index < reply.length; index++) {
                var element = JSON.parse(reply[index]);
                if (typeof element[0] != "undefined" && element[0].is_eod_done == 'n' && element[0].date == currentdate && main_po_ids.indexOf(element[0].po_id) == -1) {
                    maindata.count = maindata.count + 1;
                    main_po_ids.push(element[0].po_id);
                }
            }
        }

        callback(null, maindata);
    });
}


// Handler to keep track of the petty cash expenditure by the outlet staff
router.post('/petty_expenditure', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var PETTY_EXPENDITURE_URL = '/outlet/petty_expenditure/';
    var outlet_id = process.env.OUTLET_ID;

    internetAvailable({
        timeout: 1000,
        retries: 1,
    })
        .then(function () {
            requestretry({
                url: hq_url + PETTY_EXPENDITURE_URL + outlet_id,
                timeout: 1500,
                method: "POST",
                json: {
                    "data": req.body.data
                }
            },
                function (error, response, body) {
                    // if (error || (response && response.statusCode != 200)) {
                    //     console.error('{}: {} {}'.format(hq_url, error, body));
                    //     save_data_for_petty_cash(req.body.data);
                    //     res.send("success");
                    //     return;
                    // }
                    // save_data_for_petty_cash(req.body.data);
                    // res.send(body);
                    save_data_for_petty_cash(req.body.data);
                    res.send("success");
                });
        })
        .catch(function (err) {
            save_data_for_petty_cash(req.body.data);
            res.send("success");
        });

});

function save_data_for_petty_cash(data) {
    if (typeof data == "string") {
        data = JSON.parse(data);
    }
    maindata = data;
    maindata.time = new Date();
    redisClient.rpush(helper.petty_cash_to_HQ_node, JSON.stringify(maindata), function (err, reply) {
        if (err) {
            console.log('##############################');
            console.log('err', err);
            console.log('##############################');
        }
    });
}

// Handler that returns the list of names to the outlet dash
router.get('/staff_roster', function (req, res, next) {
    var STAFF_ROSTER_URL = '/outlet/staff_roster/' + process.env.OUTLET_ID;
    // requesting the HQ to get the staff list 
    // Date 29-JULY-2017
    // Made changes for making staff roster details on the local
    // request(process.env.HQ_URL + STAFF_ROSTER_URL,
    //     { forever: true },
    //     function (error, response, body) {
    //         if (error || (response && response.statusCode != 200)) {
    //             console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
    //             res.status(500).send('{}: {} {}'.format(process.env.HQ_URL, error, body));
    //             return;
    //         }
    //         res.send(JSON.parse(body));
    //     });

    redisClient.get(helper.staff_roaster_node, function (err, body) {
        if (err) {
            console.error("not found staff roaster detail");
            res.status(500).send('not found staff roaster detail');
            return;
        }
        res.send(JSON.parse(body));
    });

});
//old api to send the data to HQ
// date 31-july-2017
// router.post('/staff_roster', function (req, res, next) {
//     var STAFF_ROSTER_URL = '/outlet/staff_roster/' + process.env.OUTLET_ID;
//     requestretry({
//         url: process.env.HQ_URL + STAFF_ROSTER_URL,
//         method: "POST",
//         forever: true,
//         json: { "data": req.body.data }
//     },
//     function (error, response, body) {
//         if (error || (response && response.statusCode != 200)) {
//             console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
//             res.status(500).send('{}: {} {}'.format(process.env.HQ_URL, error, body));
//             return;
//         }
//         res.send(body);
//     });
// }   
//changes done to store the details of the staff roaster offline 
router.post('/staff_roster', function (req, res, next) {
    var STAFF_ROSTER_URL = '/outlet/staff_roster/' + process.env.OUTLET_ID;

    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            requestretry({
                url: process.env.HQ_URL + STAFF_ROSTER_URL,
                method: "POST",
                forever: true,
                json: {
                    "data": req.body.data
                }
            },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                        save_staff_roster(req.body);
                        res.send("success");
                        return;
                    }
                    res.send(body);
                });
        })
        .catch(function (err) {
            save_staff_roster(req.body);
            res.send("success");
        });

});

function save_staff_roster(recivedbody) {
    redisClient.get(helper.staff_roaster_node, function (err, body) {
        if (err) {
            console.error("not found staff roaster detail");
            res.status(500).send('not found staff roaster detail');
            return;
        }
        offline_data = JSON.parse(body);
        recived_data = recivedbody;
        offline_data.forEach(function (item, index) {
            if (item.id == recived_data.data.user_id) {
                offline_data[index].is_set_on_HQ = false;
                offline_data[index].shift = recived_data.data.shift;
                offline_data[index].time = new Date();
            }
        });
        redisClient.set(helper.staff_roaster_node, JSON.stringify(offline_data), function (err, reply) {
            if (err) {
                console.error('error in setting staff roaster node '.err);
                return;
            }

        });
    });
}

// This handler passes the stop order command to the order app
router.post('/stop_orders', function (req, res, next) {
    redisClient.set(helper.stop_orders_flag,
        true,
        function (set_err, set_reply) {
            if (set_err) {
                console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                return;
            }
            io.emit('stop_orders', true);
            res.send('success');
        });
});

// This handler passes the stop order command to the order app
router.post('/resume_orders', function (req, res, next) {
    redisClient.set(helper.stop_orders_flag,
        false,
        function (set_err, set_reply) {
            if (set_err) {
                console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                return;
            }
            io.emit('stop_orders', false);
            res.send('success');
        });
});

// Handler that returns the breakdown of the petty cash expenditure
// after getting it from the HQ
router.get('/petty_cash_breakdown', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var PETTY_CASH_URL = '/outlet/petty_cash_breakdown/' + process.env.OUTLET_ID;
    console.log('##############################');
    console.log('in petty cash funtion time', new Date());
    console.log('##############################');
    internetAvailable({
        timeout: 100,
        retries: 3,
    })
        .then(function () {

            request({
                url: hq_url + PETTY_CASH_URL,
                timeout: 1500
            },

                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                        getPettyCashOfflinedata("", false, function (err, reply) {
                            res.send(reply);
                            return;
                        });
                        return;
                    }
                    getPettyCashOfflinedata(body, true, function (err, reply) {
                        res.send(JSON.parse(reply));
                        return;
                    });
                });
        })
        .catch(function () {
            console.log('##############################');
            console.log('in petty cash catch time', new Date());
            console.log('##############################');

            getPettyCashOfflinedata("", false, function (err, reply) {
                res.send(reply);
                return;
            });
        });

});

function getPettyCashOfflinedata(body, online, callback) {

    async.parallel({
        now_data_to_show: function (callback2) {
            if (typeof body != "undefined" && body != "") {
                redisClient.set(helper.petty_cash_node, body, function (err, reply) {
                    if (err) {
                        console.log('##############################');
                        console.log('petty cash err', err);
                        console.log('##############################');
                    }
                    callback2(null, body);
                });
            } else {
                callback2(null, body);
            }

        },
        offline_data_to_show: function (callback4) {
            redisClient.get(helper.petty_cash_node, function (err, reply) {
                if (err) {
                    console.log('##############################');
                    console.log('petty cash err', err);
                    console.log('##############################');
                    callback4(err, null);
                }
                callback4(null, reply);
            });
        },
        offline_data_stored_to_show: function (callback3) {
            redisClient.lrange(helper.petty_cash_to_HQ_node, 0, -1, function (err, reply) {
                if (err) {
                    console.log('##############################');
                    console.log('petty cash err', err);
                    console.log('##############################');
                }
                callback3(null, reply);
            });
        },

    }, function (err, results) {

        if (online) {
            main_array = (typeof results.now_data_to_show != "undefined" && results.now_data_to_show.length > 0) ? JSON.parse(results.now_data_to_show) : [];
        } else {
            main_array = (typeof results.offline_data_to_show != "undefined" && results.offline_data_to_show.length > 0) ? JSON.parse(results.offline_data_to_show) : [];
        }
        if (typeof results.offline_data_stored_to_show != "undefined" && results.offline_data_stored_to_show.length > 0) {
            for (var index = 0; index < results.offline_data_stored_to_show.length; index++) {
                var element = JSON.parse(results.offline_data_stored_to_show[index]);
                item = {};
                item.amount = element.amount;
                item.note = element.note;
                if (element.time == "undefined") {
                    item.time = new Date();
                } else {
                    item.time = element.time;
                }

                main_array.unshift(item);
            }
        }
        callback(null, JSON.stringify(main_array));
    });
}

router.post('/expire_item_batch/:item_id', function (req, res, next) {
    // get the stock from redis
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res) {
        if (redis_err) {
            console.error(redis_err);
            res.status(500).send(redis_err);
            return;
        }
        var item_id = req.params.item_id;
        var parsed_response = JSON.parse(redis_res);
        // if stock[item_id] is present, expire all batches of it
        if (parsed_response.hasOwnProperty(item_id)) {
            var item_details = parsed_response[item_id]["item_details"];
            for (var i = 0; i < item_details.length; i++) {
                item_details[i]["expired"] = true;
                // Pushing the data to redis to store the list of expired slots
                var slots = item_details[i]["slot_ids"];
                io.emit('expiry_slots', slots);
                // Adding the list of expired slots to redis
                redisClient.rpush(helper.expiry_slots_node, JSON.stringify(slots),
                    function (lp_err, lp_reply) {
                        if (lp_err) {
                            console.error(err);
                            return;
                        }
                    });
            }
            // push to redis
            redisClient.set(helper.stock_count_node,
                JSON.stringify(parsed_response),
                function (set_stock_count_err, set_stock_count_reply) {
                    if (set_stock_count_err) {
                        console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                    }
                });
            // get the lock counts
            var item_id_list = [];
            for (var item_id in parsed_response) {
                item_id_list.push(item_id + '_locked_count');
            }

            redisClient.mget(item_id_list, function (l_err, l_reply) {
                for (var item_id in parsed_response) {
                    if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
                        parsed_response[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                    } else {
                        parsed_response[item_id]["locked_count"] = 0;
                    }
                }
                // Sending the data to the socket.io channel
                io.emit(helper.stock_count_node, parsed_response);
                io.sockets.emit(helper.stock_count_node, parsed_response);

                // Put the data in firebase
                var rootref = new firebase(process.env.FIREBASE_CONN);
                var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                stock_count_node.set(parsed_response);
                return res.send('success');
            });
        } else {
            return res.send('success');
        }
    });
});

// This will return the no. of unscanned slots for the outlet dash
router.get('/get_reconcile_stock_slots', function (req, res, next) {
    var slot_list = [];
    var stock_count = [];
    var scanned_reconcile_slotids = [];
    var unscanned_slots = [];
    var empty_slots = [];
    var item_name_slot_wise = {};
    var item_id_slot_wise = {};
    item_id_slot_wise.items = [];

    redisClient.get(helper.plc_config_node, function (err, reply) {
        if (err) {
            debug('error while retreiving from redis- {}'.format(err));
            res.status(500).send('redis down');
            return;
        }
        if (!reply) {
            return res.status(500).send("No plc config found");
        }
        var plc_config = JSON.parse(reply);
        var dispenser_slot_count = plc_config["dispenser_slot_count"];

        for (var i = 1; i <= dispenser_slot_count; i++) {
            slot_list.push(i);
        }
        // // Get the unscanned slots and last load info first
        redisClient.get(helper.stock_count_node,
            function (err, reply_stock_count_node) {
                if (err) {
                    console.error(err);
                    res.status(500).send(err);
                    return;
                }

                stock_count = JSON.parse(reply_stock_count_node);

                var item_data = [];
                var slot_ids = [];
                for (var key in stock_count) {
                    // ignore if the item is in test mode
                    if (isTestModeItem(Number(key))) {
                        continue;
                    }

                    // If there are no items, just continue
                    // var locked_count = reconcile_stock_count[key].locked_count;
                    if (stock_count[key]["item_details"] == undefined) {
                        continue;
                    }

                    if (stock_count) {

                        stock_count[key]["item_details"].map(function (item) {

                            if (item.slot_ids != undefined && item.slot_ids != null) {
                                if (item.slot_ids.length > 0) {

                                    // Normal Code - Start (Replaced for Pre-Printed)

                                    scanned_reconcile_slotids = scanned_reconcile_slotids.concat(item.slot_ids);
                                    var slot_items = {
                                        "slot_ids": item.slot_ids,
                                        "item_id": key
                                    };
                                    item_id_slot_wise.items.push(slot_items);

                                    // Normal Code - End (Replaced for Pre-Printed)

                                    // Pre-Printed Code - Start

                                    //for (var i = 0; i < item.slot_ids.length; i++) {
                                    //	if(item.slot_ids[i].slot_id != null && item.slot_ids[i].slot_id != undefined)
                                    //	{
                                    //    slot_ids.push(item.slot_ids[i].slot_id[0])
                                    //	}
                                    //}
                                    //scanned_reconcile_slotids = slot_ids;
                                    //var slot_items = { "slot_ids": slot_ids, "item_id": key };
                                    //item_id_slot_wise.items.push(slot_items);

                                    // Pre-Printed Code - End
                                }
                                // console.log("item_id_slot_wise ***************#################" + item_id_slot_wise.items.length);
                            }
                        });
                    }

                }

                empty_slots = slot_list.diff(scanned_reconcile_slotids);

                var scanned_min_value = Math.min.apply(Math, scanned_reconcile_slotids);
                var scanned_max_value = Math.max.apply(Math, scanned_reconcile_slotids);


                console.log("scanned_slots_with_itemnames: " + JSON.stringify(item_id_slot_wise));
                // console.log("empty_slots: " + empty_slots);
                // console.log("unscanned_slots: " + unscanned_slots);

                res.send({
                    "scanned_min_value": scanned_min_value,
                    "scanned_max_value": scanned_max_value,
                    "scanned_slots": scanned_reconcile_slotids,
                    "empty_slots": empty_slots,
                    "dispenser_slot_count": dispenser_slot_count,
                    "item_id_slot_wise": item_id_slot_wise
                });
            });
    });

});

router.get('/get_reconcile_stock_count_data', function (req, res, next) {
    var reconcile_stock_count = [];
    redisClient.get(helper.reconcile_stock_count_node,
        function (err, reply_reconcile_stock_count) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }

            reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);


            console.log("reconcile_stock_count: " + JSON.stringify(reconcile_stock_count));
            res.send({
                "reconcile_stock_count": reconcile_stock_count
            });
        });
});

router.get('/get_po_details', function (req, res, next) {

    try {
        var reconcile_stock_count = [];
        redisClient.get(helper.reconcile_stock_count_node,
            function (err, reply_reconcile_stock_count) {
                if (err) {
                    console.error("outlet_app.js :: get_po_details " + err);
                    res.status(500).send(err);
                    return;
                }

                reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);
                console.log("reconcile_stock_count: " + JSON.stringify(reconcile_stock_count));

                redisClient.get(helper.po_details_node, function (err, reply_po_details) {
                    if (err) {
                        debug('error while retreiving from redis- {}'.format(err));
                        return;
                    }

                    res.send({
                        "json_result": reply_po_details,
                        "reconcile_stock_count": reconcile_stock_count
                    });
                });
            });
    } catch (e) {
        console.log("outlet_app.js :: get_po_details " + e);
    }
});

router.post('/save_reconcile_dataold', function (req, res, next) {

    var reconcile_items = req.body.reconcile_items;

    console.log("outlet_app.js :: save_reconcile_data function called reconcile_items:: " + JSON.stringify(reconcile_items));

    if (reconcile_items.length > 0) {
        var hq_url = process.env.HQ_URL;
        var save_reconcile_data_url = hq_url + '/outlet/save_reconcile_data/';

        console.log("save_reconcile_data_url: " + save_reconcile_data_url);
        console.log("reconcile_items: " + JSON.stringify(reconcile_items));

        console.log("loggedinuserid :" + loggedinuserid);
        var userid = loggedinuserid;
        if (loggedinuserid == null || loggedinuserid == 0) {
            userid = 1;
        }
        request({
            url: save_reconcile_data_url,
            method: "POST",
            json: {
                "reconcile_items": reconcile_items,
                "userid": loggedinuserid
            }
        }, function (error, response) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(save_reconcile_data_url, error, ""));
                res.status(500).send('{}: {} {}'.format(save_reconcile_data_url, error, ""));
                return;
            }
            //debug(body);
        });
    }

    res.send("success");
});


router.post('/save_reconcile_data', function (req, res, next) {

    var reconcile_items = req.body.reconcile_items;
    console.log("outlet_app.js :: save_reconcile_data function called reconcile_items:: " + JSON.stringify(reconcile_items));

    if (reconcile_items.length > 0) {
        var hq_url = process.env.HQ_URL;
        var save_reconcile_data_url = hq_url + '/outlet/save_reconcile_data/';
        console.log('************************************************');
        console.log('reconcile_items', reconcile_items);
        console.log('************************************************');

        var userid = loggedinuserid;
        if (loggedinuserid == null || loggedinuserid == 0) {
            userid = 1;
        }
        if (typeof reconcile_items == "string") {
            reconcile_items = JSON.parse(reconcile_items);
        }
        for (var index = 0; index < reconcile_items.length; index++) {
            reconcile_items[index].userid = userid;
        }

        redisClient.lrange(helper.reconcile_summary_node, 0, -1, function (error, reconcile_Queue_Items) {
            if (error) {
                console.log('************************************************');
                console.log('error', error);
                console.log('************************************************');
            }

            redisClient.get(helper.offline_po_request_node, function (error, offline_incomming_po1) {
                if (error) {
                    console.log('************************************************');
                    console.log('error', error);
                    console.log('************************************************');
                }
                //Update user_Sales_summary
                var reconcileSummaryDetails = {};

                if (typeof offline_incomming_po1 == "string") {
                    offline_incomming_po1 = JSON.parse(offline_incomming_po1);
                }

                for (var index = 0; index < reconcile_items.length; index++) {
                    var flag = false;
                    var reconcile_Queue_Obj = {};
                    for (var i = 0; i < reconcile_Queue_Items.length; i++) {

                        reconcile_Queue_Obj = JSON.parse(reconcile_Queue_Items[i]);

                        console.log('*****************reconcile_Queue_Obj1**************************' + parseInt(reconcile_Queue_Obj.po_id));
                        console.log('*****************reconcile_Queue_Obj2**************************' + parseInt(reconcile_items[index].po_id));
                        console.log('*****************reconcile_Queue_Obj3**************************' + parseInt(reconcile_Queue_Obj.food_item_id));
                        console.log('*****************reconcile_Queue_Obj4**************************' + parseInt(reconcile_items[index].food_item_id));

                        if (parseInt(reconcile_Queue_Obj.po_id) == parseInt(reconcile_items[index].po_id)
                            && parseInt(reconcile_Queue_Obj.food_item_id) == parseInt(reconcile_items[index].food_item_id)) {
                            console.log('*************************TRUE***********************************');
                            flag = true;
                        }

                    }

                    if (flag == false) {
                        var key = parseInt(reconcile_items[index].po_id);
                        console.log('******************Key************************' + key);
                        console.log('******************Key************************' + offline_incomming_po1[key]);

                        for (var j = 0; j < offline_incomming_po1[key].length; j++) {
                            console.log('******************Inside************************');
                            if (offline_incomming_po1[key][j]["food_item_id"] == reconcile_items[index]["food_item_id"]) {
                                console.log('******************Inside1************************');
                                offline_incomming_po1[key][j].is_offline_reconcile_done = "y";
                                reconcileSummaryDetails = offline_incomming_po1[key][j];
                                reconcileSummaryDetails.po_id = parseInt(reconcile_items[index].po_id);
                                reconcileSummaryDetails.food_item_id = parseInt(reconcile_items[index].food_item_id);
                                reconcileSummaryDetails.userid = reconcile_items[index].userid;
                                reconcileSummaryDetails.scanned = parseInt(reconcile_items[index].scanned_qty);
                                reconcileSummaryDetails.unscanned = parseInt(reconcile_items[index].unscanned_qty);
                                reconcileSummaryDetails.damaged = parseInt(reconcile_items[index].damaged_qty);
                                reconcileSummaryDetails.expiry = parseInt(reconcile_items[index].expiry_qty);
                                reconcileSummaryDetails.undelivered = parseInt(reconcile_items[index].undelivered_qty);
                                reconcileSummaryDetails.restaurant_fault = parseInt(reconcile_items[index].rest_fault_qty);
                                reconcileSummaryDetails.taken = parseInt(reconcile_items[index].scanned_qty) + parseInt(reconcile_items[index].unscanned_qty); +parseInt(reconcile_items[index].damaged_qty) + parseInt(reconcile_items[index].expiry_qty);
                                redisClient.lpush(helper.reconcile_summary_node, JSON.stringify(reconcileSummaryDetails));
                                reconcile_Queue_Items.push(JSON.stringify(reconcileSummaryDetails));
                            }
                        }
                    }
                }
            });
        });

        /*BY RAJESH NEED TO ADD CODE FOR STORING REONCILE DATA TO OUR LOCAL STORAGE rajesh, peerbtis */
        /*END CODE OF RAJESH FOR THE RECONCILE DATA */
        /* date:6 - aug - 2017
            added code for offline checking
            here we are put the old code for sending data in offline mode
            rajesh,peerbtis
        */

        internetAvailable({
            timeout: 1000,
            retries: 3,
        })
            .then(function () {
                console.log('************************************************');
                console.log('in if condition');
                console.log('************************************************');

                save_offline_reconsile_info(reconcile_items);
                //sytem is online
                if (reconcile_items.length > 0) {
                    var hq_url = process.env.HQ_URL;
                    var save_reconcile_data_url = hq_url + '/outlet/save_reconcile_data/';
                    request({
                        url: save_reconcile_data_url,
                        method: "POST",
                        json: {
                            "reconcile_items": reconcile_items,
                        }
                    }, function (error, response) {
                        if (error || (response && response.statusCode != 200)) {
                            console.error('{}: {} {}'.format(save_reconcile_data_url, error, ""));
                            saveRecoonsileDataInOffice(reconcile_items, false)
                            res.status(500).send('{}: {} {}'.format(save_reconcile_data_url, error, ""));
                            return;
                        }
                        saveRecoonsileDataInOffice(reconcile_items, true)
                        //debug(body);
                        res.send("success");
                    });
                } else {
                    res.send("success");
                }


            })
            .catch(function (err) {
                //else condition we need to set the is_sent to hq yes here
                console.log("offline code executed==>rajesh");
                saveRecoonsileDataInOffice(reconcile_items, false)
                res.send("success");
                return;
            });

    }
});

function saveRecoonsileDataInOffice(reconcile_items, set_on_HQ) {
    if (typeof reconcile_items == "string") {
        reconcile_items = JSON.parse(reconcile_items);
    }
    for (var index = 0; index < reconcile_items.length; index++) {
        var element = reconcile_items[index];
        reconcile_items[index].date = new Date().toISOString().slice(0, 10);
        reconcile_items[index].is_eod_done = 'n';
        reconcile_items[index].is_set_on_HQ = set_on_HQ;
    }
    redisClient.lpush(helper.reconcile_data_node, JSON.stringify(reconcile_items), function (err, reply) {
        if (err) {
            console.log("oops rajesh we have error" + err);
        }
        save_offline_reconsile_info(reconcile_items)
    });
}

function save_offline_reconsile_info(reconcile_items) {
    redisClient.get(helper.offline_po_request_node, function (error, offline_incomming_po) {
        if (error) {
            console.log('************************************************');
            console.log('error', error);
            console.log('************************************************');
            return
        }
        if (typeof offline_incomming_po == "string") {
            offline_incomming_po = JSON.parse(offline_incomming_po);
        }
        po_ids = [];
        console.log("Reconcile_items : " + reconcile_items.length);
        reconcile_items.forEach(function (element) {
            po_id = Number(element.po_id);
            if (po_ids.indexOf(po_id) == -1) {
                po_ids.push(po_id);
            }
        }, this);

        console.log("Reconcile_items : " + reconcile_items.length);

        reconcile_items.forEach((element, index) => {
            key = parseInt(element.po_id)
            for (var i = 0, len = offline_incomming_po[key].length; i < len; i++) {
                if (offline_incomming_po[key][i]["food_item_id"] == element["food_item_id"]) {
                    offline_incomming_po[key][i].is_offline_reconcile_done = "y"; //jaga marking 
                    console.log("Marked Po for Reconciled for Po id:" + key);
                }
            }
        });

        redisClient.set(helper.offline_po_request_node, JSON.stringify(offline_incomming_po), function (error, reply) {
            if (error) {
                console.log('************************************************');
                console.log('error', error);
                console.log('************************************************');
            }

        });
    })
}

router.get('/check_reconcile_data', function (req, res, next) {
    console.log("outlet_app :: check_reconcile_data started: ");
    var hq_url = process.env.HQ_URL;
    var check_reconcile_data_url = hq_url + '/outlet/check_reconcile_data/' + process.env.OUTLET_ID;

    console.log("outlet_app :: check_reconcile_data_url: " + check_reconcile_data_url);
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            // requestretry({
            //     url: check_reconcile_data_url,
            //     maxAttempts: 1,
            //     method: "GET",
            // }, function(error, response, result) {
            //     try {
            //         console.log('************************************************');
            //         console.log('error', error);
            //         console.log('************************************************');

            // if (error || (response && response.statusCode != 200)) {
            //     console.log("outlet_app.js :: " + '{}: {} {}'.format(hq_url + check_reconcile_data_url, error, result));
            //     process.exit();
            //     throw "outlet_app.js ::  HQ not rachable ";
            // }
            // redisClient.set(helper.reconcile_check_data_node, result, function(err, reply) {
            //     if (err) {
            //         console.log("error for storeing the reconsile data", err);
            //     }
            // });
            // var json_result = JSON.parse(result);

            // //var result = { json_result };
            // res.send({ "json_result": json_result });

            //     } catch (e) {
            //         console.log("outlet_app.js :: check_reconcile_data " + e);

            //     }
            // });


            request(check_reconcile_data_url, {
                timeout: 1500
            },
                function (error, response, result) {
                    if (error || (response && response.statusCode != 200)) {
                        console.log("outlet_app.js :: " + '{}: {} {}'.format(hq_url + check_reconcile_data_url, error, result));
                        redisClient.get(helper.reconcile_check_data_node, function (err, result) {
                            var obj = {};
                            var array = [];
                            obj.result_reconcile_data = array;
                            if (err) {
                                console.log('##############################');
                                console.log('error not found ', err);
                                console.log('##############################');
                                obj = {};
                                res.send({
                                    "json_result": obj
                                }).status(200).end();
                                return;
                            }
                            if (result != null) {
                                res.send({
                                    "json_result": JSON.parse(result)
                                }).status(200);
                                return;
                            } else {
                                res.send({
                                    "json_result": obj
                                }).status(200).end();
                                return;
                            }
                        });
                    } else {
                        redisClient.set(helper.reconcile_check_data_node, result, function (err, reply) {
                            if (err) {
                                console.log("error for storeing the reconsile data", err);
                            }
                        });
                        var json_result = JSON.parse(result);

                        //var result = { json_result };
                        res.send({
                            "json_result": json_result
                        });
                        return;

                    }
                });

        })
        .catch(function (err) {
            redisClient.get(helper.reconcile_check_data_node, function (err, result) {
                var obj = {};
                var array = [];
                obj.result_reconcile_data = array;
                if (err) {
                    console.log('##############################');
                    console.log('error not found ', err);
                    console.log('##############################');
                    res.send({
                        "json_result": obj
                    }).status(200).end();
                    return;
                }
                if (result != null) {
                    res.send({
                        "json_result": JSON.parse(result)
                    }).status(200);
                    return;
                } else {
                    res.send({
                        "json_result": obj
                    }).status(200).end();
                    return;
                }
            });
        });

});


// This is to update the inventory after removing the expired items
router.post('/delete_reconcile_stock_count', function (req, res, next) {
    // clear out the delete_reconcile_stock_count queue from redis
    console.log("delete_reconcile_stock_count function called");
    redisClient.del(helper.reconcile_stock_count_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send("error while deleting reconcile_stock_count_node slots in redis- {}".format(err));
            return;
        }
        debug('reconcile_stock_count_node in redis');
    });

    redisClient.del("Bills");
    res.send("success");
});

router.post('/update_reconcile_stock_count', function (req, res, nest) {
    var reconcile_stock_count;

    redisClient.get(helper.reconcile_stock_count_node,
        function (err, reply_reconcile_stock_count) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }

            reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);
            console.log("data from outlete app js reconcile_stock_count: " + JSON.stringify(reconcile_stock_count));

            if (reconcile_stock_count != null) {
                for (i = 0; i < reconcile_stock_count.length; i++) {
                    console.log("item_barcode: " + reconcile_stock_count[i].barcode);
                    debug("item_barcode: " + reconcile_stock_count[i].barcode);
                    var current_barcode = reconcile_stock_count[i].barcode;
                    var barcode_date = current_barcode.substring(16, 20) + "-" + current_barcode.substring(14, 16) + "-" + current_barcode.substring(12, 14);
                    // new Date("2016-12-03") > new Date()
                    console.log('************************************************');
                    console.log('new Date(barcode_date)', new Date(barcode_date));
                    console.log('new Date()', new Date());
                    console.log('************************************************');

                    // Donot update as "expired" for furture item barcodes
                    if (new Date(barcode_date) < new Date()) {
                        // reconcile_stock_count[i].count = 0;
                        // Removed expiry items from reconcile queue
                        reconcile_stock_count.splice(i, 1);
                        i--;
                    }
                }
            }
            redisClient.set(helper.reconcile_stock_count_node,
                JSON.stringify(reconcile_stock_count),
                function (set_err, set_reply) {
                    if (set_err) {
                        debug(set_err);
                    }
                });

            console.log("Final Redis reconcile_stock_count:: " + JSON.stringify(reconcile_stock_count));
        });

    res.send("success");
});

router.post('/update_reconcile_stock_count_automatic', function (req, res, nest) {
    console.log("update_reconcile_stock_count_automatic: " + JSON.stringify(req.body));
    var reconcile_items = req.body.reconcile_items;
    var reconcile_stock_count;
    console.log('************************************************');
    console.log('in update recocile stock count automatic', req.body.reconcile_items);
    console.log('************************************************');
    data_delete_from_po = [];
    data_delete_from_item_id = [];
    redisClient.get(helper.reconcile_stock_count_node,
        function (err, reply_reconcile_stock_count) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }
            reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);
            console.log("reconcile_stock_count: in line 2764" + JSON.stringify(reconcile_stock_count));

            if (reconcile_items != null) {
                for (i = 0; i < reconcile_items.length; i++) {
                    console.log("update_reconcile_stock_count_automatic po_id: " + reconcile_items[i].po_id);
                    var reconcile_po_id = parseInt(reconcile_items[i].po_id);
                    var reconcile_item_id = parseInt(reconcile_items[i].food_item_id);

                    // var reconcile_stock_item_data = _.where(reconcile_stock_count, { 'po_id': reconcile_po_id });
                    // var reconcile_stock_count_index = reconcile_stock_count.indexOf();
                    if (reconcile_stock_count != null && reconcile_stock_count != "undefined") {
                        for (item = 0; item < reconcile_stock_count.length; item++) {
                            // var barcode_date = current_barcode.substring(16, 20) + "-" + current_barcode.substring(14, 16) + "-" + current_barcode.substring(12, 14);
                            var reconcile_stock_count_po_id = reconcile_stock_count[item].po_id;
                            var reconcile_stock_count_item_id = reconcile_stock_count[item].item_id;
                            if (Number(reconcile_stock_count_po_id) == Number(reconcile_po_id) && Number(reconcile_item_id) == reconcile_stock_count_item_id) {
                                // reconcile_stock_count[item].count = 0;
                                // Removed expiry items from reconcile queue
                                if (data_delete_from_po.indexOf(Number(reconcile_stock_count_po_id)) == -1) {
                                    console.log('************************************************');
                                    console.log('reconcile_stock_count_po_id', reconcile_stock_count_po_id);
                                    console.log('************************************************');

                                    data_delete_from_po.push(Number(reconcile_stock_count_po_id));
                                }
                                if (data_delete_from_item_id.indexOf(Number(reconcile_stock_count_item_id)) == -1) {
                                    data_delete_from_item_id.push(Number(reconcile_stock_count_item_id));
                                }
                                reconcile_stock_count.splice(item, 1);
                                item--;
                            }
                        }
                    }

                }
            }

            //            reconcile_from_offline_pos(data_delete_from_po, function(error, reply) {
            console.log("reconcile_stock_count: in line 2764" + JSON.stringify(reconcile_stock_count));

            if (reconcile_stock_count != null && reconcile_stock_count.length < 0) {
                console.log('************************************************');
                console.log('result array');
                console.log('************************************************');
            }

            redisClient.set(helper.reconcile_stock_count_node,
                JSON.stringify(reconcile_stock_count),
                function (set_err, set_reply) {
                    if (set_err) {
                        debug(set_err);
                    }
                });

            console.log("Final Redis reconcile_stock_count:: " + JSON.stringify(reconcile_stock_count));
        });

    res.send("success");
});

function reconcile_from_offline_pos(po_details, callback) {
    redisClient.get(helper.offline_po_request_node, function (error, reply) {
        if (reply != null) {
            po_ids = po_details;
            console.log('************************************************');
            console.log('po_ids typeof', po_ids, typeof po_ids);
            console.log('************************************************');

            offline_po_request_node = JSON.parse(reply);
            for (var key in offline_po_request_node) {
                if (offline_po_request_node.hasOwnProperty(key)) {
                    var element = offline_po_request_node[key];
                    if (po_ids.indexOf(key) > -1) {
                        offline_po_request_node[key].is_offline_reconcile_done = 'y'
                    }
                }
            }
            console.log('************************************************');
            console.log('helper.offline_po_request_node', helper.offline_po_request_node);
            console.log('************************************************');

            redisClient.set(helper.offline_po_request_node, JSON.stringify(offline_po_request_node), function (error, reply) {
                if (error) {
                    console.log('************************************************');
                    console.log('error in setting offline po request node outelet_app line 2881', error);
                    console.log('************************************************');
                }
                callback(null, reply);
            });

        }
    });
}

router.get('/emmit_updated_po_details', function (req, res, next) {
    //offline_incomming_po();
    res.send("success");
    res.end();
});

router.get('/reconcile_remarks', function (req, res, next) {

    redisClient.get(helper.reconcile_remarks_node, function (err, reply_reconcile_remarks) {
        if (err) {
            debug('error while retreiving from redis- {}'.format(err));
            return;
        }

        res.send({
            "reconcile_remarks": reply_reconcile_remarks
        });
    });
});


router.get('/outlet_session_timings', function (req, res, next) {

    redisClient.get(helper.session_time_node, function (err, outlet_session_timings) {
        if (err) {
            debug('error while retreiving from redis- {}'.format(err));
            return;
        }
        res.send(JSON.parse(outlet_session_timings));
    });
});

router.get('/get_data_matrix', function (req, res, next) {
    console.log('get_data_matrix route function called batch id is ' + req.query.batch_id);
    var batch_id = req.query.batch_id;
    if (batch_id != null && batch_id != undefined) {
        get_matrix_code(batch_id);

    }
    res.send('Success');
});

router.post('/store_po_details_in_redis', function (req, res, next) {
    // this will contact the HQ and update the final status of the latest po
    // and batch and mark the barcodes as 'loading_issue'

    var po_details = req.body.po_details;

    if (po_details == null) {
        po_details = {};
    }

    redisClient.get(helper.po_details_node, function (error, po_details_node_data) {
        if (error) {
            console.log('************************************************');
            console.log('error', error);
            console.log('************************************************');
            return;
        } else {

            newdata = {};
            po_details_node_data = JSON.parse(po_details_node_data);
            if (po_details_node_data == null) {
                po_details_node_data = {};
            }
            // if po details node data has key then 
            for (var key in po_details_node_data) {
                if (po_details_node_data.hasOwnProperty(key)) {
                    if (po_details.hasOwnProperty(key)) {
                        newdata[key] = po_details[key];
                    }
                }
            }

            for (var key in po_details) {
                if (po_details.hasOwnProperty(key)) {
                    if (!po_details_node_data.hasOwnProperty(key)) {
                        newdata[key] = po_details[key];
                    }
                }
            }

            for (var key in po_details_node_data) {
                if (po_details_node_data.hasOwnProperty(key)) {
                    var element = po_details_node_data[key];
                    if ((element[0].is_generated_from_scan != "undefined" && element[0].is_generated_from_scan == true)) {
                        newdata[key] = element;
                    }
                }
            }


            redisClient.set(helper.po_details_node,
                JSON.stringify(newdata),
                function (store_po_details_err, store_po_details_reply) {
                    if (store_po_details_err) {
                        console.error('error while inserting in redis- {}'.format(store_po_details_err));
                    }
                    res.send("success");
                });


        }
    });





});

router.post('/update_po_master_list_received_time', function (req, res, next) {
    var reconcile_items = req.body;
    if (reconcile_items.length > 0) {
        var hq_url = process.env.HQ_URL;
        var update_po_master_list_received_time_url = hq_url + '/outlet/update_po_master_list_received_time/';

        console.log("update_po_master_list_received_time: " + update_po_master_list_received_time_url);
        // console.log("reconcile_items: " + JSON.stringify(reconcile_items));

        request({
            url: update_po_master_list_received_time_url,
            method: "POST",
            json: {
                "reconcile_items": reconcile_items,
                "userid": loggedinuserid
            }
        }, function (error, response) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(update_po_master_list_received_time_url, error, ""));
                res.status(500).send('{}: {} {}'.format(update_po_master_list_received_time_url, error, ""));
                return;
            }
        });

        res.send("success");
    }
});

router.post('/send_restautant_excess_mail', function (req, res, next) {
    var restaurant_excess_mails = req.body.restaurant_excess_mails;
    console.log("restaurant_excess_mails ********************************* restaurant_excess_mails: " + JSON.stringify(restaurant_excess_mails));
    if (restaurant_excess_mails != null) {
        var transporter_mail = nodemailer.createTransport({
            host: "smtp.gmail.com", // hostname
            port: 465,
            secure: true,
            auth: {
                user: 'no-reply@atchayam.in',
                pass: 'Atchayam123'
            }
        }, {
                // default values for sendMail method
                from: 'no-reply@atchayam.in',
                headers: {
                    'My-Awesome-Header': '123'
                }
            });

        for (var mail_count = 0; mail_count < restaurant_excess_mails.length; mail_count++) {
            console.log("****Restaurant Email Id***" + restaurant_excess_mails[mail_count].restaurant_mail_id);

            // Send excess items mail to restaurant

            var excess_mail = {
                from: 'no-reply@atchayam.in', // sender address
                to: restaurant_excess_mails[mail_count].restaurant_mail_id, // list of receivers
                subject: 'Excess Items Against PO Number: ' + restaurant_excess_mails[mail_count].po_id + " to " + restaurant_excess_mails[mail_count].outlet_name, // Subject line
                text: restaurant_excess_mails[mail_count].excess_mail_content,
                html: restaurant_excess_mails[mail_count].excess_mail_content
            }

            transporter_mail.sendMail(excess_mail, function (error, response) {
                if (error) {
                    console.log(error);
                }

                console.log("excess_mail message sent: " + response.message);
            });
        }

        res.send("success");
    }
});

// Send Undelivered PO items details send mail to restaurant
router.post('/send_pending_reconcile_po_mail', function (req, res, next) {
    console.log("******** #################################### send_pending_reconcile_po_mail function called");

    var item_details_content = req.body.mail_content;
    var outlet_id = req.body.outlet_id;
    var outlet_name = req.body.outlet_name;
    var city = req.body.city;
    var store_managers_mail_id = req.body.store_managers_mail_id;
    var mail_content = "";

    if (item_details_content != null) {
        // mail content for pending reconcile po items    
        mail_content = '<html><body>';
        mail_content += '<div>';
        mail_content += 'Hi,<br/> Please find the following details of pending reconcile items from <b>' + outlet_name + ' </b>outlet. <br/><br/><br/><table class="reconsile" border="1" cellpadding="0" cellspacing="0" width="75%">';
        mail_content += '<tr style="background-color: #fbb713;color: #4a4b4a;font-weight: bold;text-align:center;"><th style=\"padding: 5px;width:50px;\">PO Id</th>';
        mail_content += '<th style=\"padding: 5px;width:150px;\">Restaurant Name</th><th  style=\"padding: 5px;width:150px;\">Session Name</th>';
        mail_content += '<th  style=\"padding: 5px;width:150px;\">Item Name</th><th style=\"padding: 5px;width:150px;\">PO Qty</th>';
        mail_content += '<th style=\"padding: 5px;width:150px;\">Scanned Qty</th><th style=\"padding: 5px;width:150px;\">Undelivered Qty</th></tr>';
        mail_content += item_details_content;
        mail_content += '</table><br/><br/>';
        mail_content += '<div><br/>Thanks,<br/>Frshly</div></body></html>';
        console.log("******** send_pending_reconcile_items :: mail_content :: " + mail_content);


        var transporter_mail = nodemailer.createTransport({
            host: "smtp.gmail.com", // hostname
            port: 465,
            secure: true,
            auth: {
                user: 'no-reply@atchayam.in',
                pass: 'Atchayam123'
            }
        }, {
                // default values for sendMail method
                from: 'no-reply@atchayam.in',
                headers: {
                    'My-Awesome-Header': '123'
                }
            });

        // Send undelivered items to restaurant
        // TODO - check for semicolon seperated email id's
        if (store_managers_mail_id) {
            var date1 = moment.utc().format('YYYY-MM-DD HH:mm:ss');
            var localTime = moment.utc(date1).toDate();

            var mail = {
                from: 'no-reply@atchayam.in', // sender address
                to: store_managers_mail_id, // list of receivers
                subject: 'Pending Reconcile Items in ' + outlet_name + ' on ' + moment(localTime).format('YYYY-MM-DD HH:mm:ss'), // Subject line
                text: mail_content,
                html: mail_content
            };

            transporter_mail.sendMail(mail, function (error, response) {
                if (error) {
                    console.log(error);
                } else {
                    console.log("message sent: " + response.message);
                }
            });
        }

        res.send("success");
    }
});

router.get('/get_outlet_config_redis', function (req, res, next) {
    var outlet_config = [];
    redisClient.get(helper.outlet_config_node,
        function (err, reply_outlet_config) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }

            outlet_config = JSON.parse(reply_outlet_config);
            console.log("outlet_config: " + JSON.stringify(outlet_config));
            res.send(outlet_config);
        });
});

function isTestModeItem(item_code) {
    if (item_code >= 9000 && item_code <= 9003) {
        return true;
    } else {
        return false;
    }

}

function get_matrix_code(batch_id) {
    console.log("************Batch_id received in staff_roster method " + batch_id);
    var GET_DATA_MATRIX_URL = '/food_vendor/get_data_matrix/' + batch_id;
    // requesting the HQ to get the staff list
    request(process.env.HQ_URL + GET_DATA_MATRIX_URL, {
        forever: true
    },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                return;
            }
            console.log("************data received from get_data_matrix (HQ) in staff_roster method(outlet) " + body);


            redisClient.get(helper.barcode_comparision, function (err, reply) {
                if (err) {
                    debug('error while retreiving from redis- {}'.format(err));
                    return;
                }

                var config = reply != null ? JSON.parse(reply) : null;
                if (config != null) {
                    console.log("*************************barcode_comparision length " + config.length);
                    if (config.length > 0) {
                        var parsed_data = JSON.parse(body);
                        _.each(parsed_data, function (obj) {
                            config.push(obj);
                        });
                        console.log("*************************inside true condition final result" + JSON.stringify(config));
                        redisClient.set(helper.barcode_comparision, JSON.stringify(config),
                            function (lp_err, lp_reply) {
                                if (lp_err) {
                                    console.log("***************err while update rpush barcode_comparision" + lp_err);
                                    return;
                                }
                            });
                    } else {
                        console.log("*************************inside false condition");
                        redisClient.set(helper.barcode_comparision,
                            body,
                            function (err, rply) {
                                if (err) {
                                    console.log('*******************error while inserting in redis- {}'.format(err));
                                }

                            });
                    }
                } else {
                    console.log("*************************inside config null condition");
                    redisClient.set(helper.barcode_comparision,
                        body,
                        function (err, rply) {
                            if (err) {
                                console.log('*******************error while inserting in redis- {}'.format(err));
                            }

                        });
                }
            });
        });
};

router.get('/check_internet_connection', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    internetAvailable({
        timeout: 1000,
        retries: 3,
    })
        .then(function () {
            res.send("true");
        })
        .catch(function () {
            res.send("false");
        });


});
/*
created by peerbits to show order details online and offline 
date 18 aug 2017
*/
router.get('/show_orders', function (req, res, next) {
    var time = req.query.time;
    var outlet_id = process.env.OUTLET_ID;
    var outlet_url = process.env.HQ_URL;
    var show_order_url = "/outlet/show_orders/";
    var SHOW_ORDER_URL = outlet_url + show_order_url + outlet_id + "?time=" + time;

    search_order_by_time(time, function (error, reply1) {
        reply2 = JSON.parse(reply1);
        if (reply2.length > 0) {
            res.send(reply1);
            return;
        } else {
            internetAvailable({
                timeout: 1000,
                retries: 3,
            })
                .then(function () {
                    requestretry({
                        url: SHOW_ORDER_URL,
                        json: true,
                        maxAttempts: 5,

                    }, function (error, response, body) {
                        if (error || (response && response.statusCode != 200)) {
                            console.log("outlet_app.js :: showorders " + '{}: {} {}'.format(SHOW_ORDER_URL, error, result));
                            res.send(JSON.parse("[]"));
                            return;
                        }
                        res.send(body);
                        //return;
                    });
                })
                .catch(function (err) {
                    search_order_by_time(time, function (error, reply1) {
                        res.send(reply1);
                    });
                })

        }
    });

});

//peerbits function to store details of the supplied
//date:4-Aug-2017

router.post('/storesuppliesdetails', function (req, res, next) {
    supplies = req.body;

    redisClient.set(helper.supplies_detail_node, JSON.stringify(supplies), function (err, reply) {
        if (err) {
            console.log('##############################');
            console.log('cannot store supplie detail because of ', err);
            console.log('##############################');
            res.status("601").send("cannot add data due to " + err);
            res.end();
            return;
        }

        res.status(200).send("success");
        res.end();
    });

})

router.get('/getsuppliesdetails', function (req, res, next) {
    redisClient.get(helper.supplies_detail_node, function (err, reply) {
        if (err) {
            res.status("601").send("cannot get supplies data due to " + err);
            res.end();
            return;
        }
        res.type('application/json').send(reply);
        res.end();
    });

});


/*
created by peerbits to show order details online and offline 
date 18 aug 2017
*/
router.get('/show_bill_items/:order_id/:oultet_order_id', function (req, res, next) {
    var order_id = req.params.order_id;
    var oultet_order_id = req.params.oultet_order_id;
    var outlet_id = process.env.OUTLET_ID;
    var outlet_url = process.env.HQ_URL;
    var show_order_items_url = "/outlet/show_bill_items/";
    var SHOW_ORDER_ITEMS_URL = outlet_url + show_order_items_url + order_id;
    console.log('************************************************');
    console.log('oultet_order_id', oultet_order_id);
    console.log('************************************************');

    // internetAvailable({
    //         timeout: 1000,
    //         retries: 3,
    //     })
    //     .then(function() {
    //         search_order_item_by_order_id(order_id, outlet_order_id, function(error, order_items) {
    //             order_items = JSON.parse(order_items);
    //             if (order_items.length > 0) {
    //                 reply1 = order_items;
    //                 maindata = [];
    //                 for (var index = 0; index < reply1.length; index++) {
    //                     var element = reply1[index];
    //                     barcode = reply1[index].barcode.split(",");
    //                     for (var index2 = 0; index2 < barcode.length; index2++) {
    //                         var element2 = barcode[index2];
    //                         data = {};
    //                         data.barcode = barcode[index2];
    //                         if (element.quantity > 0) {
    //                             data.quantity = 1;
    //                         } else {
    //                             data.quantity = -1;
    //                         }
    //                         data.original_quantity = element.count;
    //                         data.mrp = element.mrp
    //                         data.name = element.name;
    //                         data.id = element.id;
    //                         data.bill_no = element.bill_no;
    //                         data.outlet_order_id = element.outlet_order_id;
    //                         data.count = element.count;
    //                         data.dispensing_count = element.dispensing_count;
    //                         data.delivered_count = element.delivered_count;
    //                         data.order_id = element.order_id;
    //                         data.dispense_status = element.dispense_status;
    //                         data.dispense_status_scanded_ids = element.dispense_status_scanded_ids;
    //                         data.delivered_status_scanded_ids = element.delivered_status_scanded_ids;
    //                         maindata.push(data);
    //                     }
    //                 }
    //                 res.send(maindata);
    //                 return;
    //             } else {
    //                 requestretry({
    //                     url: SHOW_ORDER_ITEMS_URL,
    //                     json: true,
    //                     maxAttempts: 2,
    //                     _timeout: 1000,
    //                 }, function(error, response, body) {
    //                     if (error || (response && response.statusCode != 200)) {
    //                         console.log("outlet_app.js :: showorders " + '{}: {} {}'.format(SHOW_ORDER_URL, error, result));
    //                         res.send(JSON.parse("[]"));
    //                         return;
    //                     }
    //                     if (typeof body != "undefined") {
    //                         res.send(body);
    //                     } else {
    //                         search_order_item_by_order_id(order_id, outlet_order_id, function(error, reply2) {
    //                             res.send(reply2);
    //                         });
    //                     }
    //                 });
    //             }
    //         });
    //     })
    //     .catch(function(err) {
    //         search_order_item_by_order_id(order_id, outlet_order_id, function(error, reply1) {
    //             reply1 = JSON.parse(reply1);
    //             maindata = [];
    //             for (var index = 0; index < reply1.length; index++) {
    //                 var element = reply1[index];
    //                 barcode = reply1[index].barcode.split(",");
    //                 for (var index2 = 0; index2 < barcode.length; index2++) {
    //                     var element2 = barcode[index2];
    //                     data = {};
    //                     data.barcode = barcode[index2];
    //                     if (element.quantity > 0) {
    //                         data.quantity = 1;
    //                     } else {
    //                         data.quantity = -1;
    //                     }
    //                     data.original_quantity = element.count;
    //                     data.mrp = element.mrp
    //                     data.name = element.name;
    //                     data.id = element.id;
    //                     data.bill_no = element.bill_no;
    //                     data.outlet_order_id = element.outlet_order_id;
    //                     data.count = element.count;
    //                     data.dispensing_count = element.dispensing_count;
    //                     data.delivered_count = element.delivered_count;
    //                     data.order_id = element.order_id;
    //                     data.dispense_status = element.dispense_status;
    //                     data.dispense_status_scanded_ids = element.dispense_status_scanded_ids;
    //                     data.delivered_status_scanded_ids = element.delivered_status_scanded_ids;
    //                     maindata.push(data);
    //                 }
    //             }
    //             res.send(maindata);
    //         });
    //     })
    console.log('************************************************');
    console.log('order_id,oultet_order_id', order_id, oultet_order_id);
    console.log('************************************************');

    search_order_item_by_order_id(order_id, oultet_order_id, function (error, order_items) {
        order_items = JSON.parse(order_items);
        if (order_items.length > 0) {
            reply1 = order_items;
            maindata = [];
            for (var index = 0; index < reply1.length; index++) {
                var element = reply1[index];
                barcode = reply1[index].barcode.split(",");
                for (var index2 = 0; index2 < barcode.length; index2++) {
                    var element2 = barcode[index2];
                    data = {};
                    data.barcode = barcode[index2];
                    if (element.quantity > 0) {
                        data.quantity = 1;
                    } else {
                        data.quantity = -1;
                    }
                    data.original_quantity = element.count;
                    data.mrp = element.mrp
                    data.name = element.name;
                    data.id = element.id;
                    data.bill_no = element.bill_no;
                    data.outlet_order_id = element.outlet_order_id;
                    data.count = element.count;
                    data.dispensing_count = element.dispensing_count;
                    data.delivered_count = element.delivered_count;
                    data.order_id = element.order_id;
                    data.dispense_status = element.dispense_status;
                    data.dispense_status_scanded_ids = element.dispense_status_scanded_ids;
                    data.delivered_status_scanded_ids = element.delivered_status_scanded_ids;
                    maindata.push(data);
                }
            }
            res.send(maindata);
            return;
        } else {
            requestretry({
                url: SHOW_ORDER_ITEMS_URL,
                json: true,
                maxAttempts: 2,
                _timeout: 1000,
            }, function (error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.log("outlet_app.js :: showorders " + '{}: {} {}'.format(SHOW_ORDER_URL, error, result));
                    res.send(JSON.parse("[]"));
                    return;
                }
                if (typeof body != "undefined") {
                    res.send(body);
                } else {
                    // search_order_item_by_order_id(order_id, outlet_order_id, function(error, reply2) {
                    //     res.send(reply2);
                    // });
                }
            });
        }
    });




});


function saveOrderdetails(body, time, is_set_on_HQ, callback) {
    if (typeof body != "undefined") {
        len = body.length;
        for (var index = 0; index < len; index++) {
            var element = body[index];
            element.is_set_on_HQ = is_set_on_HQ;
            search_order = {
                bill_nos: element.bill_nos,
                time: new RegExp(time, "i")
            }
            order = Object.assign(element, OrderModel._doc);
            neworder = order;
            OrderModel.findOneAndUpdate(search_order, neworder, {
                upsert: true,
                new: true
            }, function (error, reply) {
                if (error) {
                    console.log('##############################');
                    console.log('error', error);
                    console.log('##############################');
                }
            });
        }
        callback(null, JSON.stringify(body));
    } else {
        callback(null, JSON.stringify([]));
    }
}

function saveOrderItemsDetails(body, order_id, is_set_on_HQ, callback) {
    if (typeof body != "undefined") {
        len = body.length;
        for (var index = 0; index < len; index++) {
            var element = body[index];
            element.is_set_on_HQ = is_set_on_HQ;
            element.order_id = order_id;
            element.date = new Date().toDateString;
            search_order_item = {
                bill_no: body.bill_no,
                date: Date().toDateString,
                order_id: order_id,
            }
            order_items = Object.assign(element, OrderItemModel._doc);
            neworder_item = order_items;
            OrderItemModel.findOneAndUpdate(search_order_item, neworder_item, {
                upsert: true,
                new: true
            }, function (error, reply) {
                if (error) {
                    console.log('##############################');
                    console.log('error', error);
                    console.log('##############################');
                }
            });
        }
        search_order_items = {
            order_id: parseInt(order_id)
        };

        var fields = {
            __v: false,
            _id: false,
            is_set_on_HQ: false,
        };

        OrderModel.find(search_order_items, fields, function (err, order) {
            if (err) {
                console.log('##############################');
                console.log('error', err);
                console.log('##############################');
            };
            order = JSON.stringify(order);
            // object of all the users
            callback(null, order);
        });
    } else {
        callback(null, JSON.stringify([]));
    }
}

function search_order_by_time(time, callback) {
    obj = {
        time: new RegExp(time, "i")
    };

    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false,
    };
    var sort = {
        "sort": {
            "time": -1
        }
    };

    OrderModel.find(obj, fields, sort, function (err, order) {
        if (err) {
            console.log('##############################');
            console.log('error', err);
            console.log('##############################');
        };
        order = JSON.stringify(order);
        // object of all the users
        callback(null, order);
    });
}

function search_order_item_by_order_id(order_id, outlet_order_id, callback) {
    obj = {
        order_id: parseInt(order_id),
        outlet_order_id: parseInt(outlet_order_id)
    };

    console.log('************************************************');
    console.log('obj', obj);
    console.log('************************************************');

    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false,
    };

    OrderItemModel.find(obj, fields, function (err, orderitems) {
        if (err) {
            console.log('##############################');
            console.log('error', err);
            console.log('##############################');
        };

        orderitems = JSON.stringify(orderitems);
        // object of all the users
        callback(null, orderitems);
    });
}

function insertUpdateNonFoodIssueDocument(body, inserttime, is_set_on_HQ, callback) {
    body = JSON.parse(body);
    for (var index = 0; index < body.length; index++) {
        item = body[index];
        searchissue = {
            type: item.type,
            note: item.note,
        }
        reporter = (typeof item.reporter != "undefined") ? item.reporter : "";
        issue = {
            type: item.type,
            note: item.note,
            time: item.time,
            is_set_on_HQ: is_set_on_HQ,
            inserttime: inserttime,
            reporter: reporter
        };
        newissue = Object.assign(issue, NonFoodIssue._doc);
        NonFoodIssue.findOneAndUpdate(
            searchissue,
            newissue, {
                upsert: true,
                new: true
            },
            function (error, reply) {
                if (error) {
                    console.log('##############################');
                    console.log('error', error);
                    console.log('##############################');
                }
            }
        );
    }
    body = JSON.stringify(body);
    callback(null, JSON.stringify(body));
}

function searchNonFoodIssueDocument(time, callback) {
    obj = {
        time: new RegExp(time, "i")
    };
    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false,
        inserttime: false,
        repoter: false
    };
    NonFoodIssue.find(obj, fields, {
        sort: {
            inserttime: -1
        }
    }, function (err, issues) {
        if (err) {
            console.log('##############################');
            console.log('error', err);
            console.log('##############################');
        };
        console.log('##############################');
        console.log('issues', issues);
        console.log('##############################');
        issues = JSON.stringify(issues);
        // object of all the users
        callback(null, issues);
    });
}

function saveNONFoodIssue(non_food_issue, is_sent_to_HQ, callback) {
    body = {};
    is_set_on_HQ = is_sent_to_HQ;
    body.type = non_food_issue.type;
    body.note = non_food_issue.note;
    body.reporter = non_food_issue.reporter;
    body.time = new Date();
    bodyarray = [];
    bodyarray.push(body);
    bodyarray = JSON.stringify(bodyarray);
    inserttime = moment.utc().format("YYYY-MM-DD HH:mm:ss");
    insertUpdateNonFoodIssueDocument(bodyarray, inserttime, is_set_on_HQ, function (error, reply) {
        if (error) {
            console.log('##############################');
            console.log('error', error);
            console.log('##############################');
        }
        callback(null, "success");
    });
}


/**
 * function to get the outlet issues from HQ
 */

/*
created by peerbits to show order details online and offline 
date 20 aug 2017
*/
router.get('/issue_enum', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var issues_enum_url = hq_url + "/food_item/issue_enum";
    console.log('##############################');
    console.log('here1');
    console.log('##############################');

    redisClient.exists(helper.issues_enum_node, function (err, reply) {
        console.log('##############################');
        console.log('err', err);
        console.log('##############################');
        console.log('##############################');
        console.log('reply', reply);
        console.log('##############################');
        if (reply == 1) {
            console.log('##############################');
            console.log('some');
            console.log('##############################');
            redisClient.get(helper.issues_enum_node, function (err, reply) {
                console.log('##############################');
                console.log('reply', reply);
                console.log('##############################');
                res.send(reply);
            });
        } else {
            console.log('##############################');
            console.log('here2', issues_enum_url);
            console.log('##############################');

            requestretry({
                url: issues_enum_url,
                maxAttempts: 3,
                timeout: 3000
            }, function (error, response, body) {
                console.log('##############################');
                console.log('body typeof', body, typeof body);
                console.log('##############################');
                if (error || (response && response.statusCode != 200)) {
                    console.log("outlet_app.js :: issues_enum " + '{}: {} {}'.format(SHOW_ORDER_URL, error, result));
                    res.send("{}");
                    return;
                }
                redisClient.set(helper.issues_enum_node, body, function (error, reply) {
                    if (error) {
                        console.log("outlet_app.js :: issues_enum " + '{}: {} {}'.format(SHOW_ORDER_URL, error, result));
                        res.send(body);
                        return;
                    }
                    res.send(body);
                });
            });
        }
    });
});


router.get('/set_offline_reconcile111', function (req, res, next) {


    console.log('rajesh thiesidslkjdfsdfsaljdfslkjsa');
    console.log(req.query.po_id);
    // console.log(res);


    // var post_data = JSON.parse(req);

    /**
     * this is function set the flag to is_set_on_HQ to n and is_offline_reconcile_done to y
     * rajesh peerbits
     * 6-aug-2017
     */
    redisClient.get(helper.offline_po_request_node, function (err, reply) {
        if (err) {
            console.error(err);
            //NEED TO CHECK THAT WE GOT ERROR OR NOT
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;

        }
        redist_data = JSON.parse(reply);

        console.log('this is pares json');
        console.log(redist_data);
        console.log('this is pares json');

        console.log('this is pares json');
        console.log(req.query.po_id);
        console.log('this is pares json');



        for (var key in redist_data) {
            if (redist_data.hasOwnProperty(key)) {

                for (var index = 0; index < redist_data[key].length; index++) {

                    if (typeof (redist_data[key][index].is_offline_reconcile_done) != 'undefined' &&
                        redist_data[key][index].is_offline_reconcile_done == 'n' &&
                        parseInt(redist_data[key][index].po_id) == parseInt(req.query.po_id)
                    ) {
                        console.log('yes in line this fuynctioh');
                        redist_data[key][index].is_offline_reconcile_done = "y";
                        console.log('yes in line this fuynctioh');
                    } else {

                        /*if offline reconcile is already done */
                        if (typeof (redist_data[key][index].is_offline_reconcile_done) != 'undefined' &&
                            redist_data[key][index].is_offline_reconcile_done == 'y'

                        ) {
                            redist_data[key][index].is_offline_reconcile_done = "y";
                        } else {
                            redist_data[key][index].is_offline_reconcile_done = "n";
                        }
                    }

                    if (typeof (redist_data[key][index].is_set_on_HQ) != 'undefined' &&
                        redist_data[key][index].is_set_on_HQ == 'y') {
                        redist_data[key][index].is_set_on_HQ = "y";

                    } else {
                        redist_data[key][index].is_set_on_HQ = "n";
                    }
                }



            }
        }

        console.log('this is redist_data ');
        console.log(redist_data);
        console.log('this is redist_data ');
        //for storing data of latest merge
        redisClient.set(helper.offline_po_request_node,
            JSON.stringify(redist_data),
            function (store_po_details_err, store_po_details_reply) {
                if (store_po_details_err) {
                    console.error('error while inserting in redis- {}'.format(store_po_details_err));
                    console.error('rajesh there is eeror in inbiult funcion');
                }

            });
    });

    return 'success';
});




module.exports = router;