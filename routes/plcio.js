var express = require('express');
var router = express.Router();
var debug = require('debug')('outlet_app:server');
var firebase = require('firebase');
var redis = require('redis');
var format = require('string-format');
var request = require('request');
var moment = require('moment');
var async = require('async');


var requestretry = require('requestretry');
var _ = require('underscore');
var helper = require('./helper');
var PlaceOrderModel = require('../models/PlaceOrderModel');
var OrderModel = require('../models/OrderModel');
var OrderItemModel = require('../models/OrderItemModel');
var FoodItemModel = require('../models/FoodItemModel');
var offline_incomming_po = require('../misc/offline_incomming_po');

format.extend(String.prototype);
var redisClient = redis.createClient({
    connect_timeout: 2000,
    retry_max_delay: 5000
});
redisClient.on('error', function (msg) {
    debug(msg);
});
var internetAvailable = require("internet-available");
// Routes coming from the plcio daemon

// This will happen when the plc machine has finished serving the order.
// It is a signal to push the order details to HQ that it has been served.
// item structure - {"dispense_id": "", "status": "", "order_stub": ""}
router.post('/update_order_item_status', function (req, res, next) {
    debug("Received call for updating item status- ", req.body.data);
    // Throw an error if content-type is not application/json
    if (req.get('Content-Type') != 'application/json') {
        res.status(415).send('');
        return;
    }
    var updated_item = req.body.data;

    console.log("********************updated_item" + JSON.stringify(updated_item));

    redisClient.lrange(helper.dispenser_queue_node, 0, -1,
        function (q_err, q_reply) {
            if (q_err) {
                debug(q_err);
                res.status(500).send("error while retreiving from redis- {}".format(q_err));
                return;
            }
            var changed_index = -1;
            var dispense_status_data = {};
            for (var i = 0; i < q_reply.length; i++) {
                var queue_item = JSON.parse(q_reply[i]);
                if (queue_item.dispense_id == updated_item.dispense_id) {

                    changed_index = i;
                    //as per discussion with rajasekar timeout is changed to delivered
                    if (updated_item.status == "timeout") {
                        console.log("timeout item:" + JSON.stringify(updated_item));
                        updated_item.status = "delivered";
                    }

                    if (updated_item.status == "delivered") {
                        // remove the item from the queue
                        redisClient.lrem(helper.dispenser_queue_node, 0, JSON.stringify(queue_item),
                            function (set_err, set_reply) {
                                debug("deleted the item of the redis queue at index - ", changed_index);
                            });
                    } else if (updated_item.status == "dispensing" || updated_item.status == "timeout") {
                        //Updating the redis queue with the new status
                        redisClient.lset(helper.dispenser_queue_node, changed_index, JSON.stringify(updated_item),
                            function (set_err, set_reply) {
                                debug("updated the redis queue with the new status- ",
                                    updated_item.status, "at index- ", changed_index);
                            });
                    }

                    var bill_no = getBillNo(updated_item.order_stub);
                    if (!isNaN(bill_no) && bill_no != 0) {
                        dispense_status_data[bill_no] = computeDispenseStatus(
                            dispense_status_data[bill_no], updated_item.status);
                    }

                } else {
                    var bill_no = getBillNo(queue_item.order_stub);
                    if (!isNaN(bill_no) && bill_no != 0) {
                        dispense_status_data[bill_no] = computeDispenseStatus(
                            dispense_status_data[bill_no], queue_item.status);
                    }
                }
            }

            dispens_obj = {
                "name": "DISPENSE_STATUS_UPDATE",
                "outlet_id": process.env.OUTLET_ID,
                "data": dispense_status_data
            };

            array_status = ["dispensing", "timeout", "pending", "delivered"];

            if (array_status.indexOf(updated_item.status) != -1) {
                update_mongo_order_time_detials(updated_item, function (error, outlet_order_id) {
                    internetAvailable({
                            timeout: 1000,
                            retries: 3,
                        })
                        .then(function () {
                            // redisClient.rpush(helper.dispense_local_status_node, JSON.stringify(dispens_obj), function (error, reply) {
                            //     if (error) {
                            //         console.log('##############################');
                            //         console.log('error', error);
                            //         console.log('##############################');
                            //     }
                            //     res.send("success");
                            //     return;
                            // });
                            // send the dispenser data to the HQ
                            debug("Sending dispense status data as- ", dispense_status_data);
                            var ref = new Firebase(process.env.FIREBASE_QUEUE);
                            dispens_obj.outlet_order_id = outlet_order_id.toString();
                            console.log('************************************************');
                            console.log('dispens_obj', dispens_obj);
                            console.log('************************************************');
                            ref.child('tasks').push(dispens_obj, function (error) {
                                if (error) {
                                    console.log('##############################');
                                    console.log('here3');
                                    console.log('##############################');
                                    redisClient.rpush(helper.dispense_local_status_node, JSON.stringify(dispens_obj), function (error, reply) {
                                        if (error) {
                                            console.log('##############################');
                                            console.log('error', error);
                                            console.log('##############################');
                                        }
                                        res.send("success");
                                    });
                                }
                            });
                            debug("Successfully pushed the dispense status data");
                            res.send("success");
                        })
                        .catch(function (err) {
                            console.log('##############################');
                            console.log('here2');
                            console.log('##############################');
                            console.log('##############################');
                            console.log('dispens_obj', dispens_obj);
                            console.log('##############################');
                            dispens_obj.outlet_order_id = outlet_order_id.toString();
                            console.log('##############################');
                            console.log('dispens_obj', dispens_obj);
                            console.log('##############################');
                            redisClient.rpush(helper.dispense_local_status_node, JSON.stringify(dispens_obj), function (error, reply) {
                                if (error) {
                                    console.log('##############################');
                                    console.log('error', error);
                                    console.log('##############################');
                                }
                                res.send("success");
                            });
                        });

                });
            } else {
                res.send("success");
            }




        });
});

function update_mongo_order_time_detials(updated_item, callback_tofunction) {
    if (updated_item.status != undefined) {
        var main_bill_no = getBillNo(updated_item.order_stub);
        var item_barcodes = getItemBarcode(updated_item.order_stub);


        var status = "{" + updated_item.status + "}";
        var dispense_id = updated_item.dispense_id.toString();
        search_order_item = {};
        search_order_item.bill_nos = main_bill_no;
        search_order_item.order_barcodes = new RegExp(item_barcodes, "i");

        getOrderDetailsByOutletOrderId(search_order_item, function (error, result) {
            if (error != null) {
                callback_tofunction(error, null);
            }
            if (typeof result[0] != "undefined") {

                order_details = result[0];
                order_items_details = order_details.order_items;

                item_statuses = [];


                for (var index = 0; index < order_items_details.length; index++) {
                    var element = order_items_details[index];
                    //item_barcodes = item_barcodes.split(",");
                    console.log('************************************************');
                    console.log('item_barcodes = item_barcodes;', item_barcodes);
                    console.log('************************************************');
                    element.barcode = element.barcode.split(",");
                    console.log('************************************************');
                    console.log(' element.barcode;', element.barcode);
                    console.log('************************************************');

                    item_barcodes = item_barcodes;
                    if (typeof element.dispense_status_scanded_ids != "undefined" && element.dispense_status_scanded_ids != "") {
                        dispense_status_scanded_ids = element.dispense_status_scanded_ids.split(",");
                    } else {
                        dispense_status_scanded_ids = [];
                    }

                    if (typeof element.delivered_status_scanded_ids != "undefined" && element.delivered_status_scanded_ids != "") {
                        delivered_status_scanded_ids = element.delivered_status_scanded_ids.split(",");
                    } else {
                        delivered_status_scanded_ids = [];
                    }

                    if (element.barcode.indexOf(item_barcodes) != -1) {
                        count = element.count;
                        if (status == "{dispensing}" && element.dispensing_count < count && dispense_status_scanded_ids.indexOf(dispense_id) == -1) {
                            element.dispensing_count = element.dispensing_count + 1;
                            dispense_status_scanded_ids.push(dispense_id);


                            if (element.dispensing_count == count) {
                                element.dispense_status = status;
                            }
                        } else
                        if (status == "{delivered}" && element.delivered_count < count && delivered_status_scanded_ids.indexOf(dispense_id) == -1) {
                            element.delivered_count = element.delivered_count + 1;
                            delivered_status_scanded_ids.push(dispense_id);
                            if (element.delivered_count == count) {
                                element.dispense_status = status;
                            }
                        }

                        OrderItemModel.update({
                            "_id": element._id
                        }, {
                            "dispense_status": element.dispense_status,
                            "dispensing_count": element.dispensing_count,
                            "delivered_count": element.delivered_count,
                            "dispense_status_scanded_ids": dispense_status_scanded_ids.join(","),
                            "delivered_status_scanded_ids": delivered_status_scanded_ids.join(",")
                        }, {}, function (error, reply) {
                            if (error) {
                                console.log('************************************************');
                                console.log('error at 177 plcio', error);
                                console.log('************************************************');
                                callback_tofunction(error, null);
                            }
                            console.log('************************************************');
                            console.log('reply at 181 plcio', reply);
                            console.log('************************************************');
                        });
                    }
                    item_statuses.push(element.dispense_status);
                }


                if (updated_item.status == "timeout") {
                    order_status = "{timeout}";
                } else {
                    if (item_statuses.indexOf("{pending}") > -1) {
                        order_status = "{pending}";
                    } else if (item_statuses.indexOf("{dispensing}") > -1) {
                        order_status = "{dispensing}";
                    } else {
                        order_status = "{delivered}";
                    }
                }

                OrderModel.update({
                    "_id": order_details._id
                }, {
                    "dispense_status": order_status
                }, {}, function (err, reply) {
                    if (err) {
                        console.log('************************************************');
                        console.log('error on 207', error);
                        console.log('************************************************');

                    }
                    console.log('************************************************');
                    console.log('reply on plcico 207', reply);
                    console.log('************************************************');
                });


                callback_tofunction(null, order_details.outlet_order_id);
            }

        });
    }
}


function getOrderDetailsByOutletOrderId(search_order_item, callback) {

    OrderModel.find(search_order_item, function (error, reply) {
        if (error) {
            // console.log('error',error);
            // process.exit();
            callback(error, null);
        } else {

            OrderItemModel.find({
                outlet_order_id: reply[0].outlet_order_id
            }, function (error, replyitems) {
                reply[0]["order_items"] = replyitems;

                callback(null, reply);

            });

        }
    });

}


function update_mongo_order_time_detials1(updated_item) {
    if (updated_item.status != undefined) {
        var main_bill_no = getBillNo(updated_item.order_stub);
        var item_barcodes = getItemBarcode(updated_item.order_stub);
        var date = moment().format("YYYY-MM-DD");


        var status = "{" + updated_item.status + "}";
        var dispense_id = updated_item.dispense_id.toString();
        search_order_item = {};
        search_order_item.bill_nos = main_bill_no;
        //    search_order_item.time = new RegExp(date, "i");
        search_order_item.order_barcodes = new RegExp(item_barcodes, "i");
        debug("seach order item in mongo ", search_order_item);
        lookup = {
            "from": "order_item_details",
            "localField": "outlet_order_id",
            "foreignField": "outlet_order_id",
            "as": "order_items"
        };


        OrderModel.aggregate([{
            $match: search_order_item
        }, {
            $lookup: lookup
        }], function name(err, result) {
            if (err) {
                console.log('************************************************');
                console.log('err in plcio 161', err);
                console.log('************************************************');
            }

            console.log('************************************************');
            console.log('result', result);
            console.log('************************************************');
            ///process.exit();

            if (typeof result[0] != "undefined") {

                order_details = result[0];
                order_items_details = order_details.order_items;

                item_statuses = [];


                for (var index = 0; index < order_items_details.length; index++) {
                    var element = order_items_details[index];
                    //item_barcodes = item_barcodes.split(",");
                    console.log('************************************************');
                    console.log('item_barcodes = item_barcodes;', item_barcodes);
                    console.log('************************************************');
                    element.barcode = element.barcode.split(",");
                    console.log('************************************************');
                    console.log(' element.barcode;', element.barcode);
                    console.log('************************************************');
                    item_barcodes = item_barcodes;
                    if (element.dispense_status_scanded_ids != "") {
                        dispense_status_scanded_ids = element.dispense_status_scanded_ids.split(",");
                    } else {
                        dispense_status_scanded_ids = [];
                    }

                    if (element.delivered_status_scanded_ids != "") {
                        delivered_status_scanded_ids = element.delivered_status_scanded_ids.split(",");
                    } else {
                        delivered_status_scanded_ids = [];
                    }

                    console.log('************************************************');
                    console.log('element.barcode.indexOf(item_barcodes) != -1', element.barcode.indexOf(item_barcodes) != -1);
                    console.log('************************************************');

                    if (element.barcode.indexOf(item_barcodes) != -1) {
                        console.log('************************************************');
                        console.log('************************************************');
                        console.log('dispense_id', dispense_id);
                        console.log('************************************************');
                        console.log('dispense_status_scanded_ids.indexOf(dispense_id)', dispense_status_scanded_ids.indexOf(dispense_id));
                        console.log('************************************************');

                        count = element.count;

                        console.log('************************************************');
                        console.log('element', element);
                        console.log("status", status);
                        console.log('************************************************');
                        console.log('');
                        console.log('************************************************');

                        console.log("element.dispensing_count < count", count);
                        console.log("dispense_status_scanded_ids.indexOf(dispense_id) == -1", dispense_status_scanded_ids.indexOf(dispense_id) == -1);
                        console.log('************************************************');
                        if (status == "{dispensing}" && element.dispensing_count < count && dispense_status_scanded_ids.indexOf(dispense_id) == -1) {
                            element.dispensing_count = element.dispensing_count + 1;
                            dispense_status_scanded_ids.push(dispense_id);


                            if (element.dispensing_count == count) {
                                element.dispense_status = status;
                            }
                        } else
                        if (status == "{delivered}" && element.delivered_count < count && delivered_status_scanded_ids.indexOf(dispense_id) == -1) {
                            element.delivered_count = element.delivered_count + 1;
                            delivered_status_scanded_ids.push(dispense_id);
                            if (element.delivered_count == count) {
                                element.dispense_status = status;
                            }
                        }
                        console.log('************************************************');
                        console.log('element.delivered_count ===========================================', element.delivered_count);

                        console.log('updated_item.status ===========================================', status);
                        console.log('updated_item.status ===========================================', element.dispense_status);
                        console.log('************************************************');

                        console.log('************************************************');
                        console.log(' element.dispense_status_scanded_ids', element.dispense_status_scanded_ids);
                        console.log('************************************************');
                        console.log('************************************************');
                        console.log(' element.delivered_status_scanded_ids', element.delivered_status_scanded_ids);
                        console.log('************************************************');
                        console.log('data', {
                            "dispense_status": element.dispense_status,
                            "dispensing_count": element.dispensing_count,
                            "delivered_count": element.delivered_count,
                            "dispense_status_scanded_ids": dispense_status_scanded_ids.join(","),
                            "delivered_status_scanded_ids": delivered_status_scanded_ids.join(",")
                        });
                        console.log('************************************************');
                        OrderItemModel.update({
                            "_id": element._id
                        }, {
                            "dispense_status": element.dispense_status,
                            "dispensing_count": element.dispensing_count,
                            "delivered_count": element.delivered_count,
                            "dispense_status_scanded_ids": dispense_status_scanded_ids.join(","),
                            "delivered_status_scanded_ids": delivered_status_scanded_ids.join(",")
                        }, {}, function (error, reply) {
                            if (error) {
                                console.log('************************************************');
                                console.log('error at 177 plcio', error);
                                console.log('************************************************');
                            }
                            console.log('************************************************');
                            console.log('reply at 181 plcio', reply);
                            console.log('************************************************');
                        });
                    }
                    item_statuses.push(element.dispense_status);
                }

                console.log('************************************************');
                console.log('item_statuses', item_statuses);
                console.log('************************************************');

                if (updated_item.status == "timeout") {
                    order_status = "{timeout}";
                } else {
                    if (item_statuses.indexOf("{pending}") > -1) {
                        order_status = "{pending}";
                    } else if (item_statuses.indexOf("{dispensing}") > -1) {
                        order_status = "{dispensing}";
                    } else {
                        order_status = "{delivered}";
                    }
                }
                console.log('************************************************');
                console.log('order_status', order_status);
                console.log('************************************************');
                //process.exit();
                OrderModel.update({
                    "_id": order_details._id
                }, {
                    "dispense_status": order_status
                }, {}, function (err, reply) {
                    if (err) {
                        console.log('************************************************');
                        console.log('error on 207', error);
                        console.log('************************************************');

                    }
                    console.log('************************************************');
                    console.log('reply on plcico 207', reply);
                    console.log('************************************************');
                });
            }
        });



    }
}




function getItemBarcode(order_stub) {
    return order_stub.substr(2, 34);
}
// This call returns the dispenser queue data structure to the plcio daemon
// The order queue is of this format - [{"dispense_id": "", "status": "", "order_stub": ""}]
router.get('/order_queue', function (req, res, next) {
    redisClient.lrange(helper.dispenser_queue_node, 0, -1,
        function (q_err, q_reply) {
            if (q_err) {
                debug(q_err);
                res.status(500).send("error while retreiving from redis- {}".format(q_err));
                return;
            }
            var queue = [];
            for (var i = 0; i < q_reply.length; i++) {
                queue.push(JSON.parse(q_reply[i]));
            }
            res.send(queue);
        });
});

// This is the call when any changes in stock count occurs
// It should have a list of barcodes wth their count and slot_ids
// [{"barcode": "frggt564g", "count":2, "slot_ids": "3,4,5"}, {..}], [total_slot_list]
router.post('/submit_scanned_stock', function (req, res, next) {
    debug("Stock submitted- ", JSON.stringify(req.body.data));
    
    internetAvailable({
         timeout: 1000,
         retries: 3,
    }).then(function () {
        submit_scanned_stocks(req, res, next);
        return;
    }).catch(function () {
        submit_scanned_and_create_po(req, res, next);
        return;
    });

    // internetAvailable({
    //     timeout: 1000,
    //     retries: 3,
    // }).then(function () {
    //     requestretry({
    //             url: hq_url + TEST_MODE_ISSUES_URL + outlet_id,
    //             method: "GET",
    //             timeout: 1000,
    //         },
    //         function (error, response, body) {
    //             if (error || (response && response.statusCode != 200)) {
    //                 submit_scanned_and_create_po(req, res, next);
    //                 return;
    //             } else {
    //                 submit_scanned_stocks(req, res, next);
    //                 return;
    //             }

    //         });

    // }).catch(function () {
    //     submit_scanned_and_create_po(req, res, next);
    //     return;
    // });
    //submit_scanned_and_create_po(req, res, next);
});


function submit_scanned_and_create_po(req, res, next) {
    //console.error('{}: {} {}'.format(hq_url, error, response));
    async.waterfall([
            function (callback) {
                redisClient.get(helper.menu_bands_node, function (error, reply) {
                    if (error) {
                        callback(error, null);
                    }
                    data = reply;
                    if (typeof data == "string") {
                        data = JSON.parse(data);
                        callback(null, data);
                    }
                });
            },
            function (menu_bands_data, callback) { //get all po ids from the scan items


                var plcio_data = req.body.data;
                var allpoids = []; //contains all the po details
                var allpodetailsscanned = {}; //has the details for the pos
                var allitemids = []; //has all the item ids
                var allitem_qty = {}; //has details of po ids qty details
                plcio_data.forEach(function (element) {
                    var barcode = element.barcode;
                    var po_id = Number(barcode.substr(barcode.length - 8));
                    var details = extractDetails(barcode);
                    var item_id = details[0];
                    var timestamp = details[1];

                    //allitem_qty[item_id] = 0;
                    var qty = 1;
                    if (allpoids.indexOf(po_id) == -1) {
                        allpoids.push(po_id);
                        allpodetailsscanned[po_id] = [];
                        allitem_qty[po_id] = {};
                    }

                    allitemids.push(item_id);

                    if (typeof date == "undefined" || timestamp > date) {
                        date = timestamp;
                    }
                    if (typeof allitem_qty[po_id][item_id] != "undefined" && allitem_qty[po_id][item_id] >= 1) {
                        allitem_qty[po_id][item_id] = allitem_qty[po_id][item_id] + 1;
                    } else {
                        allitem_qty[po_id][item_id] = 1;
                        allpodetailsscanned[po_id].push({
                            "item_id": item_id,
                            "timesamp": timestamp,
                            "barcode": barcode,
                            "po_id": po_id
                        });
                    }

                }, this);

                date = new Date();

                // Hours part from the timestamp
                var hours = date.getHours();
                // Minutes part from the timestamp
                var minutes = "0" + date.getMinutes();
                // Seconds part from the timestamp
                var seconds = "0" + date.getSeconds();

                // Will display time in 10:30:23 format
                var formattedTime = hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);

                other_detials = {};
                menu_bands_data.forEach(function (element) {
                    if (formattedTime > element.start_time && formattedTime < element.end_time) {
                        other_detials.start_time = element.start_time;
                        other_detials.end_time = element.end_time;
                        other_detials.session_name = element.name;
                        other_detials.scheduled_time = JSON.parse(JSON.stringify(date));
                    }
                }, this);
                other_detials.scheduled_time = JSON.parse(JSON.stringify(date));
                debug(allitemids);

                callback(null, allpoids, allpodetailsscanned, allitemids, allitem_qty, other_detials);
            },
            function (allpoids, allpodetailsscanned, allitemids, allitem_qty, other_detials, callback) { //creating po details from the details gained
                getAllItemDetails(allitemids, function (error, mainitemdetails) {
                    if (error) {
                        console.log('************************************************');
                        console.log('error from line 293', error);
                        console.log('************************************************');
                        callback(error, null);
                    }
                    console.log('************************************************');
                    console.log('other_detials', other_detials);
                    console.log('************************************************');
                    date = new Date();
                    date = JSON.parse(JSON.stringify(date));
                    console.log('mainitemdetails', mainitemdetails);

                    for (var key in allpodetailsscanned) {
                        if (allpodetailsscanned.hasOwnProperty(key)) {
                            var po_details = allpodetailsscanned[key];
                            for (var index = 0; index < po_details.length; index++) {
                                var element = po_details[index];
                                allpodetailsscanned[key][index].po_id = Number(key);
                                allpodetailsscanned[key][index].scheduled_time = date;
                                allpodetailsscanned[key][index].r_id = mainitemdetails[element.item_id][0].r_id;
                                allpodetailsscanned[key][index].rest_name = mainitemdetails[element.item_id][0].r_name;
                                allpodetailsscanned[key][index].rest_short_name = mainitemdetails[element.item_id][0].r_short_name;
                                allpodetailsscanned[key][index].food_item_id = mainitemdetails[element.item_id][0].id;
                                allpodetailsscanned[key][index].item_tag = mainitemdetails[element.item_id][0].item_tag;
                                allpodetailsscanned[key][index].item_name = mainitemdetails[element.item_id][0].name;
                                //allpodetailsscanned[key][index].item_name = mainitemdetails[element.item_id][0].item_name;
                                allpodetailsscanned[key][index].qty = allitem_qty[key][mainitemdetails[element.item_id][0].id];
                                allpodetailsscanned[key][index].master_id = mainitemdetails[element.item_id][0].master_id;
                                allpodetailsscanned[key][index].is_set_on_HQ = false;
                                allpodetailsscanned[key][index].is_generated_from_scan = true;
                                allpodetailsscanned[key][index].is_offline_reconcile_done = "n";
                                allpodetailsscanned[key][index].session_name = other_detials.session_name;
                                allpodetailsscanned[key][index].start_time = other_detials.start_time;
                                allpodetailsscanned[key][index].end_time = other_detials.end_time;
                                console.log('************************************************');
                                console.log('allpodetailsscanned', allpodetailsscanned);
                                console.log('************************************************');

                            }

                        }
                    }

                    callback(null, allpodetailsscanned);
                });

            },
            function (allpodetailsscanned, callback) {
                async.parallel({
                        offline_po_details: function (callback) {
                            redisClient.get(helper.offline_po_request_node, function (error, reply) {
                                if (reply != null && typeof reply == "string") {
                                    reply = JSON.parse(reply);
                                }
                                console.log('************************************************');
                                console.log('reply', reply);
                                console.log('************************************************');
                                callback(error, reply);
                            });
                        },
                        po_details: function (callback) {
                            redisClient.get(helper.po_details_node, function (error, reply) {
                                if (reply != null && typeof reply == "string") {
                                    reply = JSON.parse(reply);
                                }
                                callback(error, reply);
                            });
                        },
                        reconsile_details: function (callback) {
                            redisClient.lrange(helper.reconcile_data_node, 0, -1, function (error, reply) {
                                maindataloop = reply;
                                if (typeof maindataloop == "string") {
                                    maindataloop = JSON.parse(maindataloop);
                                }
                                callback(error, reply);
                            });
                        }
                    },
                    function (error, results) {
                        //  get all the poids scanned of today 
                        reconsiled_po_ids = [];
                        reconsilepo_ids = results.reconsile_details.forEach(function (details) {
                            jsondetails = JSON.parse(details);
                        reconsiled_po_ids.push(parseInt(jsondetails[0].po_id));
                        })
                        mainscanids = [];
                        scanids = Object.keys(allpodetailsscanned);
                        maptoscanornot = [];
                        flag = true;
                        scanids.forEach(function (ids) {
                            if (reconsiled_po_ids.indexOf(parseInt(ids)) != -1) {
                                maptoscanornot[parseInt(ids)] = false;
                            } else {
                                maptoscanornot[parseInt(ids)] = true;
                            }
                        });
                        debug("already reconsiled ids ", reconsiled_po_ids, flag);


                        offline_po_details = results.offline_po_details;
                        po_details = results.po_details;
                        // if (flag) {
                        if (offline_incomming_po == null) {
                            offline_po_details = {};
                        }
                        alloflineposids = [];

                        if (typeof offline_po_details == "undefinded" || offline_po_details == null) {
                            offline_po_details = allpodetailsscanned;
                        } else {
                            alloflineposids = Object.keys(offline_po_details);
                            for (var key in allpodetailsscanned) {
                                if (allpodetailsscanned.hasOwnProperty(key)) {
                                    var element = allpodetailsscanned[key];
                                    if ((!offline_po_details.hasOwnProperty(key) || offline_po_details[key].length != allpodetailsscanned[key].length) && maptoscanornot[key]) {
                                        offline_po_details[key] = element;
                                    } else {
                                        if (typeof offline_po_details[key] != "undefined") {
                                            offline_po_details[key].forEach(function (item, index) {
                                                offlinepocount = offline_po_details[key][index]["qty"];
                                                scancount = allpodetailsscanned[key][index]["qty"];
                                                if (scancount != offlinepocount) {
                                                    offline_po_details[key][index]["qty"] = scancount;
                                                }
                                            });
                                            /* offline_po_details[key].forEach(function(item,index){
                                            offlinepocount = offline_po_details[key][index]["qty"];
                                            scancount = allpodetailsscanned[key][index]["qty"];
                                            if (scancount!=offlinepocount){
                                                offline_po_details[key][index]["qty"] = scancount;
                                            }
                                        });*/

                                        }


                                    }
                                }
                            }
                        }
                        // process.exit();
                        redisClient.set(helper.offline_po_request_node, JSON.stringify(offline_po_details), function (error, reply) {
                            callback(error, offline_po_details, po_details, flag);
                        })
                        // } else {

                        //     process.exit();
                        //     callback(error, offline_po_details, po_details, flag);
                        // }

                    });
            },
            function (offline_po_details, alloflineposids, flag, callback) {
                // if (flag) {
                if (alloflineposids != null) {
                    for (var key in offline_po_details) {
                        if (offline_po_details.hasOwnProperty(key)) {
                            var element = offline_po_details[key];
                            if ((!alloflineposids.hasOwnProperty(key) || offline_po_details[key].length != alloflineposids[key].length)) {
                                alloflineposids[key] = element;
                            } else {
                                alloflineposids[key].forEach(function (item, index) {
                                    offlinepocount = alloflineposids[key][index]["qty"];
                                    scancount = offline_po_details[key][index]["qty"];
                                    if (scancount != offlinepocount) {
                                        alloflineposids[key][index]["qty"] = scancount;
                                    }
                                });
                            }
                        }
                    }
                    redisClient.set(helper.po_details_node,
                        JSON.stringify(alloflineposids),
                        function (store_po_details_err, store_po_details_reply) {
                            if (store_po_details_err) {
                                console.error('error while inserting in redis- {}'.format(store_po_details_err));
                            }
                            callback(store_po_details_err, store_po_details_reply);
                        });
                } else {
                    redisClient.set(helper.po_details_node,
                        JSON.stringify(offline_po_details),
                        function (store_po_details_err, store_po_details_reply) {
                            if (store_po_details_err) {
                                console.error('error while inserting in redis- {}'.format(store_po_details_err));
                            }
                            callback(store_po_details_err, store_po_details_reply);
                        });
                }
                // } else {
                //     callback(null, []);
                // }

            }

        ],
        function (error, data) { //setting the po details in the listing provided
            if (error) {
                console.log('************************************************');
                console.log('error', error);
                console.log('************************************************');
                res.status(500).send('redis down');
                return;
            }
            offline_incomming_po();
            submit_scanned_stocks(req, res, next);
            return;
        });
}



function getAllItemDetails(allitemids, callback) {
    //console.log("allitemids",allitemsids);
    //process.exit();   
    console.log('************************************************');
    console.log('{ "id": { $in: allitemids } }', {
        "id": {
            $in: allitemids
        }
    });
    console.log('************************************************');

    FoodItemModel.find({
        "id": {
            $in: allitemids
        }
    }, function (error, reply) {
        if (error) {
            // console.log('error',error);
            // process.exit();
            callback(error, null);
        } else {
            var maindata = _.groupBy(reply, function (value) {
                return value.id;
            });
            //console.log('maindata',maindata);

            callback(null, maindata);
        }
    });
}

function submit_scanned_stocks(req, res, next) {
    var append_flag = req.body.append_only;
    if (append_flag == undefined) {
        append_flag = false;
    }
    debug("Append flag is ", append_flag);
    // Throw an error if content-type is not application/json
    if (req.get('Content-Type') != 'application/json') {
        res.status(415).send('');
        return;
    }

    var plcio_data = req.body.data;
    debug("plcio_data.length: " + plcio_data.length);
    debug("append_flag: " + append_flag);
    if (!append_flag && plcio_data.length == 0) {
        console.log("Wipe-off :: Reduce_Stock_in_Reconcile_wipeoff function called");
        // Reduce_Stock_in_Reconcile_wipeoff();
    }

    if (plcio_data == undefined) {
        debug("No stock data submitted");
        return res.send('failure');
    }
    var stock_count = {};
    var stock_count_reconcile = {};
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
        var slot_list = [];
        for (var i = 1; i <= dispenser_slot_count; i++) {
            slot_list.push(i);
        }
        redisClient.lrange(helper.dispenser_queue_node, 0, -1,
            function (q_err, q_reply) {
                console.log('************************************************');
                console.log('q_reply', q_reply);
                console.log('************************************************');

                if (q_err) {
                    debug(q_err);
                    res.status(500).send("error while retreiving from redis- {}".format(q_err));
                    return;
                }

                // Preparing the pending queue
                var pending_queue = {};
                for (var i = 0; i < q_reply.length; i++) {
                    parsed_q_item = JSON.parse(q_reply[i]);
                    var barcode = getBarcode(parsed_q_item["order_stub"]);
                    // Only if the status is idle
                    if (parsed_q_item["status"] === "pending") {
                        if (barcode in pending_queue) {
                            pending_queue[barcode]++;
                        } else {
                            pending_queue[barcode] = 1;
                        }
                    }
                }

                // Making the stock count data structure
                var scanned_slot_ids = [];
                var existing_stock_count_reconcile;

                for (var i = 0; i < plcio_data.length; i++) {
                    var barcode = plcio_data[i]["barcode"];

                    // Verify if the barcode is not jumbled up
                    if (!verifyBarcode(barcode)) {
                        debug("Scrambled barcode detected- ", barcode);
                        continue;
                    }
                    var slot_ids = [];
                    var count = plcio_data[i]["count"];
                    slot_ids = (plcio_data[i]["slot_ids"]).split(',').map(Number);
                    var details = extractDetails(barcode);
                    var item_id = details[0];
                    var timestamp = details[1];

                    // Verify if the item_id belongs to the DB
                    if (!verifyValidItemId(item_id)) {
                        debug("Item id- ", item_id, " does not belong to DB");
                        continue;
                    }

                    // store the slot_ids somewhere
                    // console.log("slot_ids: " + JSON.stringify(slot_ids));
                    scanned_slot_ids = scanned_slot_ids.concat(slot_ids);
                    // reducing by the no. of items in pending queue
                    if (barcode in pending_queue) {
                        count -= pending_queue[barcode];
                    }

                    if (!(item_id in stock_count)) {
                        // the item in this barcode was never seen before.
                        stock_count[item_id] = {
                            "item_details": []
                        };
                    }
                    stock_count[item_id]["item_details"].push({
                        "barcode": barcode,
                        "count": count,
                        "slot_ids": slot_ids,
                        "timestamp": timestamp,
                        "expired": false,
                        "spoiled": false,
                        "isExpired_InsertedintoDb": false
                    });
                }

                // console.log("scanned_slot_ids: " + JSON.stringify(scanned_slot_ids));

                // Now calculate the diff of the total slot ids with the scanned slot ids
                // store the data in redis
                var unscanned_slots = slot_list.diff(scanned_slot_ids);
                // console.log("unscanned_slots: " + JSON.stringify(unscanned_slots));
                redisClient.set(helper.unscanned_slots_node,
                    JSON.stringify(unscanned_slots),
                    function (set_err, set_reply) {
                        if (set_err) {
                            return debug(set_err);
                        }
                        debug("Updated the unscanned slots node");
                    });

                // Copying from the tmp node and pasting to the main node
                redisClient.get(helper.last_load_tmp_node,
                    function (get_err, get_reply) {
                        if (get_err) {
                            return debug(get_err);
                        }
                        if (!get_reply) {
                            debug("last load tmp node not set yet");
                            return;
                        }
                        if (!get_reply) {
                            debug("last load tmp node not set yet");
                            return;
                        }
                        redisClient.set(helper.last_load_info_node,
                            get_reply,
                            function (set_err, set_reply) {
                                if (set_err) {
                                    return debug(set_err);
                                }
                                debug("Updated the last load info node");
                            });
                    });

                if (!append_flag) {
                    console.log("FT 1 *************************************************************:");
                    // if stock count is empty, that means need to clear the previous locks
                    if (Object.keys(stock_count).length == 0) {
                        redisClient.get(helper.stock_count_node,
                            function (get_err, get_reply) {
                                // so get the stock data, get the items, then
                                // set the locked count to 0
                                var old_stock = JSON.parse(get_reply);
                                var item_lock_counts = []
                                var multi = redisClient.multi();
                                for (var item_id in old_stock) {
                                    multi.set(item_id + '_locked_count', 0, function (set_err, set_reply) {
                                        if (set_err) {
                                            console.log(set_err);
                                        }
                                    });

                                    multi.set(item_id + '_mobile_locked_count', 0, function (set_err, set_reply) {
                                        if (set_err) {
                                            console.log(set_err);
                                        }
                                    });
                                }

                                // then set the new data and updateOtherStuff(stock_co)
                                multi.exec(function (err, replies) {
                                    // Put the data in redis
                                    redisClient.set(helper.stock_count_node,
                                        JSON.stringify(stock_count),
                                        function (set_err, set_reply) {
                                            if (set_err) {
                                                debug(set_err);
                                            }
                                        });
                                    updateOtherStuff(stock_count);
                                    console.log('************************************************');
                                    console.log('helper.reconcile_stock_count_node', helper.reconcile_stock_count_node);
                                    console.log('************************************************');

                                    if (plcio_data != undefined && plcio_data.length > 0) {
                                        console.log("First Time added in reconcile_stock_count 1: " + JSON.stringify(stock_count));
                                        // Put the data in redis for reconcile_stock_count
                                        var result_array = Json_format_stock_count(stock_count);



                                        redisClient.set(helper.reconcile_stock_count_node,
                                            JSON.stringify(result_array),
                                            function (set_err, set_reply) {
                                                if (set_err) {
                                                    debug(set_err);
                                                }
                                            });
                                    }
                                });
                            });
                    } else {
                        // Put the data in redis
                        redisClient.set(helper.stock_count_node,
                            JSON.stringify(stock_count),
                            function (set_err, set_reply) {
                                if (set_err) {
                                    debug(set_err);
                                }
                            });
                        updateOtherStuff(stock_count);
                        console.log("First Time added in reconcile_stock_count 4: " + JSON.stringify(stock_count));
                    }
                } else {
                    redisClient.get(helper.stock_count_node,
                        function (get_err, get_reply) {
                            //merge the two
                            var existing_stock_count = JSON.parse(get_reply);

                            if (existing_stock_count) {
                                for (var item_id in stock_count) {
                                    if (existing_stock_count.hasOwnProperty(item_id)) {
                                        // then append to existing
                                        existing_stock_count[item_id]["item_details"] = existing_stock_count[item_id]["item_details"].concat(stock_count[item_id]["item_details"]);
                                    } else {
                                        // create new node
                                        existing_stock_count[item_id] = {};
                                        existing_stock_count[item_id]["item_details"] = stock_count[item_id]["item_details"];
                                    }
                                }
                            } else {
                                existing_stock_count = stock_count;
                            }
                            // set in redis
                            redisClient.set(helper.stock_count_node,
                                JSON.stringify(existing_stock_count),
                                function (set_err, set_reply) {
                                    if (set_err) {
                                        debug(set_err);
                                    }
                                });

                            // update Other stuff
                            updateOtherStuff(existing_stock_count);


                            //var result_array = Json_format_stock_count(existing_stock_count_reconcile);
                            //redisClient.set(helper.reconcile_stock_count_node,
                            //              JSON.stringify(result_array),
                            //              function (set_err, set_reply) {
                            //                  if (set_err)
                            //                  {
                            //                      debug(set_err);
                            //                  }
                            //              });
                        });
                }

                if (Object.keys(stock_count).length != 0) {
                    // Put the data in redis for reconcile_stock_count
                    console.log("WO wipe-off 1 added in reconcile_stock_count : " + JSON.stringify(existing_stock_count_reconcile));
                    // scanned items and stored in Redis with key as reconcile_stock_count 
                    redisClient.get(helper.reconcile_stock_count_node,
                        function (get_err, get_reply) {
                            // Getting existing reconcile_stock_count
                            existing_stock_count_reconcile = JSON.parse(get_reply);
                            console.log("WO wipe-off 2 existing_stock_count_reconcile new: " + JSON.stringify(existing_stock_count_reconcile));
                            if (existing_stock_count_reconcile) {
                                for (var item_id in stock_count) {
                                    var items = stock_count[item_id]["item_details"];


                                    for (i = 0; i < items.length; i++) {
                                        // checking stock_count itemid with exisiting_stock_count_reconcile
                                        var reconcile_stock_item_data = _.where(existing_stock_count_reconcile, {
                                            'barcode': stock_count[item_id]["item_details"][i].barcode
                                        });
                                        if (reconcile_stock_item_data.length == 0) {
                                            var barcode = stock_count[item_id].item_details[i].barcode;
                                            var po_id = barcode.substr(barcode.length - 8);
                                            var result_json = {
                                                "po_id": po_id,
                                                "item_id": item_id,
                                                "barcode": barcode,
                                                "count": stock_count[item_id].item_details[i].count,
                                                "timestamp": stock_count[item_id].item_details[i].timestamp,
                                                "is_reconciled": false
                                            }
                                            existing_stock_count_reconcile.push(result_json);
                                        }
                                    }

                                    // Put the data in redis for reconcile_stock_count
                                    console.log("WO wipe-off 3 added in reconcile_stock_count : " + JSON.stringify(existing_stock_count_reconcile));
                                    if (existing_stock_count_reconcile.length < 0) {
                                        console.log('************************************************');
                                        console.log('plc ico line 473', existing_stock_count_reconcile);
                                        console.log('************************************************');
                                    }

                                    redisClient.set(helper.reconcile_stock_count_node,
                                        JSON.stringify(existing_stock_count_reconcile),
                                        function (set_err, set_reply) {
                                            if (set_err) {
                                                debug(set_err);
                                            }
                                        });
                                }
                            } else {
                                existing_stock_count_reconcile = stock_count;
                                var result_array = Json_format_stock_count(existing_stock_count_reconcile);
                                console.log("WO wipe-off 4 new stock_count :: stock_count_reconcile: " + JSON.stringify(existing_stock_count_reconcile));
                                // Put the data in redis for reconcile_stock_count
                                console.log("WO wipe-off 5 added in reconcile_stock_count : " + JSON.stringify(existing_stock_count_reconcile));

                                if (result_array > 0) {
                                    console.log('************************************************');
                                    console.log('plcico line 494');
                                    console.log('************************************************');
                                    console.log('************************************************');
                                    console.log('helper.reconcile_stock_count_node', helper.reconcile_stock_count_node);
                                    console.log('************************************************');
                                }
                                redisClient.set(helper.reconcile_stock_count_node,
                                    JSON.stringify(result_array),
                                    function (set_err, set_reply) {
                                        if (set_err) {
                                            debug(set_err);
                                        }
                                    });
                            }


                        });
                }

                function updateOtherStuff(stock_count) {
                    var item_lock_counts = []
                    for (var item_id in stock_count) {
                        item_lock_counts.push(item_id + '_locked_count');
                        item_lock_counts.push(item_id + '_mobile_locked_count');
                    }

                    // Get the lock counts, merge with stock_count and set in firebase
                    if (item_lock_counts.length) {
                        redisClient.mget(item_lock_counts, function (set_err, set_reply) {
                            if (set_err) {
                                debug(set_err);
                                return;
                            }

                            var firebase_stock_count = stock_count;
                            for (var item_id in firebase_stock_count) {
                                if (set_reply[item_lock_counts.indexOf(item_id + '_locked_count')]) {
                                    firebase_stock_count[item_id]["locked_count"] = parseInt(set_reply[item_lock_counts.indexOf(item_id + '_locked_count')]);
                                } else {
                                    // setting the values to a default count of 0
                                    firebase_stock_count[item_id]["locked_count"] = 0;
                                }

                                if (set_reply[item_lock_counts.indexOf(item_id + '_mobile_locked_count')]) {
                                    firebase_stock_count[item_id]["mobile_locked_count"] = parseInt(set_reply[item_lock_counts.indexOf(item_id + '_mobile_locked_count')]);
                                } else {
                                    // setting the values to a default count of 0
                                    firebase_stock_count[item_id]["mobile_locked_count"] = 0;
                                }
                            }
                            debug("Setting stock count as- ", JSON.stringify(firebase_stock_count));
                            io.emit('stock_count', firebase_stock_count);
                            io.sockets.emit('stock_count', firebase_stock_count);

                            // Put the data in firebase
                            var rootref = new firebase(process.env.FIREBASE_CONN);
                            var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                            stock_count_node.set(firebase_stock_count);
                        });
                    } else {
                        // Setting empty data in firebase and to order apps
                        // Put the data in firebase
                        debug("Setting empty stock count");
                        var rootref = new firebase(process.env.FIREBASE_CONN);
                        var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                        stock_count_node.set({});
                        io.emit('stock_count', {});
                        io.sockets.emit('stock_count', {});

                        // Return a success message
                        res.send('success');

                        debug("Setting dispenser status to empty due to wipe-off");
                        redisClient.set(helper.dispenser_status_node, 'empty', function (d_set_err) {
                            if (d_set_err) {
                                console.error(d_set_err);
                            }
                        });
                        io.emit('dispenser_empty', true);
                        io.sockets.emit('dispenser_empty', true);
                        return;
                    }

                    // Appending to the zero sales count
                    redisClient.get(helper.zero_sales_count_node, function (redis_err, redis_res) {
                        if (redis_err) {
                            debug(redis_err);
                            return;
                        }
                        var zero_sales = JSON.parse(redis_res);
                        if (zero_sales) {
                            for (var item_id in stock_count) {
                                // Not appending to zero sales list, if it is a test mode item
                                if (isTestModeItem(item_id)) {
                                    continue;
                                }
                                for (var i = 0; i < stock_count[item_id]["item_details"].length; i++) {
                                    barcode = stock_count[item_id]["item_details"][i]["barcode"];
                                    // make this to a function
                                    if (!(item_id in zero_sales)) {
                                        zero_sales[item_id] = stock_count[item_id];
                                        continue;
                                    }
                                    if (!checkBarcodePresent(barcode, zero_sales[item_id]["item_details"])) {
                                        zero_sales[item_id]["item_details"].push(stock_count[item_id]["item_details"][i]);
                                    }
                                }
                            }
                        } else {
                            for (var item_id in stock_count) {
                                // Not appending to zero sales list, if it is a test mode item
                                if (isTestModeItem(item_id)) {
                                    delete stock_count[item_id];
                                }
                            }
                            zero_sales = stock_count;
                        }

                        // updated_zero_item list needs to be repushed again
                        redisClient.set(helper.zero_sales_count_node,
                            JSON.stringify(zero_sales),
                            function (err, set_zero_sales_reply) {
                                if (err) {
                                    debug('error while inserting in redis- {}'.format(err));
                                }
                            });
                    });


                    // Set the dispenser status to working
                    redisClient.set(helper.dispenser_status_node,
                        'working',
                        function (err, reply) {
                            if (err) {
                                debug('error while inserting in redis- {}'.format(err));
                            }
                            // Sending the signal to the order app to hide the delay message
                            io.emit('order_delay', false);
                            io.sockets.emit('order_delay', false);
                        });

                    // Resetting dispenser_empty flag, because new stock is loaded now
                    io.emit('dispenser_empty', false);
                    io.sockets.emit('dispenser_empty', false);

                    // Return a success message
                    res.send('success');
                }
            });
    });

}
// This is the call when the status of dispenser changes
// The json data has status as key and value can be "loading", "empty", "working"
router.post('/dispenser_status', function (req, res, next) {
    debug(req.body.status);
    // Throw an error if content-type is not application/json
    if (req.get('Content-Type') != 'application/json') {
        res.status(415).send('');
        return;
    }

    // Throw an error if status not in the predefined values
    if (req.body.status !== 'loading' &&
        req.body.status !== 'empty' &&
        req.body.status !== 'working') {
        res.status(400).send('');
        return;
    }

    // Put the data in redis
    redisClient.set(helper.dispenser_status_node,
        req.body.status,
        function (err, reply) {
            if (err) {
                res.status(500).send('error while inserting in redis- {}'.format(err));
                return;
            }
            if (req.body.status === 'loading') {
                io.emit('order_delay', true);
            } else {
                io.emit('order_delay', false);
            }
            // Return a success message
            res.send('success');
        });

});

// This is the call that the plcio will make to get the initial bootstrap config
router.get('/config', function (req, res, next) {
    redisClient.get(helper.plc_config_node, function (err, reply) {
        if (err) {
            debug('error while retreiving from redis- {}'.format(err));
            res.status(500).send('error while retreiving from redis- {}'.format(err));
            return;
        }
        var plc_config = JSON.parse(reply);
        res.send(plc_config);
    });
});

// helper functions
function checkBarcodePresent(barcode, item_details) {
    for (var i = 0; i < item_details.length; i++) {
        if (barcode === item_details[i]["barcode"]) {
            return true;
        }
    }
    return false;
}

function extractDetails(barcode) {
    if (checkIfTestMode(barcode.substr(8, 4))) {
        item_id = parseInt(barcode.substr(8, 4));
    } else {
        item_id = parseInt(barcode.substr(8, 4), 36);
    }
    day = Number(barcode.substr(12, 2));
    // weird javascript convention that the month starts from 0
    month = Number(barcode.substr(14, 2)) - 1;
    year = Number(barcode.substr(16, 4));
    hours = Number(barcode.substr(20, 2));
    minutes = Number(barcode.substr(22, 2));
    var date_obj = new Date(year, month, day, hours, minutes);
    var timestamp = Math.floor(date_obj.getTime() / 1000);
    return [item_id, timestamp];
}

function verifyBarcode(barcode) {
    // First 2 chars should be text
    var city = barcode.substr(0, 2);

    // Next 3 should be integer
    var outlet_id = Number(barcode.substr(2, 3));
    if (!isInt(outlet_id)) {
        return false;
    }

    var timestamp = Number(barcode.substr(12, 12));
    if (!isInt(timestamp)) {
        return false;
    }
    return true;
}

function verifyValidItemId(item_id) {
    // Confirm whether this is not a test mode item
    if (item_id >= 9000 && item_id <= 9099) {
        return true;
    }
    // First check if this has been populated or not
    if (OUTLET_ITEM_IDS.length == 0) {
        return true;
    }
    if (OUTLET_ITEM_IDS.indexOf(item_id) == -1) {
        return false;
    } else {
        return true;
    }
}

function isInt(n) {
    return Number(n) === n && n % 1 === 0;
};

function checkIfTestMode(barcode) {
    if (barcode[0] == '9' && barcode[1] == '0') {
        return true;
    } else {
        return false;
    }
}

function isTestModeItem(item_code) {
    if (item_code >= 9000 && item_code <= 9099) {
        return true;
    } else {
        return false;
    }
}

function getBarcode(order_stub) {
    return order_stub.substr(2, 32);
}


function getBillNo(order_stub) {
    return parseInt(order_stub.substr(52, 8));
}

function computeDispenseStatus(current_status, new_status) {
    var priorityMap = {
        'timeout': -1,
        'pending': 0,
        'dispensing': 1,
        'delivered': 2
    }
    if (current_status === undefined) {
        return new_status;
    }
    if (priorityMap[current_status] <= priorityMap[new_status]) {
        return current_status;
    } else {
        return new_status;
    }
}

function Json_format_stock_count(data_stock_count) {
    var item_array = [];
    for (var obj in data_stock_count) {
        if (data_stock_count.hasOwnProperty(obj)) {
            for (var prop in data_stock_count[obj].item_details) {
                if (data_stock_count[obj].item_details.hasOwnProperty(prop)) {
                    var barcode = data_stock_count[obj].item_details[prop].barcode;
                    var po_id = barcode.substr(barcode.length - 8);
                    var result_json = {
                        "po_id": po_id,
                        "item_id": obj,
                        "barcode": barcode,
                        "count": data_stock_count[obj].item_details[prop].count,
                        "timestamp": data_stock_count[obj].item_details[prop].timestamp,
                        "is_reconciled": false
                    }
                    item_array.push(result_json);
                }
            }
        }
    }

    return item_array;
}

function Reduce_Stock_in_Reconcile_wipeoff() {

    redisClient.get(helper.stock_count_node,
        function (get_err, get_stock_count) {
            // Getting existing stock_count
            var existing_stock_count = JSON.parse(get_stock_count);

            redisClient.get(helper.reconcile_stock_count_node,
                function (get_err, get_reconcile_stock_count) {
                    // Getting existing reconcile_stock_count
                    var existing_reconcile_stock_count = JSON.parse(get_reconcile_stock_count);

                    for (var item_id in existing_stock_count) {
                        var item_barcodes = existing_stock_count[item_id]["item_details"];

                        for (i = 0; i < item_barcodes.length; i++) {
                            for (var reconcile_item_count in existing_reconcile_stock_count) {
                                if (existing_reconcile_stock_count[reconcile_item_count].item_id == item_id &&
                                    existing_reconcile_stock_count[reconcile_item_count].barcode == existing_stock_count[item_id]["item_details"][i].barcode) {
                                    // reduce the stock_count values in reconcile_stock_count
                                    existing_reconcile_stock_count[reconcile_item_count].count -= existing_stock_count[item_id]["item_details"][i].count;

                                    if (existing_reconcile_stock_count[reconcile_item_count].count < 0) {
                                        console.log("**************************** existing_reconcile_stock_count[reconcile_item_count].count: " + existing_reconcile_stock_count[reconcile_item_count].count);
                                        existing_reconcile_stock_count[reconcile_item_count].count = 0;
                                    }
                                }
                            }
                        }
                    }

                    // Put the data in redis for reconcile_stock_count
                    console.log("First Time added in reconcile_stock_count wipe-off clear data: " + JSON.stringify(existing_reconcile_stock_count));
                    // var result_array = Json_format_stock_count(existing_stock_count_reconcile);
                    console.log('************************************************');
                    console.log('helper.reconcile_stock_count_node', helper.reconcile_stock_count_node);
                    console.log('************************************************');
                    redisClient.set(helper.reconcile_stock_count_node,
                        JSON.stringify(existing_reconcile_stock_count),
                        function (set_err, set_reply) {
                            if (set_err) {
                                debug(set_err);
                            }
                        });
                });
        });
}

Array.prototype.diff = function (a) {
    return this.filter(function (i) {
        return a.indexOf(i) < 0;
    });
};

module.exports = router;