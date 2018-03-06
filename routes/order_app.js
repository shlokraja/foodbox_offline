/*jshint esversion: 6 */
var express = require('express');
var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var firebase = require('firebase');
var redis = require('redis');
var lockredis = require('lockredis');
var path = require('path');
var async = require('async');
var fs = require('fs');
var request = require('request');
var requestretry = require('requestretry');
var randomstring = require('randomstring');
var moment = require('moment');
var helper = require('./helper');
var startPrint = require('../misc/printer').startPrint;
var sendUpdatedSMS = require('../misc/printer').sendUpdatedSMS;
var isForcePrintBill = require('../misc/isForcePrintBill');
var internetAvailable = require("internet-available");
var PlaceOrderModel = require("../models/PlaceOrderModel");
var OrderModel = require("../models/OrderModel");
var OrderItemModel = require("../models/OrderItemModel");
var CashDetailModel = require("../models/CashDetailModel");
var cashdetails = require("../misc/cashdetails");
var FoodItemModel = require("../models/FoodItemModel");

var _ = require('underscore');

format.extend(String.prototype);
var redisClient = redis.createClient({
    connect_timeout: 2000,
    retry_max_delay: 5000
});
redisClient.on('error', function (msg) {
    console.error(msg);
});

var router = express.Router();

function wait(ms) {
    var start = new Date().getTime();
    var end = start;
    while (end < start + ms) {
        end = new Date().getTime();
    }
}

// Routes coming from the Order app

// This request will push the order related data to the plcio daemon
// to start serving the order
router.post('/place_order', function (req, res, next) {
    console.log("place_order req =+++++++++++=", req.body);
    var order_details = req.body.order;
    var counter_code = req.body.counter_code;
    var payment_mode = req.body.mode;
    var sides = req.body.sides;
    var from_counter = req.body.from_counter;
    var savings = req.body.savings;
    var bill_no = req.body.bill_no;
    var mobile_num = req.body.mobile_num;
    var credit_card_no = req.body.credit_card_no;
    var cardholder_name = req.body.cardholder_name;
    var unique_Random_Id = req.body.unique_Random_Id != undefined ? req.body.unique_Random_Id : '';
    var test_mode = null;
    var order_barcodes = [];
    console.log("unique_Random_Id received :- ", unique_Random_Id);
    // Getting the no. of items in the order
    var num_items = 0;

    for (var key in order_details) {
        num_items += order_details[key]["count"];
    }
    console.log("num_items", num_items);
    redisClient.get(helper.test_mode_flag, function (get_err, get_reply) {
        if (get_err) {
            debug(get_err);
            res.status(500).send({
                bill_no: -1
            });
            return;
        }
        test_mode = JSON.parse(get_reply);
        if (test_mode === null) {
            test_mode = false;
        }
        onTestModeRetrieved(test_mode);
    });

    // If no bill_no, that means, this has come from order app and we need to
    // create the bill_no
    function onTestModeRetrieved(test_mode) {
        if (bill_no == undefined) {
            if (test_mode) {
                bill_no = 0;
                moveForward(bill_no, test_mode);
            } else {
                // Incrementing the bill no.
                redisClient.incrby(helper.bill_no_node, 1, function (b_err, b_reply) {
                    if (b_err) {
                        debug(b_err);
                        res.status(500).send({
                            bill_no: -1
                        });
                        return;
                    }
                    bill_no = parseInt(b_reply) - 1;
                    moveForward(bill_no, test_mode);
                });
            }
        } else {
            moveForward(bill_no, test_mode);
        }
    }

    function moveForward(bill_no, test_mode) {
        isForcePrintBill()
            .then(function (is_force_print_bill) {
                // If it is test_mode or from_counter, we always do the dispensing
                if (payment_mode == 'card' || is_force_print_bill || from_counter || test_mode) {
                    io.emit('beverage_orders', {
                        bill_no: bill_no,
                        sides: sides
                    });

                    if (from_counter) {
                        var order_item_list = get_sales_order_items(order_details);
                        console.log("After Done remove queue_list");
                        // Get and update pending_done queue in redis.
                        redisClient.get(helper.pending_done_node, function (err, reply) {
                            if (err) {
                                console.log(err);
                            } else {
                                if (reply) {
                                    // The queue already exist so we are updating pending_done queue .
                                    var queue_list = JSON.parse(reply);
                                    console.log("remove queue_list");
                                    console.log(queue_list);
                                    _.each(order_item_list, function (value, key) {
                                        // Check new order item_id exist or not.
                                        // If exist update the count else push new item.
                                        if (queue_list.hasOwnProperty(key)) {
                                            queue_list[key] -= value;
                                            if (queue_list[key] <= 0) {
                                                delete queue_list[key];
                                            }
                                        }
                                    });
                                    // set updated items in redis queue.
                                    update_pending_done(queue_list);
                                }
                            }
                        });
                    }
                    var locker = lockredis(redisClient);
                    locker('lock_item', {
                        timeout: 5000,
                        retries: Infinity,
                        retryDelay: 10
                    }, function (lock_err, done) {
                        if (lock_err) {
                            // Lock could not be acquired for some reason.
                            debug(lock_err);
                            return res.status(500).send({
                                bill_no: -1
                            });
                        }

                        // Getting all the required items first with async.parallel.
                        // And then running the main logic in the callback
                        async.parallel({
                                dispense_id: function (callback) {
                                    // Incrementing the dispense id
                                    redisClient.incrby(helper.dispense_id_node, num_items, function (d_err, d_reply) {
                                        if (d_err) {
                                            callback("error while retreiving from redis- 1 {}".format(d_err), null);
                                            return;
                                        }
                                        callback(null, parseInt(d_reply) - num_items);
                                    });
                                },
                                stock_count: function (callback) {
                                    // Getting the stock count here
                                    redisClient.get(helper.stock_count_node, function (err, reply) {
                                        if (err) {
                                            callback("error while retreiving from redis- 2 {}".format(err), null);
                                            return;
                                        }
                                        callback(null, reply);
                                    });
                                },
                                item_expiry_details: function (callback) {
                                    // Getting the stock count here
                                    redisClient.lrange("itemexpirydetails", 0, -1, function (err, item_expiry_details) {
                                        if (err) {
                                            callback("error while retreiving from redis- {}".format(err), null);
                                            return;
                                        }
                                        callback(null, item_expiry_details);
                                    });
                                },
                                num_lanes: function (callback) {
                                    redisClient.get(helper.plc_config_node, function (err, reply) {
                                        if (err) {
                                            callback('error while retreiving from redis- 3 {}'.format(err), null);
                                            return;
                                        }
                                        var plc_config = JSON.parse(reply);
                                        // callback(null, plc_config.lane_count);
                                        callback(null, plc_config);
                                    });
                                },
                                outlet_phone_no: function (callback) {
                                    redisClient.get(helper.outlet_config_node, function (err, reply) {
                                        if (err) {
                                            callback('error while retreiving from redis- 4 {}'.format(err), null);
                                            return;
                                        }
                                        var outlet_config = JSON.parse(reply);
                                        callback(null, outlet_config.phone_no);
                                    });
                                },
                                //changes done by peerbits to make order work offline 
                                checkinternet: function (callback) {
                                    internetAvailable({
                                            timeout: 1000,
                                            retries: 3
                                        })
                                        .then(function () {
                                            console.log("Internet Available");
                                            callback(null, true);
                                        })
                                        .catch(function (err) {
                                            callback(null, false);
                                        });
                                },
                                order_id: function (callback) {
                                    redisClient.incrby(helper.order_id_node, 1, function (d_err, d_reply) {
                                        if (d_err) {
                                            callback("error while retreiving from redis- 5 {}".format(d_err), null);
                                            return;
                                        }
                                        callback(null, parseInt(d_reply));
                                    });
                                },
                                fooditemdetails: function (callback) {
                                    FoodItemModel.find({}, function name(error, reply) {
                                        if (error) {
                                            callback(error, null);
                                        }
                                        var maindata = _.groupBy(reply, function (value) {
                                            return value.id;
                                        });
                                        callback(null, maindata);
                                    })
                                },
                                usersalessummary: function (callback) {
                                    redisClient.get(helper.sales_summary_node, function (error, reply) {
                                        if (error) {
                                            callback(error, null);
                                        }
                                        if (reply != null && typeof reply == "string") {
                                            reply = JSON.parse(reply);
                                        }
                                        callback(error, reply);
                                    });
                                }
                            },
                            function (err, results) {
                                if (err) {
                                    debug(err);
                                    done();
                                    return;
                                }
                                results.checkinternet = true;
                                console.log("results.checkinternet" + results.checkinternet);
                                stock_count = JSON.parse(results.stock_count);
                                offline_stock_count = JSON.parse(results.stock_count);
                                is_internet = results.checkinternet;
                                outelt_incr_id = order_id = results.order_id;
                                outlet_order_id = get_outlet_order_id(outelt_incr_id);
                                console.log("outlet_order_id" + outlet_order_id);
                                fooditemdetails = results.fooditemdetails;
                                results.item_expiry_details = JSON.parse(results.item_expiry_details);
                                var salesdata = results.usersalessummary;
                                if (salesdata == undefined) {
                                    salesdata = [];
                                }
                                console.log("results.checkinternet" + results.checkinternet);
                                // Getting a multi-redis transaction started
                                var multi = redisClient.multi();
                                var item_queue = [];
                                console.log("order_details" + order_details);
                                var userid = loggedinuserid;
                                if (loggedinuserid == null || loggedinuserid == 0) {
                                    userid = 1;
                                }
                                //console.log("*****************UserID*************" + userid);

                                // begin sending  items to CVM dispenser
                                console.log("Sides :" + JSON.stringify(sides))
                                for (var item_id in sides) {
                                    console.log("+++++++++++++++++++++++++itemid:" + item_id);
                                    var item = sides[item_id];
                                    if (item.vending == 'cvm') {
                                        // request start
                                        //var OUTLET_REGISTER_URL = "http://{}:{}/cvm/send_item_details".format(results.num_lanes.cvm_plc_ip,results.num_lanes.cvm_plc_port)
                                        var CVM_URL = process.env.CVM_URL.format(results.num_lanes.cvm_plc_ip, results.num_lanes.cvm_plc_port)
                                        request({
                                            url: CVM_URL,
                                            method: "POST",
                                            json: {
                                                "bill_no": bill_no,
                                                "item_id": item_id,
                                                "quantity": item.count,
                                                "status": "pending",
                                                "subitem_id": item.subitem_id
                                            }
                                        }, function (error, response, body) {
                                            if (error || (response && response.statusCode != 200)) {
                                                console.error('{}: {} {}'.format(hq_url, error, body));
                                                return;
                                            }
                                        });
                                        // request end                  
                                    } else {
                                        console.log("Not a Coffee Vending Machine Item");
                                    }
                                }
                                // End sending  items to CVM dispenser

                                for (var item_id in order_details) {
                                    //console.log("item------------------expiry***********" + results.item_expiry_details.length);
                                    //console.log("order_details[item_id]['count'] :" + order_details[item_id]["count"]);
                                    var count = order_details[item_id]["count"]
                                    for (var j = 0; j < Number(count); j++) {
                                        var itemid = order_details[item_id];
                                        //console.log("item------------------expiry***********" + results.item_expiry_details.length);
                                        var item_expiry = results.item_expiry_details.filter(function (x) {
                                            return x.id == item_id
                                        });
                                        //console.log("item------------------expiry------------" + JSON.stringify(item_expiry));
                                        //console.log("item------------------expiry------------"+ item_expiry[0].expiry_time);
                                        var barcode;
                                        if (item_expiry != undefined && item_expiry.length > 0) {
                                            //console.log("!item_expiry");
                                            barcode = getOldestBarcode(item_id, stock_count[item_id]["item_details"], item_expiry[0].expiry_time);
                                            //console.log("!item_expiry");
                                        } else {
                                            barcode = getOldestBarcode(item_id, stock_count[item_id]["item_details"], '6h');
                                            //console.log("item_expiry----------***-----------", item_expiry);
                                        }
                                        //console.log('barcode*****************************',barcode);
                                        // XXX: This case should not come
                                        if (barcode == null) {
                                            continue;
                                        }
                                        order_barcodes.push(barcode);

                                        stock_count = updateStockCount(stock_count, barcode);
                                        var heating_flag = order_details[item_id]["heating_flag"];
                                        var heating_reduction = order_details[item_id]["heating_reduction"]; //SHLOK

                                        var plc_type = 1;
                                        var num_lanes_count = 1;
                                        if (results.num_lanes != null) {
                                            num_lanes_count = results.num_lanes.lane_count;
                                            plc_type = results.num_lanes.plc_type;
                                        }

                                        console.log("place_order :: plc_type: " + plc_type + " Lane count: " + num_lanes_count);

                                        var lane_no = (results.dispense_id % num_lanes_count) + 1;
                                        var isveg = order_details[item_id]["veg"];
                                        // Decrementing lock only if it is not test mode
                                        // Adding this as part of the transaction
                                        multi.decr(item_id + '_locked_count', function (s_err, s_reply) {
                                            if (s_err) {
                                                console.error(s_err);
                                            }
                                        });

                                        var date = getOrderStubDate();
                                        if (test_mode && item_id >= 9000 && item_id <= 9100) {
                                            if (item_id % 2 == 0) {
                                                heating_flag = false;
                                                heating_reduction = heating_reduction; //SHLOK
                                            } else {
                                                heating_flag = true;
                                                heating_reduction = heating_reduction; //SHLOK
                                            }
                                        }
                                        console.log("Sales summary started");
                                        var po_id = barcode.substring((barcode.length - 8), barcode.length);
                                        po_id = parseInt(po_id);
                                        console.log("Sales summary :" + payment_mode);
                                        console.log("Price : " + order_details[item_id]["price"]);
                                        var index = salesdata.findIndex(x => x.po_id == po_id && x.food_item_id == item_id && x.userid == userid);
                                        console.log("Sales summary Index :" + index);
                                        if (index >= 0) {
                                            salesdata[index].sold = salesdata[index].sold + 1;
                                            salesdata[index].cash = payment_mode == "cash" ? (salesdata[index].cash + order_details[item_id]["price"]) : salesdata[index].cash;
                                            salesdata[index].card = payment_mode == "card" ? (salesdata[index].card + order_details[item_id]["price"]) : salesdata[index].card;
                                            salesdata[index].credit = payment_mode == "credit" ? (salesdata[index].card + order_details[item_id]["price"]) : salesdata[index].credit;
                                            salesdata[index].sodexocard = payment_mode == "sodexocard" ? (salesdata[index].sodexocard + order_details[item_id]["price"]) : salesdata[index].sodexocard;
                                            salesdata[index].sodexocoupon = payment_mode == "sodexocoupon" ? (salesdata[index].sodexocoupon + order_details[item_id]["price"]) : salesdata[index].sodexocoupon;
                                            salesdata[index].gprscard = payment_mode == "gprscard" ? (salesdata[index].gprscard + order_details[item_id]["price"]) : salesdata[index].gprscard;
                                            salesdata[index].wallet = payment_mode == "wallet" ? (salesdata[index].wallet + order_details[item_id]["price"]) : salesdata[index].wallet;
                                            salesdata[index].total = salesdata[index].total + order_details[item_id]["price"];
                                        } else {
                                            var obj = {
                                                "po_id": po_id,
                                                "food_item_id": item_id,
                                                "userid": userid,
                                                "sold": 1,
                                                "cash": payment_mode == "cash" ? order_details[item_id]["price"] : 0,
                                                "card": payment_mode == "card" ? order_details[item_id]["price"] : 0,
                                                "credit": payment_mode == "credit" ? order_details[item_id]["price"] : 0,
                                                "sodexocard": payment_mode == "sodexocard" ? order_details[item_id]["price"] : 0,
                                                "sodexocoupon": payment_mode == "sodexocoupon" ? order_details[item_id]["price"] : 0,
                                                "gprscard": payment_mode == "gprscard" ? order_details[item_id]["price"] : 0,
                                                "wallet": payment_mode == "wallet" ? order_details[item_id]["price"] : 0,
                                                "total": order_details[item_id]["price"]
                                            }
                                            salesdata.push(obj);
                                        }


                                        var order_stub = createOrderStub(barcode, counter_code,
                                            heating_flag, date,
                                            bill_no, results.dispense_id, heating_reduction, isveg, plc_type);
                                        item_val = {
                                            "dispense_id": results.dispense_id,
                                            "status": "pending",
                                            "order_stub": order_stub
                                        };
                                        item_queue.push(item_val);

                                        results.dispense_id++;
                                        console.log("results.dispense_id", results.dispense_id);
                                        console.log("J", j);
                                        console.log("item_queue", item_queue.length);
                                    }
                                }

                                // Setting the new stock count, also as part of the transaction
                                multi.set(helper.stock_count_node, JSON.stringify(stock_count),
                                    function (set_err, set_reply) {
                                        if (set_err) {
                                            console.error(set_err);
                                        }
                                    });

                                multi.exec(function (err, replies) {
                                    done();
                                    if (err) {
                                        debug(err);
                                        return;
                                    }

                                    // Merging with the lock counts and sending to browser and firebase
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
                                        io.emit(helper.stock_count_node, stock_count);
                                        io.sockets.emit(helper.stock_count_node, stock_count);

                                        // Put the data in firebase
                                        var rootref = new firebase(process.env.FIREBASE_CONN);
                                        var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                                        stock_count_node.set(stock_count);
                                    });
                                });
                                // End of multi transaction

                                if (isEmpty(stock_count)) {
                                    redisClient.set(helper.dispenser_status_node, 'empty', function (d_set_err, d_set_reply) {
                                        if (d_set_err) {
                                            console.error(d_set_err);
                                        }
                                    });
                                    io.emit('dispenser_empty', true);
                                    io.sockets.emit('dispenser_empty', true);
                                } else {
                                    io.emit('dispenser_empty', false);
                                    io.sockets.emit('dispenser_empty', false);
                                }

                                if (test_mode) {
                                    debug("Going into test mode");
                                    // pushing the item to the queue
                                    item_queue.map(function (item_val) {
                                        redisClient.rpush(helper.dispenser_queue_node, JSON.stringify(item_val),
                                            function (lp_err, lp_reply) {
                                                if (lp_err) {
                                                    debug(lp_err);
                                                    return;
                                                }
                                            });
                                    });
                                    // Prepare the bill data and pass it on to the print function
                                    // The print function will load the html file, fill in the details
                                    // and then generate the pdf.
                                    var bill_to_print = prepareBillToPrint(order_details, sides);

                                    var dateObj = new Date();
                                    var date = dateObj.toDateString();
                                    var time = dateObj.toLocaleTimeString();
                                    debug("generating pdf");
                                    // add sides to the prepareBillDict function,
                                    // Create the pdf once and post the bill results just once
                                    //changes done to check for internet by peerbits
                                    //Date 2 Aug 2017
                                    if (is_internet) {
                                        startPrint(bill_to_print, bill_no, date, time, savings, mobile_num, results.outlet_phone_no);
                                    } else {
                                        bill_print_info = bill_info_to_store(bill_to_print, bill_no, date, time, savings, mobile_num, results);
                                        redisClient.rpush(helper.bill_print_info_node, JSON.stringify(bill_print_info), function (error, result) {
                                            if (error) {
                                                console.error("not able to set bill_print_info in place order functionality");
                                            }
                                            debug("reply of set of bill info node " + result);
                                        });
                                    }

                                } else {
                                    // create an entry in sales_order
                                    // and also in sales order payments
                                    var hq_url = process.env.HQ_URL;
                                    //var PLACE_ORDER_TO_HQ_URL = hq_url + '/outlet/place_order';
                                    //var STORE_BILL_ENTRY_DATA_URL = hq_url + '/outlet/store_bill';
                                    var UPDATE_RECOVERY_DETAILS_URL = hq_url + '/outlet/update_recovery_details/' + process.env.OUTLET_ID;
                                    debug('Payment mode is - ' + payment_mode);
                                    // Prepare the bill data and pass it on to the print function
                                    // The print function will load the html file, fill in the details
                                    // and then generate the pdf.
                                    var bill_dict = prepareBillDict(order_details, sides);
                                    debug("generating pdf", is_internet);
                                    var bill_to_print = prepareBillToPrint(order_details, sides);
                                    var dateObj = new Date();
                                    var date = dateObj.toDateString();
                                    var time = dateObj.toLocaleTimeString();
                                    debug("generating pdf", is_internet);
                                    // add sides to the prepareBillDict function,
                                    // Create the pdf once and post the bill results just once
                                    //console.log("results 2: " + JSON.stringify(results));
                                    //console.log("results.outlet_phone_no 2: " + results.outlet_phone_no);
                                    //startPrint(bill_to_print, bill_no, date, time, savings, mobile_num, results.outlet_phone_no);
                                    //changes done to check for internet by peerbits
                                    //Date 2 Aug 2017
                                    if (is_internet) {
                                        startPrint(bill_to_print, bill_no, date, time, savings, mobile_num, results.outlet_phone_no);
                                    } else {
                                        bill_print_info = bill_info_to_store(bill_to_print, bill_no, date, time, savings, mobile_num, results);
                                        redisClient.lpush(helper.bill_print_info_node, JSON.stringify(bill_print_info), function (error, result) {
                                            if (error) {
                                                console.error("not able to set bill_print_info in place order functionality");
                                            }
                                            debug("reply of set of bill info node " + result);
                                        });
                                    }
                                    debug("Placing order to HQ");
                                    var bill_time = GetFormattedDateDDMMYYYY();


                                    var obj = {
                                        "name": "ORDER_DETAILS",
                                        "order_details": order_details,
                                        "sides": sides,
                                        "counter_code": counter_code,
                                        "payment_mode": payment_mode,
                                        "outlet_id": process.env.OUTLET_ID,
                                        "order_barcodes": order_barcodes,
                                        "mobile_num": mobile_num,
                                        "credit_card_no": credit_card_no,
                                        "cardholder_name": cardholder_name,
                                        "bill_no": bill_no,
                                        "food_details": bill_dict,
                                        "unique_Random_Id": unique_Random_Id,
                                        "is_mobile_order": false,
                                        "bill_time": bill_time,
                                        "bill_status": "Pending",
                                        "userid": userid,
                                        "outlet_order_id": outlet_order_id
                                    };

                                    //console.log("Outlet Object for DirectBillURL **** " + JSON.stringify(obj));
                                    redisClient.set(helper.sales_summary_node, JSON.stringify(salesdata));
                                    redisClient.lpush("Bills", JSON.stringify(obj));
                                    // var DirectBillURL = process.env.HQ_URL + "/outlet/DirectBill";
                                    // requestretry({
                                    //   url: DirectBillURL,
                                    //   forever: true,
                                    //   maxAttempts: 25,
                                    //   method: "POST",
                                    //   json: obj
                                    // }, function (error, response, body) {
                                    //   if (body != undefined && (error != "" || error != null || error != "" != undefined)) {
                                    //     var res = JSON.stringify(body);
                                    //     redisClient.lrem("Bills", 1, res);

                                    //     if (error || (response && response.statusCode != 200)) {
                                    //       debug('{}: {} {}'.format(DirectBillURL, error, body));
                                    //       body.bill_status = "Error";
                                    //       redisClient.lpush("Bills", JSON.stringify(body));
                                    //       debug("Bill Details to HQ  -- Error");
                                    //       return;
                                    //     }
                                    //     body.bill_status = "Success";
                                    //     redisClient.lpush("Bills", JSON.stringify(body));
                                    //     debug("Updated Bill Details to HQ ");
                                    //   }
                                    // });
                                    obj = {};
                                    date = JSON.parse(JSON.stringify(new Date()));
                                    sides = (typeof sides == "undefined") ? [] : sides;
                                    var objstoreorderdetails = {
                                        "name": "ORDER_DETAILS",
                                        "order_details": order_details,
                                        "sides": sides,
                                        "counter_code": counter_code,
                                        "payment_mode": payment_mode,
                                        "outlet_id": process.env.OUTLET_ID,
                                        "order_barcodes": order_barcodes,
                                        "mobile_num": mobile_num,
                                        "credit_card_no": credit_card_no,
                                        "cardholder_name": cardholder_name,
                                        "bill_no": bill_no,
                                        "food_details": bill_dict,
                                        "unique_Random_Id": unique_Random_Id,
                                        "is_mobile_order": false,
                                        "bill_time": bill_time,
                                        "bill_status": "Pending",
                                        "is_send_to_HQ": is_internet,
                                        "current_time": date,
                                        "userid": userid,
                                        "outlet_order_id": outlet_order_id
                                    };

                                    saveOrderDetailsOnLocal(objstoreorderdetails, is_internet, offline_stock_count, order_id, fooditemdetails);
                                    var ref = new Firebase(process.env.FIREBASE_QUEUE);
                                    console.log("tasks here 2");
                                    ref.child('tasks').push({
                                        "name": "ORDER_DETAILS",
                                        "order_details": order_details,
                                        "sides": sides,
                                        "counter_code": counter_code,
                                        "payment_mode": payment_mode,
                                        "outlet_id": process.env.OUTLET_ID,
                                        "order_barcodes": order_barcodes,
                                        "mobile_num": mobile_num,
                                        "credit_card_no": credit_card_no,
                                        "cardholder_name": cardholder_name,
                                        "bill_no": bill_no,
                                        "food_details": bill_dict,
                                        "unique_Random_Id": unique_Random_Id,
                                        "is_mobile_order": false,
                                        "userid": userid,
                                        "outlet_order_id": outlet_order_id
                                    }); // after updating order details
                                    debug("Successfully updated order details in HQ");
                                    // pushing the item to the queue
                                    item_queue.map(function (item_val) {
                                        redisClient.rpush(helper.dispenser_queue_node, JSON.stringify(item_val),
                                            function (lp_err, lp_reply) {
                                                if (lp_err) {
                                                    debug(lp_err);
                                                    return;
                                                }
                                            });
                                    });
                                    console.log('************************************************');
                                    console.log('sending the update recovery details to hq');
                                    console.log('************************************************');

                                    // Store the recovery details in the HQ
                                    requestretry({
                                        url: UPDATE_RECOVERY_DETAILS_URL,
                                        timeout: 1000,
                                        method: "POST",
                                        json: {
                                            "bill_no": bill_no,
                                            "dispense_id": results.dispense_id
                                        }
                                    }, function (error, response, body) {
                                        if (error || (response && response.statusCode != 200)) {
                                            debug('{}: {} {}'.format(UPDATE_RECOVERY_DETAILS_URL, error, body));
                                            return;
                                        }
                                        debug("Updated HQ with the recovery details");
                                    });
                                }
                            }); // async.parallel
                    }); // end lock function

                } else {
                    console.log("else part called");
                    // We do not print immediately when the payment mode is cash.
                    // The outlet staff prints it after getting the money
                    var rand_string = randomstring.generate(5);
                    io.emit('bill_dispense_data', {
                        "tag": rand_string,
                        "order_details": order_details,
                        "counter_code": counter_code,
                        "payment_mode": payment_mode,
                        "sides": sides,
                        "savings": savings,
                        "bill_no": bill_no,
                        "mobile_num": mobile_num,
                        "credit_card_no": credit_card_no,
                        "cardholder_name": cardholder_name,
                        "unique_Random_Id": unique_Random_Id
                    });
                    io.sockets.emit('bill_dispense_data', {
                        "tag": rand_string,
                        "order_details": order_details,
                        "counter_code": counter_code,
                        "payment_mode": payment_mode,
                        "bill_no": bill_no,
                        "sides": sides,
                        "savings": savings,
                        "mobile_num": mobile_num,
                        "credit_card_no": credit_card_no,
                        "cardholder_name": cardholder_name,
                        "unique_Random_Id": unique_Random_Id
                    });
                    // Prepare pending_done Queue. 
                    var order_item_list = get_sales_order_items(order_details);
                    console.log("order_item_list:");
                    console.log(order_item_list);
                    // Get and update pending_done queue in redis.
                    redisClient.get(helper.pending_done_node, function (err, reply) {
                        if (err) {
                            console.log(err);
                        } else {
                            if (reply) {
                                // The queue already exist so we are updating pending_done queue .
                                var queue_list = JSON.parse(reply);
                                console.log("Queue_list:");
                                console.log(queue_list);
                                _.each(order_item_list, function (value, key) {
                                    // Check new order item_id exist or not.
                                    // If exist update the count else push new item.
                                    if (queue_list.hasOwnProperty(key)) {
                                        queue_list[key] += value;
                                    } else {
                                        queue_list[key] = value;
                                    }
                                });
                                // set updated items in redis queue.
                                update_pending_done(queue_list);
                            } else {
                                // we inserting new queue items in redis.
                                var json_order_item_list = JSON.stringify(order_item_list);
                                console.log("json_order_item_list:");
                                console.log(json_order_item_list);
                                redisClient.set(helper.pending_done_node, json_order_item_list,
                                    function (lp_err, lp_reply) {
                                        if (lp_err) {
                                            console.error(err);
                                        } else {
                                            console.log("Pushing done pending item succesful.... " + json_order_item_list);
                                        }
                                    }
                                );
                            }
                        }
                    });
                }
                redisClient.get(helper.stock_count_node, function (err, reply) {
                    var parsed_response = JSON.parse(reply);
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
                        io.emit(helper.stock_count_node, parsed_response);
                    });
                });
                debug("Sending bill no- ", bill_no);
                res.send({
                    bill_no: bill_no
                });
            }, function (bill_print_err) {
                res.status(500).send({
                    bill_no: -1
                });
            });
    }
});

function get_sales_order_items(sales_order_details) {
    // Prepare order items. 
    var order_items = {};

    _.each(sales_order_details, function (value, key) {
        order_items[key] = value.count;
    });

    return order_items;
}

// Update Pending_done queue.
function update_pending_done(queue_list) {
    var json_queue_list = JSON.stringify(queue_list);

    redisClient.set(helper.pending_done_node, json_queue_list,
        function (lp_err, lp_reply) {
            if (lp_err) {
                console.error(err);
            } else {
                console.log("Updating done pending item succesful.... " + json_queue_list);
            }
        }
    );
}

function saveOrderDetailsOnLocal(order_details, is_online, stock_count, order_id, fooditemdetails) {
    console.log('************************************************');
    console.log('stock_count', stock_count);
    console.log('************************************************');

    var order = new PlaceOrderModel(order_details);
    order.save(function (error, data) {
        if (error) {
            console.log('##############################');
            console.log('cannot save place order details', error);
            console.log('##############################');
        }
        var ammount_due = 0;
        for (var key in data.order_details) {
            if (data.order_details.hasOwnProperty(key)) {
                var orderdetails = data.order_details[key];
                ammount_due += orderdetails.price;
            }
        }
        if (data.sides != "undefined") {
            for (var key in data.sides) {
                if (data.sides.hasOwnProperty(key)) {
                    var sides = data.sides[key];
                    ammount_due += sides.price;
                }
            }
        }

        orderdetailobject = {};
        orderdetailobject.id = order_id;
        orderdetailobject.outlet_order_id = data.outlet_order_id;
        orderdetailobject.time = data.current_time;
        orderdetailobject.method = data.payment_mode;
        orderdetailobject.amount_due = ammount_due;
        orderdetailobject.bill_nos = [data.bill_no];
        orderdetailobject.mobile_num = data.mobile_num;
        orderdetailobject.is_set_on_HQ = is_online;
        orderdetailobject.order_barcodes = data.order_barcodes;
        orderdetailobject.userid = data.userid;
        if (data.sides != "undefined" && (data.order_details == "undefined" || Object.keys(data.order_details).length === 0)) {
            orderdetailobject.dispense_status = "{delivered}";
        } else {
            orderdetailobject.dispense_status = "{pending}";
        }
        orderdetailobject.outlet_order_id = data.outlet_order_id;
        var order_details = new OrderModel(orderdetailobject, data);
        order_details.save(function (error, orderdata) {
            if (error) {
                console.log('##############################');
                console.log('errror saving order details =========================', error);
                console.log('##############################');
            }
            saveCashammountOnlocal(orderdata, data);

            if (typeof data.order_details !== "unndefined") {
                for (var key in data.order_details) {
                    if (data.order_details.hasOwnProperty(key)) {
                        var orderitemdetails = data.order_details[key];
                        //redisClient.incrby(helper.order_item_id_node, 1, function(err, order_item_id) {
                        var barcode = stock_count[key]["item_details"][0]["barcode"];
                        barcodes = data.order_barcodes.split(",");
                        itembarcodes = [];
                        barcodes.forEach(function (element) {
                            if (checkIfTestMode(element.substr(8, 4))) {
                                barcode_item_id = parseInt(element.substr(8, 4));
                            } else {
                                barcode_item_id = parseInt(element.substr(8, 4), 36);
                            }
                            if (barcode_item_id == key) {
                                itembarcodes.push(element);
                            }
                        }, this);
                        itemobj = {};
                        itemobj.outlet_order_id = data.outlet_order_id;
                        itemobj.bill_no = data.bill_no;
                        itemobj.quantity = orderitemdetails.count;
                        itemobj.original_quantity = 0;
                        itemobj.id = key;
                        itemobj.name = orderitemdetails.name;
                        itemobj.mrp = fooditemdetails[key][0].mrp;
                        itemobj.count = orderitemdetails.count;
                        itemobj.dispensing_count = 0;
                        itemobj.delivered_count = 0;
                        itemobj.barcode = itembarcodes;
                        itemobj.is_set_on_HQ = is_online;
                        itemobj.order_id = orderdata.id;
                        itemobj.time = data.current_time;
                        itemobj.dispense_status = "{pending}";
                        itemobj.dispense_status_scanded_ids = "";
                        itemobj.delivered_status_scanded_ids = "";
                        var order_item_details = {};
                        order_item_details = new OrderItemModel(itemobj);


                        order_item_details.save(function (error, data) {
                            if (error) {
                                console.log('##############################');
                                console.log('errror', error);
                                console.log('##############################');
                            }
                        });

                        // });
                    }
                }
            }
            console.log('***************************************');
            console.log('data.sides', data.sides);
            console.log('***************************************');



            if (data.sides != "undefined") {
                console.log('***************************************');
                console.log('data.sides111', data.sides);
                console.log('***************************************');


                for (var key_breverage in data.sides) {
                    if (data.sides.hasOwnProperty(key_breverage)) {
                        var orderitemdetails_breverage = data.sides[key_breverage];
                        console.log('************************************************');
                        console.log('orderitemdetails_breverage.count', orderitemdetails_breverage.count);
                        console.log('************************************************');

                        //redisClient.incrby(helper.order_item_id_node, 1, function(err, order_item_id) {
                        //var barcode = stock_count[key_breverage]["item_details"][0]["barcode"];
                        var barcode = "";
                        itemobj = {};
                        itemobj.outlet_order_id = data.outlet_order_id;
                        itemobj.bill_no = data.bill_no;
                        itemobj.quantity = orderitemdetails_breverage.count;
                        itemobj.original_quantity = 0;
                        itemobj.id = key_breverage;
                        itemobj.name = orderitemdetails_breverage.name;
                        itemobj.mrp = orderitemdetails_breverage.price;
                        itemobj.barcode = barcode;
                        itemobj.is_set_on_HQ = is_online;
                        itemobj.order_id = orderdata.id;
                        itemobj.time = data.current_time;
                        itemobj.count = orderitemdetails_breverage.count;
                        itemobj.dispensing_count = orderitemdetails_breverage.count;
                        itemobj.delivered_count = orderitemdetails_breverage.count;
                        itemobj.dispense_status = "{delivered}";
                        itemobj.dispense_status_scanded_ids = "";
                        itemobj.delivered_status_scanded_ids = "";
                        console.log('##############################');
                        console.log('itemobj', itemobj);
                        console.log('##############################');
                        var order_item_details = new OrderItemModel(itemobj);
                        order_item_details.save(function (error, data) {
                            if (error) {
                                console.log('##############################');
                                console.log('errror', error);
                                console.log('##############################');
                            }
                        });

                        // });
                    }
                }
            }


        });
    });

}

function saveCashammountOnlocal(orderdata, data) {

    async.parallel({
        old_cash_details: function (callback) {
            var fields = {
                __v: false,
                _id: false,
                is_set_on_HQ: false,
            };
            CashDetailModel.findOne({
                'outlet_id': process.env.OUTLET_ID
            }, fields, function (error, cashdetials) {
                callback(error, cashdetials);
            });
        },
    }, function (err, results) {

        food_details = results.food_details;
        if (typeof data.order_details != "undefined") {
            console.log('***************************************');
            console.log('data.order_details', data.order_details);
            console.log('***************************************');
        }
        if (typeof data.sides != "undefined") {
            console.log('***************************************');
            console.log('data.sides', data.sides);
            console.log('***************************************');
        }
        console.log('***************************************');
        old_cash_details = results.old_cash_details;
        console.log('***************************************');
        console.log('old_cash_details', old_cash_details);
        console.log('***************************************');
        console.log('***************************************');
        console.log('data', data);
        console.log('***************************************');
        var method = orderdata.method.toLowerCase().split(/\s+/).join('');
        old_cash_details["day_" + method + "_amount"];
        old_cash_details["month_" + method + "_amount"];
        console.log('************************************************');
        console.log('data.order_details', data.order_details);
        console.log('************************************************');

        if (typeof data.order_details != "undefined") {
            var ordercount = 0;
            for (var key in data.order_details) {
                if (data.order_details.hasOwnProperty(key)) {
                    ordercount = ordercount + data.order_details[key].count;
                }
            }
            old_cash_details.dispenser_day_count = (old_cash_details.dispenser_day_count == null) ? 0 : old_cash_details.dispenser_day_count;
            old_cash_details.dispenser_month_count = (old_cash_details.dispenser_month_count == null) ? 0 : old_cash_details.dispenser_month_count;
            old_cash_details["dispenser_day_count"] = (parseInt(old_cash_details["dispenser_day_count"]) + ordercount).toString();
            old_cash_details["dispenser_month_count"] = (parseInt(old_cash_details["dispenser_month_count"]) + ordercount).toString();
        }


        if (typeof data.sides != "undefined") {
            var sidescount = 0
            for (var key2 in data.sides) {
                if (data.sides.hasOwnProperty(key2)) {
                    sidescount = sidescount + data.sides[key2].count;
                }
            }
            old_cash_details.outside_day_count = (old_cash_details.outside_day_count == null) ? 0 : old_cash_details.outside_day_count;
            old_cash_details.outside_month_count = (old_cash_details.outside_month_count == null) ? 0 : old_cash_details.outside_month_count;
            old_cash_details["outside_day_count"] = (parseInt(old_cash_details["outside_day_count"]) + sidescount).toString();
            old_cash_details["outside_month_count"] = (parseInt(old_cash_details["outside_month_count"]) + sidescount).toString();
            old_cash_details["outside_day_amount"] += orderdata.amount_due;
            old_cash_details["outside_month_amount"] += orderdata.amount_due;
        }
        old_cash_details["day_" + method + "_amount"] += orderdata.amount_due;
        old_cash_details["month_" + method + "_amount"] += orderdata.amount_due;
        old_cash_details["day_total"] += orderdata.amount_due;
        old_cash_details["month_total"] += orderdata.amount_due;
        options = {
            multi: true
        };
        CashDetailModel.update({
            'outlet_id': parseInt(process.env.OUTLET_ID)
        }, old_cash_details, options, function (error, reply) {
            if (error) {
                console.log('##############################');
                console.log('error', error);
                console.log('##############################');
            }
            console.log('##############################');
            console.log('reply updated ', reply);
            console.log('##############################');

        });
    });
}

function get_outlet_order_id(outelt_incr_id) {
    var timestamp = moment().format('x');
    var OUTLET_ID = process.env.OUTLET_ID;
    return parseInt(outelt_incr_id + OUTLET_ID + timestamp);
}

function GetFormattedDateDDMMYYYY() {
    var d = new Date,
        dformat = [d.getFullYear() + '-', (d.getMonth() + 1).padLeft() + '-', d.getDate().padLeft()].join('');

    return dformat;
}

Number.prototype.padLeft = function (base, chr) {
    var len = (String(base || 10).length - String(this).length) + 1;
    return len > 0 ? new Array(len).join(chr || '0') + this : this;
}


// This handler dispenses item/s for a replacement workflow
// It is nearly same to /place_order but calls to HQ are not made
// and some other info are not required
router.post('/fulfill_replacement/:id', function (req, res, next) {
    var order_id = req.params.id;
    //  var  order_details = req.body.replaced_item_details;
    var order_details = req.body.replaced_item_details;
    var amount = req.body.amount;
    var replaced_amount = req.body.replaced_amount;
    var old_item_details = req.body.item_details;
    var mobile_num = req.body.mobile_num;
    var original_bill_no = req.body.bill_no;
    var outlet_order_id = req.body.outlet_order_id;
    var replaced_item_details = {};
    var data_replace_item_details = req.body.replaced_item_details;
    debug("Received replacement call");
    debug("New items - ", order_details, " old items- ", old_item_details);
    // Getting the no. of items in the order
    var num_items = 0;
    for (var key in order_details) {
        num_items += order_details[key]["count"];
    }

    // Getting all the required items first with async.parallel.
    // And then running the main logic in the callback
    async.parallel({
            dispense_id: function (callback) {
                // Incrementing the dispense id
                redisClient.incrby(helper.dispense_id_node, num_items, function (d_err, d_reply) {
                    if (d_err) {
                        callback("error while retreiving from redis- 7 {}".format(d_err), null);
                        return;
                    }
                    callback(null, parseInt(d_reply) - num_items);
                });
            },
            stock_count: function (callback) {
                // Getting the stock count here
                redisClient.get(helper.stock_count_node, function (err, reply) {
                    if (err) {
                        callback("error while retreiving from redis- 8 {}".format(err), null);
                        return;
                    }
                    callback(null, reply);
                });
            },
            num_lanes: function (callback) {
                redisClient.get(helper.plc_config_node, function (err, reply) {
                    if (err) {
                        callback('error while retreiving from redis- 9 {}'.format(err), null);
                        return;
                    }
                    var plc_config = JSON.parse(reply);
                    //callback(null, plc_config.lane_count);
                    callback(null, plc_config);
                });
            },
            checkinternet: function (callback) {
                internetAvailable({
                        timeout: 1000,
                        retries: 3,
                    })
                    .then(function () {
                        callback(null, true);
                    })
                    .catch(function (err) {
                        callback(null, false);
                    });

            },
            checkhqreachable: function (callback) {
                var hq_url = process.env.HQ_URL;
                var UPDATE_ITEM_ISSUES_URL = '/outlet/get_live_pos/';
                var outlet_id = process.env.OUTLET_ID;
                var data = {};
                request(hq_url + UPDATE_ITEM_ISSUES_URL + outlet_id, {
                        timeout: 1500
                    },
                    function (error, response, body) {
                        if (error || (response && response.statusCode != 200)) {
                            callback(null, false);
                        } else {
                            callback(null, true);
                        }
                    });

            },
            order_id: function (callback) {
                redisClient.incrby(helper.order_id_node, 1, function (d_err, d_reply) {
                    if (d_err) {
                        callback("error while retreiving from redis- 10 {}".format(d_err), null);
                        return;
                    }
                    callback(null, parseInt(d_reply));
                });
            },
            item_expiry_details: function (callback) {
                // Getting the stock count here
                redisClient.lrange("itemexpirydetails", 0, -1, function (err, item_expiry_details) {
                    if (err) {
                        callback("error while retreiving from redis- {}".format(err), null);
                        return;
                    }
                    callback(null, item_expiry_details);
                });
            }

        },
        function (err, results) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }
            stock_count = JSON.parse(results.stock_count);
            results.checkinternet = true;
            is_internet = (results.checkinternet && results.checkhqreachable) ? true : false;
            // Getting a multi-redis transaction started
            var multi = redisClient.multi();
            for (var item_id in order_details) {
                for (var j = 0; j < order_details[item_id]["count"]; j++) {
                    var itemid = order_details[item_id];
                    results.item_expiry_details = JSON.parse(results.item_expiry_details);
                    console.log("item------------------expiry***********" + results.item_expiry_details.length);
                    var item_expiry = results.item_expiry_details.filter(function (x) {
                        return x.id == item_id
                    });
                    console.log("item------------------expiry------------" + JSON.stringify(item_expiry));
                    //console.log("item------------------expiry------------"+ item_expiry[0].expiry_time);
                    var barcode;
                    if (item_expiry != undefined && item_expiry.length > 0) {
                        console.log("!item_expiry");
                        barcode = getOldestBarcode(item_id, stock_count[item_id]["item_details"], item_expiry[0].expiry_time);
                        //console.log("!item_expiry");
                    } else {
                        barcode = getOldestBarcode(item_id, stock_count[item_id]["item_details"], '6h');
                        console.log("item_expiry----------***-----------", item_expiry);
                    }
                    if (barcode == null) {
                        // most probably barcodes have expired or spoiled
                        continue;
                    }
                    if (replaced_item_details.hasOwnProperty(barcode)) {
                        replaced_item_details[barcode]++;
                    } else {
                        replaced_item_details[barcode] = 1;
                    }

                    stock_count = updateStockCount(stock_count, barcode);
                    var heating_flag = order_details[item_id]["heating_flag"];
                    var heating_reduction = order_details[item_id]["heating_reduction"];

                    var plc_type = 1;
                    var num_lanes_count = 1;
                    if (results.num_lanes != null) {
                        num_lanes_count = results.num_lanes.lane_count;
                        plc_type = results.num_lanes.plc_type;
                    }

                    console.log("fulfill_replacement :: plc_type: " + plc_type + " Lane count: " + num_lanes_count);

                    var lane_no = (results.dispense_id % num_lanes_count) + 1;
                    var isveg = order_details[item_id]["veg"];
                    // Adding this as part of the transaction
                    multi.decr(item_id + '_locked_count', function (s_err, s_reply) {
                        if (s_err) {
                            console.error(s_err);
                        }
                    });
                    var date = getOrderStubDate();
                    var order_stub = createOrderStub(barcode, lane_no,
                        heating_flag, date,
                        original_bill_no, results.dispense_id, heating_reduction, isveg, plc_type); // SHLOK
                    item_val = {
                        "dispense_id": results.dispense_id,
                        "status": "pending",
                        "order_stub": order_stub
                    };

                    // pushing the item to the queue
                    redisClient.rpush(helper.dispenser_queue_node, JSON.stringify(item_val),
                        function (lp_err, lp_reply) {
                            if (lp_err) {
                                console.error(err);
                                res.status(500).send(err);
                                return;
                            }
                        });
                    results.dispense_id++;
                }
            }

            // Setting the new stock count, also as part of the transaction
            multi.set(helper.stock_count_node, JSON.stringify(stock_count),
                function (set_err, set_reply) {
                    if (set_err) {
                        console.error(set_err);
                    }
                });

            multi.exec(function (err, replies) {
                // Merging with the lock counts and sending to browser and firebase
                var item_id_list = [];
                for (var item_id in stock_count) {
                    item_id_list.push(item_id + '_locked_count');
                }

                redisClient.mget(item_id_list, function (l_err, l_reply) {
                    for (var item_id in stock_count) {
                        if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
                            stock_count[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                        } else {
                            stock_count[item_id]["locked_count"] = 0;
                        }
                    }
                    // broadcasting the new stock count to all connected clients
                    io.emit(helper.stock_count_node, stock_count);
                    io.sockets.emit(helper.stock_count_node, stock_count);

                    // Put the data in firebase
                    var rootref = new firebase(process.env.FIREBASE_CONN);
                    var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                    stock_count_node.set(stock_count);
                });

            });
            // End of multi transaction
            console.log('************************************************');
            console.log('here 1');
            console.log('************************************************');

            if (isEmpty(stock_count)) {
                redisClient.set(helper.dispenser_status_node, 'empty', function (d_set_err, d_set_reply) {
                    if (d_set_err) {
                        console.error(d_set_err);
                    }
                });
                io.emit('dispenser_empty', true);
                io.sockets.emit('dispenser_empty', true);
            } else {
                io.emit('dispenser_empty', false);
                io.sockets.emit('dispenser_empty', false);
            }

            console.log('************************************************');
            console.log('here 2');
            console.log('************************************************');

            // For each restaurant, iterate and print the bill.
            // Get the data and pass it on to the print function
            // The print function will load the html file, fill in the details
            // and then print the document.
            var bill_to_print = prepareBillToPrint(order_details, null);
            var dateObj = new Date();
            var date = dateObj.toDateString();
            var time = dateObj.toLocaleTimeString();
            console.log('************************************************');
            console.log('here 3', is_internet);
            console.log('************************************************');

            if (is_internet) {
                startPrint(bill_to_print, original_bill_no, date, time, 0, mobile_num);
            } else {
                bill_print_info = bill_info_to_store(bill_to_print, original_bill_no, date, time, 0, mobile_num, results);
                redisClient.rpush(helper.bill_print_info_node, JSON.stringify(bill_print_info), function (error, result) {
                    if (error) {
                        console.error("not able to set bill_print_info in place order functionality");
                    }
                    debug("reply of set of bill info node " + result);
                });
            }
            //changes done by peerbits 24 aug 2017
            //startPrint(bill_to_print, original_bill_no, date, time, 0, mobile_num);
            replace_data = {
                "amount": amount,
                "item_details": old_item_details,
                "bill_no": original_bill_no,
                "replaced_amount": replaced_amount,
                "replaced_item_details": replaced_item_details,
                "userid": loggedinuserid,
                "outlet_order_id": outlet_order_id,
            };
            if (typeof outlet_order_id !== "undefined") {
                replace_data.order_id = order_id;
            } else {
                replace_data.order_id = -1;
            }
            if (typeof outlet_order_id !== "undefined") {
                replace_data.order_id = order_id;
            } else {
                replace_data.order_id = -1;
            }
            console.log('************************************************');
            console.log('here 5');
            console.log('************************************************');

            console.log('##############################');
            console.log('replace_data', replace_data);
            console.log('##############################');
            var hq_url = process.env.HQ_URL;
            var REPLACE_ITEMS_URL = hq_url + '/outlet/replace_items/' + order_id;
            console.log('************************************************');
            console.log('here 6');
            console.log('************************************************');

            saveReplaceData(replace_data, function (error, data) {
                internetAvailable({
                        timeout: 1000,
                        retries: 3,
                    })
                    .then(function () {

                        search_order_item_by_order_id(order_id, function (error, order_items) {

                            order_items = JSON.parse(order_items);
                            if (order_items.length > 0) {
                                replace_offline(
                                    replace_data,
                                    data_replace_item_details,
                                    outlet_order_id,
                                    order_id,
                                    function (err, reply) {
                                        debug(reply);
                                        console.log('##############################');
                                        console.log('replce res');
                                        console.log('##############################');
                                        res.send('success');
                                    }
                                );
                            } else {

                                redisClient.lrem(helper.replace_data_to_send_node, 1, JSON.stringify(replace_data), function (error, reply) {
                                    debug(reply);
                                    requestretry({
                                        url: REPLACE_ITEMS_URL,
                                        method: "POST",
                                        maxAttempts: 25,
                                        json: replace_data
                                    }, function (error, response, body) {
                                        if (error || (response && response.statusCode != 200)) {
                                            debug('{}: {} {}'.format(REPLACE_ITEMS_URL, error, body));
                                            res.status(500).send('{}: {} {}'.format(REPLACE_ITEMS_URL, error, body));
                                            return;
                                        }
                                        debug(body);
                                        res.send('success');
                                        return;
                                    });
                                });
                            }
                        });

                    })
                    .catch(function (err) {


                        search_order_item_by_order_id(order_id, function (error, order_items) {

                            order_items = JSON.parse(order_items);
                            if (order_items.length > 0) {

                                replace_offline(
                                    replace_data,
                                    data_replace_item_details,
                                    outlet_order_id,
                                    order_id,
                                    function (err, reply) {
                                        debug(reply);
                                        res.send("success");
                                        return;
                                    }
                                );
                            } else {
                                res.send("success");
                            }
                        });

                    });

            });
        });
});


function saveReplaceData(replace_data, callback) {
    redisClient.lpush(
        helper.replace_data_to_send_node,
        JSON.stringify(replace_data),
        function (error, reply) {
            if (error) {
                callback(error, null);
            }
            callback(null, reply);
            return;
        }
    );




}

//get original order and order detial from mongo
//insert a new order item with -quantity and new item and quantity
//update the order detail 
function replace_offline(replace_data, data_replace_item_details, outlet_order_id, order_id, callback) {
    console.log('************************************************');
    console.log('replace_data ===========================================', replace_data);
    console.log('************************************************');
    console.log('************************************************');
    console.log('data_replace_item_details ======================================', data_replace_item_details);
    console.log('************************************************');
    original_barcodes = Object.keys(replace_data.item_details);
    main_replace_barcodes = Object.keys(replace_data.item_details);
    replacecount = 0;
    original_barcodes_string = original_barcodes.join();
    ordersearchobject = {
        outlet_order_id: outlet_order_id
    }
    searchobj = {
        outlet_order_id: outlet_order_id
    };
    //ordersearchobject.order_barcodes = new RegExp(original_barcodes_string, "i");
    barcode_search = [];
    for (var index = 0; index < original_barcodes.length; index++) {
        var element = original_barcodes[index];
        barcode_search.push({
            "barcode": new RegExp(element, "i")
        });
        replacecount = replacecount + replace_data.item_details[element];
    }

    console.log('************************************************');
    console.log('barcode_search', barcode_search);
    console.log('************************************************');

    searchobj = {
        $and: [{
                $or: barcode_search
            },
            ordersearchobject
        ]
    }
    async.parallel({
            order_details: function (callback2) {
                var fields = {
                    __v: false,
                    _id: false,
                    is_set_on_HQ: false
                };
                OrderModel.find(ordersearchobject, fields, function (err, order_details) {
                    callback2(null, order_details);
                });
            },
            order_item_details: function (callback2) {
                var fields = {
                    __v: false,
                    _id: false,
                    is_set_on_HQ: false
                };
                OrderItemModel.find(searchobj, fields, function (err, order_details) {
                    callback2(null, order_details);
                });
            },
            item_id: function (callback2) {
                keys = Object.keys(data_replace_item_details);
                callback2(null, keys);
            },
            replace_data_barcode: function (callback2) {
                barcode = Object.keys(replace_data.replaced_item_details);
                callback2(null, barcode);
            },
            fooditemdetails: function (callback) {
                FoodItemModel.find({}, function name(error, reply) {
                    if (error) {
                        callback(error, null);
                    }
                    var maindata = _.groupBy(reply, function (value) {
                        return value.id;
                    });
                    callback(null, maindata);
                })
            }
        },
        function (err, results) {

            main_order_details = results.order_details;
            main_order_item_details = results.order_item_details;
            replace_data_barcode = results.replace_data_barcode;
            fooditemdetails = results.fooditemdetails;
            async.waterfall(
                [
                    //refund in the cash details
                    function (callback3) {
                        cashdetails.saveReplaceDataOnCashDetailsLocal(replace_data, main_order_details, main_order_item_details, data_replace_item_details, function (error, reply) {
                            callback3(error, reply);
                        });
                    },
                    //refund the old order
                    function (reply, callback3) {
                        var ammount_deduct = 0;
                        main_order_item_details = main_order_item_details;
                        main_order_item_details.forEach(function (
                            orderitems
                        ) {
                            original_quantity = orderitems.quantity;
                            ammount_deduct += orderitems.mrp * replacecount;
                            orderitems.quantity = orderitems.quantity - replacecount;
                            orderitems.is_send_to_HQ = false;
                            orderitems.outlet_order_id = main_order_details[0].outelt_order_id;
                            quantity = (orderitems.quantity != 0) ? orderitems.quantity * -1 : -1;
                            insert_order_items = {
                                bill_no: orderitems.bill_no,
                                quantity: quantity,
                                original_quantity: orderitems.count,
                                id: orderitems.id,
                                name: orderitems.name,
                                mrp: orderitems.mrp,
                                barcode: main_replace_barcodes,
                                is_set_on_HQ: false,
                                order_id: orderitems.order_id,
                                outlet_order_id: outlet_order_id
                            };
                            console.log('************************************************');
                            console.log('insert_order_items', insert_order_items);
                            console.log('************************************************');

                            insert_order_items = new OrderItemModel(insert_order_items);
                            insert_order_items.save(
                                function (error, order_item) {
                                    if (error) {
                                        console.log('##############################');
                                        console.log('error', error);
                                        console.log('##############################');
                                        callback3(error, ammount_deduct);
                                        return;
                                    }
                                    callback3(null, ammount_deduct);
                                    return;
                                }
                            );
                        });
                    },
                    function (ammount_deduct, callback3) {
                        //deduct the ammount from old order
                        main_order_details = main_order_details;
                        main_order_details[0].amount_due = parseInt(main_order_details[0].amount_due) - ammount_deduct;
                        barcodes = main_order_details[0].order_barcodes.split(",");
                        replacecodearary = Object.keys(replace_data.replaced_item_details)
                        if (typeof replacecodearary != "undefined") {
                            for (var index = 0; index < replacecodearary.length; index++) {
                                var element = replacecodearary[index];
                                barcodes.push(element);
                            }
                        }
                        main_order_details[0].order_barcodes = barcodes.join();
                        main_order_details[0].dispense_status = "{pending}";
                        neworder = Object.assign(main_order_details[0], OrderModel._doc);
                        searchobj = {
                            outlet_order_id: main_order_details[0].outlet_order_id
                        };

                        OrderModel.findOneAndUpdate(
                            searchobj,
                            neworder, {
                                upsert: true,
                                new: true
                            },
                            function (error, order) {
                                callback3(null, order);
                            }
                        );
                    },
                    function (order, callback3) {
                        // add new order details
                        var ammount_added = 0;
                        i = 0;
                        for (var items in data_replace_item_details) {
                            if (data_replace_item_details.hasOwnProperty(items)) {
                                var order_items = data_replace_item_details[items];
                                ammount_added += fooditemdetails[items][0].mrp;
                                console.log('************************************************');
                                console.log('fooditemdetails[items][0]', fooditemdetails[items][0]);
                                console.log('************************************************');
                                insert_order_items = {
                                    bill_no: replace_data.bill_no,
                                    quantity: order_items.count,
                                    original_quantity: null,
                                    id: items,
                                    name: order_items.name,
                                    mrp: fooditemdetails[items][0].mrp,
                                    barcode: replace_data_barcode[i],
                                    is_set_on_HQ: false,
                                    order_id: order.id,
                                    outlet_order_id: order.outlet_order_id,
                                    dispense_status: "{pending}",
                                    count: replace_data_barcode.length,
                                    dispensing_count: 0,
                                    delivered_count: 0,
                                    dispense_status_scanded_ids: "",
                                    delivered_status_scanded_ids: "",
                                };
                                i++;
                                insert_order_items = new OrderItemModel(insert_order_items);
                                insert_order_items.save();
                            }
                        }
                        callback3(null, ammount_added);
                    },
                    function (ammount_add, callback3) {
                        //deduct the ammount from old order
                        main_order_details = main_order_details;
                        main_order_details[0].amount_due = parseInt(main_order_details[0].amount_due) + ammount_add;
                        neworder = Object.assign(main_order_details[0], OrderModel._doc);

                        searchobj = {
                            outlet_order_id: main_order_details[0].outlet_order_id
                        };
                        OrderModel.findOneAndUpdate(
                            searchobj,
                            neworder, {
                                upsert: true,
                                new: true
                            },
                            function (error, order) {
                                callback3(null, order);
                            }
                        );
                    }
                ],
                function (err, data) {
                    callback(null, "success");
                    console.log("all called in waterfalls");
                }
            );
            // add new ammount to the order
        }
    );
}

router.post('/generate_duplicate_bill_old/:order_id', function (req, res, next) {
    var order_id = req.params.order_id;
    var mobile_num = req.body.mobile_num;

    // Make a call to HQ to get the order
    var hq_url = process.env.HQ_URL;
    var GET_ORDER_DETAILS_URL = '/outlet/order_details/';
    requestretry(hq_url + GET_ORDER_DETAILS_URL + order_id,
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                debug('{}: {} {}'.format(hq_url + GET_ORDER_DETAILS_URL, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url + GET_ORDER_DETAILS_URL, error, body));
                return;
            }
            var order_response = JSON.parse(body);
            if (order_response.length == 0) {
                res.send('Failed to find order details');
            }
            var order_details = [];
            var bill_no = order_response[0].bill_no;
            for (var i = 0; i < order_response.length; i++) {
                order_details.push({
                    "name": order_response[i].name,
                    "count": order_response[i].quantity,
                    "amount": order_response[i].quantity * order_response[i].mrp,
                    "side_order": order_response[i].side_order,
                    "restaurant_id": order_response[i].rest_id,
                    "restaurant_name": order_response[i].rest_name,
                    "cgst_percent": order_response[i].cgst_percent,
                    "sgst_percent": order_response[i].sgst_percent,
                    "entity": order_response[i].entity,
                    "address": order_response[i].address,
                    "tin_no": order_response[i].tin_no,
                    "st_no": order_response[i].tin_no
                });
                if (stringStartsWith(order_response[i].barcode, "xxxxx")) {
                    order_details.push({
                        "name": order_response[i].name,
                        "count": order_response[i].original_quantity,
                        "amount": order_response[i].original_quantity * order_response[i].mrp,
                        "side_order": order_response[i].side_order,
                        "restaurant_id": order_response[i].rest_id,
                        "restaurant_name": order_response[i].rest_name,
                        "cgst_percent": order_response[i].cgst_percent,
                        "entity": order_response[i].entity,
                        "address": order_response[i].address,
                        "sgst_percent": order_response[i].sgst_percent,
                        "tin_no": order_response[i].tin_no,
                        "st_no": order_response[i].tin_no
                    });
                }
            }

            var return_dict = {}
            order_details.map(function (item) {
                if (return_dict.hasOwnProperty(item.restaurant_id)) {
                    return_dict[item.restaurant_id].push(item);
                } else {
                    return_dict[item.restaurant_id] = [item];
                }
            });

            // Need a list of name, count, amount, side_order
            var dateObj = new Date();
            var date = dateObj.toDateString();
            var time = dateObj.toLocaleTimeString();
            startPrint(return_dict, bill_no, date, time, 0, mobile_num);
            res.send('Successfully re-generated bill');
        });
});


router.post('/generate_duplicate_bill/:order_id', function (req, res, next) {
    var order_id = req.params.order_id;
    var mobile_num = req.body.mobile_num;
    var outlet_order_id = req.body.outlet_order_id;
    search_place_order_order_id

    search_place_order_order_id(order_id, outlet_order_id, function (error, order_response) {
        if (typeof order_response != "undefined" || order_response != null || order_response != "") {
            var order_details = [];
            var bill_no = order_response[0].bill_no;
            main_order_details = [];
            for (var property in order_response[0].order_details) {
                if (order_response[0].order_details.hasOwnProperty(property)) {
                    // do stuff
                    item = order_response[0].order_details[property];
                    main_order_details.push({
                        "name": item.name,
                        "count": item.count,
                        "amount": item.count * item.price,
                        "side_order": item.side_order,
                        "restaurant_id": item.restaurant_details.id,
                        "restaurant_name": item.restaurant_details.name,
                        "cgst_percent": item.restaurant_details.cgst_percent,
                        "sgst_percent": item.restaurant_details.sgst_percent,
                        "entity": item.restaurant_details.entity,
                        "address": item.restaurant_details.address,
                        "tin_no": item.restaurant_details.tin_no,
                        "st_no": item.restaurant_details.tin_no
                    });
                    if (stringStartsWith(order_response[0].order_barcodes, "xxxxx")) {
                        main_order_details.push({
                            "name": item.name,
                            "count": item.count,
                            "amount": item.count * item.price,
                            "side_order": item.side_order,
                            "restaurant_id": item.restaurant_details.id,
                            "restaurant_name": item.restaurant_details.name,
                            "cgst_percent": item.restaurant_details.cgst_percent,
                            "sgst_percent": item.restaurant_details.sgst_percent,
                            "entity": item.restaurant_details.entity,
                            "address": item.restaurant_details.address,
                            "tin_no": item.restaurant_details.tin_no,
                            "st_no": item.restaurant_details.tin_no
                        });
                    }
                }
            }
            var return_dict = {}
            main_order_details.map(function (item) {
                if (return_dict.hasOwnProperty(item.restaurant_id)) {
                    return_dict[item.restaurant_id].push(item);
                } else {
                    return_dict[item.restaurant_id] = [item];
                }
            });

            // Need a list of name, count, amount, side_order
            var dateObj = new Date();
            var date = dateObj.toDateString();
            var time = dateObj.toLocaleTimeString();
            startPrint(return_dict, bill_no, date, time, 0, mobile_num);
            res.send('Successfully re-generated bill');
        } else {
            // Make a call to HQ to get the order
            var hq_url = process.env.HQ_URL;
            var GET_ORDER_DETAILS_URL = '/outlet/order_details/';
            requestretry(hq_url + GET_ORDER_DETAILS_URL + order_id,
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        debug('{}: {} {}'.format(hq_url + GET_ORDER_DETAILS_URL, error, body));
                        res.status(500).send('{}: {} {}'.format(hq_url + GET_ORDER_DETAILS_URL, error, body));
                        return;
                    }
                    var order_response = JSON.parse(body);
                    if (order_response.length == 0) {
                        res.send('Failed to find order details');
                        return;
                    }
                    var order_details = [];
                    var bill_no = order_response[0].bill_no;
                    for (var i = 0; i < order_response.length; i++) {
                        order_details.push({
                            "name": order_response[i].name,
                            "count": order_response[i].quantity,
                            "amount": order_response[i].quantity * order_response[i].mrp,
                            "side_order": order_response[i].side_order,
                            "restaurant_id": order_response[i].rest_id,
                            "restaurant_name": order_response[i].rest_name,
                            "cgst_percent": order_response[i].cgst_percent,
                            "sgst_percent": order_response[i].sgst_percent,
                            "entity": order_response[i].entity,
                            "address": order_response[i].address,
                            "tin_no": order_response[i].tin_no,
                            "st_no": order_response[i].tin_no
                        });
                        if (stringStartsWith(order_response[i].barcode, "xxxxx")) {
                            order_details.push({
                                "name": order_response[i].name,
                                "count": order_response[i].original_quantity,
                                "amount": order_response[i].original_quantity * order_response[i].mrp,
                                "side_order": order_response[i].side_order,
                                "restaurant_id": order_response[i].rest_id,
                                "restaurant_name": order_response[i].rest_name,
                                "cgst_percent": order_response[i].cgst_percent,
                                "entity": order_response[i].entity,
                                "address": order_response[i].address,
                                "sgst_percent": order_response[i].sgst_percent,
                                "tin_no": order_response[i].tin_no,
                                "st_no": order_response[i].tin_no
                            });
                        }
                    }

                    var return_dict = {}
                    order_details.map(function (item) {
                        if (return_dict.hasOwnProperty(item.restaurant_id)) {
                            return_dict[item.restaurant_id].push(item);
                        } else {
                            return_dict[item.restaurant_id] = [item];
                        }
                    });

                    // Need a list of name, count, amount, side_order
                    var dateObj = new Date();
                    var date = dateObj.toDateString();
                    var time = dateObj.toLocaleTimeString();
                    startPrint(return_dict, bill_no, date, time, 0, mobile_num);
                    res.send('Successfully re-generated bill');
                });
        }
    });


});

function search_place_order_order_id(order_id, outlet_order_id, callback) {
    obj = {
        outlet_order_id: outlet_order_id
    };
    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false,
    };
    console.log('************************************************');
    console.log('obj', obj);
    console.log('************************************************');

    PlaceOrderModel.find(obj, fields, function (err, orderitems) {
        if (err) {
            console.log('##############################');
            console.log('error', err);
            console.log('##############################');
            callback(err, null);
        };

        // object of all the users
        callback(null, orderitems);
    });
}


router.post('/resend_updated_sms', function (req, res, next) {
    var bill_no = req.body.bill_no;
    var food_item_id = req.body.food_item_id;
    var hq_url = process.env.HQ_URL;

    //get the food name from DB
    requestretry(hq_url + '/food_item/item_name/' + food_item_id,
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                debug('{}: {} {}'.format(hq_url + '/food_item/item_name/', error, body));
                res.status(500).send('{}: {} {}'.format(hq_url + '/food_item/item_name/', error, body));
                return;
            }
            var parsed_response = JSON.parse(body);
            var item_name = parsed_response.name;

            requestretry(hq_url + '/outlet/mobile_num/' + bill_no,
                function (sub_error, sub_response, sub_body) {
                    if (sub_error || (sub_response && sub_response.statusCode != 200)) {
                        debug('{}: {} {}'.format(hq_url + '/outlet/mobile_num/', sub_error, sub_body));
                        res.status(500).send('{}: {} {}'.format(hq_url + '/outlet/mobile_num/', sub_error, sub_body));
                        return;
                    }
                    if (!sub_body) {
                        return res.send('success');
                    }
                    var sub_parsed_response = JSON.parse(sub_body);

                    var mobile_num = sub_parsed_response.mobile_num;
                    //send the sms
                    sendUpdatedSMS(item_name, bill_no, mobile_num);
                    res.send('success');
                });
        });
});

// This return the image for the food_item id
router.get('/image/:id', function (req, res, next) {
    var food_item_id = req.params.id;
    // getting the filepath and sending the picture
    var filePath = process.env.SOURCE_FOLDER;
    var outlet_code = process.env.OUTLET_CODE;

    var customPath = path.join(filePath, outlet_code);
    customPath = path.join(customPath, 'menu_items');
    customPath = path.join(customPath, food_item_id);
    if (fs.existsSync(customPath)) {
        return res.sendFile(path.join(customPath, '4.png'));
    } else {
        filePath = path.join(filePath, food_item_id);
        // Sending 4.png because the resolution at 4.png looks ideal for order app
        filePath = path.join(filePath, '4.png');
        return res.sendFile(filePath);
    }
});

router.get('/test_mode', function (req, res, next) {
    redisClient.get(helper.test_mode_flag, function (get_err, get_reply) {
        if (get_err) {
            debug(get_err);
            res.status(500).send(false);
            return;
        }
        test_mode = JSON.parse(get_reply);
        if (test_mode === null) {
            test_mode = false;
        }
        res.send(test_mode);
    });
});

router.get('/stop_orders_state', function (req, res, next) {
    redisClient.get(helper.stop_orders_flag, function (get_err, get_reply) {
        if (get_err) {
            debug(get_err);
            res.status(500).send(false);
            return;
        }
        var stop_orders = JSON.parse(get_reply);
        if (stop_orders === null) {
            stop_orders = false;
        }
        res.send(stop_orders);
    });
});

router.get('/run_count', function (req, res, next) {
    // sending the run count to the order app
    res.send({
        run_count: RUN_COUNT
    });
});


// This call locks the quantity for the particular item code
// eg- {"direction": "increase", "delta_count": 2}
router.post('/lock_item/:item_id', function (req, res, next) {
    // increment/decrement the lock count here
    // then get stock count from redis and populate with the new lock data
    // and send to websocket
    var item_id = req.params.item_id;
    var delta_count = parseInt(req.body.delta_count);
    debug("Locking item id - ", item_id, " in direction- ", req.body.direction, " for quantity- ", delta_count);
    if (req.body.direction == "increase") {
        redisClient.incrby(item_id + '_locked_count', delta_count, update_lock_count_callback);
    } else if (req.body.direction == "decrease") {
        redisClient.decrby(item_id + '_locked_count', delta_count, update_lock_count_callback);
    } else if (req.body.direction == "decreaseCL") {
        // Check the item exist in pending_done queue.
        redisClient.get(helper.pending_done_node, function (err, reply) {
            if (err) {
                console.log(err);
            } else {
                if (reply) {
                    var queue_list = JSON.parse(reply);
                    if (queue_list.hasOwnProperty(item_id)) {
                        redisClient.decrby(item_id + '_locked_count', (delta_count - queue_list[item_id]), update_lock_count_callback);
                        console.log("Item id: " + item_id + " is already have " + queue_list[item_id] + " Qty in pending_done queue.");
                    } else {
                        redisClient.decrby(item_id + '_locked_count', delta_count, update_lock_count_callback);
                    }
                } else {
                    redisClient.decrby(item_id + '_locked_count', delta_count, update_lock_count_callback);
                }
            }
        });
    }

    function update_lock_count_callback(l_err, l_reply) {
        if (l_err) {
            console.error(l_err);
            res.status(500).send("error while retreiving from redis- 11 {}".format(l_err));
            return;
        }
        // Put the data in firebase
        var root_ref = new firebase(process.env.FIREBASE_CONN);
        var item_ref = root_ref.child(process.env.OUTLET_ID + '/stock_count/' + item_id + '/locked_count');
        item_ref.transaction(function (current_value) {
            if (current_value === null) {
                return 0;
            }
            if (req.body.direction == "increase") {
                return current_value += delta_count;
            } else if (req.body.direction == "decrease") {
                return current_value -= delta_count;
            }
        });
        redisClient.get(helper.stock_count_node, function (err, reply) {
            var parsed_response = JSON.parse(reply);
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

                // broadcasting the new stock count to all connected clients
                io.emit(helper.stock_count_node, parsed_response);
                debug("stock count is- ", JSON.stringify(parsed_response)); // Sending success to the ajax call
                res.send('success');
            });
        });
    }
});

// This call tries to check if a lock can be achieved
// If not, it responds accordingly
router.post('/try_lock/:item_id', function (req, res, next) {
    var target_item_id = req.params.item_id;
    var delta_count = parseInt(req.body.delta_count);
    debug("Trying to see if " + target_item_id + " can be locked");

    // First get the stock count and the locks,
    // construct the complete data structure
    redisClient.get(helper.stock_count_node, function (err, reply) {
        if (err) {
            debug(err);
            return res.send({
                "error": true,
                "flag": false
            });
        }
        var parsed_response = JSON.parse(reply);
        var item_id_list = [];
        for (var item_id in parsed_response) {
            item_id_list.push(item_id + '_locked_count');
        }

        var locker = lockredis(redisClient);
        locker('lock_item', {
            timeout: 5000,
            retries: Infinity,
            retryDelay: 10
        }, function (lock_err, done) {
            if (lock_err) {
                // Lock could not be acquired for some reason.
                debug(lock_err);
                return res.send({
                    "error": true,
                    "flag": false
                });
            }

            // do stuff...
            redisClient.mget(item_id_list, function (l_err, l_reply) {
                for (var item_id in parsed_response) {
                    if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
                        parsed_response[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                    } else {
                        parsed_response[item_id]["locked_count"] = 0;
                    }
                }
                if (!parsed_response.hasOwnProperty(target_item_id)) {
                    debug(target_item_id + ' does not exist in stock');
                    done(); // release lock
                    return res.send({
                        "error": true,
                        "flag": false
                    });
                }
                // If stock_quantity < 1 , return error
                var stock_quantity = getStockItemCount(parsed_response[target_item_id]["item_details"]) - parsed_response[target_item_id]["locked_count"];
                if (stock_quantity < 1) {
                    done(); // release lock
                    return res.send({
                        "error": false,
                        "flag": false
                    });
                } else {
                    parsed_response[target_item_id]["locked_count"]++;
                    redisClient.incrby(target_item_id + '_locked_count', 1, function (set_err, set_reply) {
                        if (set_err) {
                            debug(set_err);
                            done(); // release lock
                            return res.send({
                                "error": true,
                                "flag": false
                            });
                        }
                        io.emit(helper.stock_count_node, parsed_response);

                        // Put the data in firebase for cart addition
                        var root_ref = new firebase(process.env.FIREBASE_CONN);
                        var item_ref = root_ref.child(process.env.OUTLET_ID + '/stock_count/' + target_item_id + '/locked_count');
                        item_ref.transaction(function (current_value) {
                            if (current_value === null) {
                                return 0;
                            }
                            return current_value += 1;
                        });

                        debug("stock count is- ", JSON.stringify(parsed_response));
                        done(); // release lock
                        // else, increase the lock count, and then emit the new stock
                        return res.send({
                            "error": false,
                            "flag": true
                        });
                    });
                }
            });
        });
    });

});

function getStockItemCount(item_details) {
    var count = 0;
    for (var i = 0; i < item_details.length; i++) {
        if (!item_details[i]["expired"] && !item_details[i]["spoiled"]) {
            count += item_details[i]["count"];
        }
    }
    return count;
}

// This returns the discount percent of the customer based on his/her
// num_transactions
router.get('/customer_details/:mobile_num', function (req, res, next) {
    var mobile_num = req.params.mobile_num;
    var hq_url = process.env.HQ_URL;
    var CUSTOMER_DETAILS_URL = hq_url + '/outlet/customer_details/' + mobile_num;
    request({
        url: CUSTOMER_DETAILS_URL,
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
        res.send(JSON.parse(body));
    });
});

// This updates the customer_details row for that customer, with the new
// sales and savings value and incremented the num_transactions value
router.post('/customer_details/:mobile_num', function (req, res, next) {
    var mobile_num = req.params.mobile_num;
    var total_expenditure = req.body.total_expenditure;
    var total_savings = req.body.total_savings;

    var hq_url = process.env.HQ_URL;
    var CUSTOMER_DETAILS_URL = hq_url + '/outlet/customer_details/' + mobile_num;
    request({
        url: CUSTOMER_DETAILS_URL,
        method: "POST",
        json: {
            "total_expenditure": total_expenditure,
            "total_savings": total_savings
        }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
        res.send(body);
    });
});

// helper functions
function getOldestBarcode(item_id, item_details, expiry_time) {
    var oldestTimestamp = 9999999900; // This is the max timestamp possible
    var barcode = null;
    var current_time = Math.floor(Date.now() / 1000);

    var expiry_time_secs = parseFloat(expiry_time.slice(0, expiry_time.length - 1)) * 60 * 60;
    for (var i = 0; i < item_details.length; i++) {
        // This item has expired, no need to see this item
        // if (item_details[i]["expired"] || item_details[i]["spoiled"])
        if (item_details[i]["spoiled"]) {
            continue;
        }
        if (item_details[i]["expired"]) {
            //16:00  16:00-16:05  
            // timestamp 10:00 expiry time: 16:00  16:05<16:02   16:05< 16:07
            if ((item_details[i]["timestamp"] + expiry_time_secs + 300) < current_time) {
                console.log("current_time", current_time);
                console.log("item-------------------", item_details[i]["timestamp"]);
                console.log("item-------------------", expiry_time_secs);
                continue;
            }
        }
        if (item_details[i]["timestamp"] < oldestTimestamp) {
            oldestTimestamp = item_details[i]["timestamp"];
            barcode = item_details[i]["barcode"];
            console.log("barcode**********", barcode);
        }
    }
    console.log("barcode-----------------", barcode);
    return barcode;

}

function updateStockCount(stock_count, barcode) {
    for (var item_id in stock_count) {
        var item = stock_count[item_id]["item_details"];
        for (var i = 0; i < item.length; i++) {
            if (item[i]["barcode"] == barcode) {
                stock_count[item_id]["item_details"][i]["count"]--;
                // If there are no more items left, delete the node
                if (!stock_count[item_id]["item_details"][i]["count"]) {
                    stock_count[item_id]["item_details"].splice(i, 1);
                    i--;
                }
            }
        }
    }
    return stock_count;
}

function getOrderStubDate() {
    var date_obj = new Date();
    // gets a list of [dd, mm, yyyy]
    var date_items = date_obj.toISOString().substr(0, 10).split('-').reverse();
    // stripping off the first 2 characters from yyyy
    date_items[2] = date_items[2].substr(2);
    // joining them and returning
    return date_items.join('');
}

function createOrderStub(barcode, lane_no,
    heating_flag, date,
    bill_no, dispense_id, heating_reduction, isveg, plc_type) { // SHLOK
    debug("createOrderStub:: Heating: " + heating_flag + "; Reduction:" + heating_reduction + "; Veg:" + isveg);
    var heating = heating_reduction;
    var veg = '1';

    if (!heating_flag) {
        heating = '0';
    }
    /* else if (heating_reduction) {
          heating = '1';
      } else {
          heating = '2';
    } */

    if (!isveg) // non-Veg
    {
        veg = '0';
    }

    var order_stub = '';
    order_stub += parseInt(lane_no).pad();
    order_stub += barcode;
    order_stub += heating;
    //order_stub += (heating_flag) ? 'Y' : 'N';
    //order_stub += (heating_reduction) ? 'Y' : 'N'; // SHLOK
    order_stub += date;
    order_stub += dispense_id.pad(6);
    if (Number(plc_type) == 0) {
        console.log("createOrderStub :: old plc_type machine called: " + plc_type);
        order_stub += bill_no.pad(10);
    } else {
        console.log("createOrderStub :: new plc_type machine called: " + plc_type);
        order_stub += 0;
        order_stub += veg;
        order_stub += bill_no.pad(8);
    }
    debug("Created order stub as- ", order_stub);

    return order_stub;
}

function isEmpty(stock_count) {
    for (var item_id in stock_count) {
        var item = stock_count[item_id]["item_details"];
        // check if all items are sold or not
        if (item == undefined) {
            continue;
        }
        for (var i = 0; i < item.length; i++) {
            // check if the item is not expired or spoiled
            if (item[i]["expired"] || item[i]["spoiled"]) {
                continue;
            }
            if (item[i]["count"]) {
                return false;
            }
        }
    }
    return true;
}

function getFoodDetails(restaurant_details) {
    var food_details = {};
    for (var i = 0; i < restaurant_details["items"].length; i++) {
        food_details[restaurant_details["items"][i]["id"]] = restaurant_details["items"][i]["count"];
    }
    return food_details;
}

function prepareBillDict(order_details, sides) {
    var bill_dict = {};
    for (var item_id in order_details) {
        bill_dict[item_id] = order_details[item_id]["count"];
    }
    if (sides) {
        for (var item_id in sides) {
            bill_dict[item_id] = sides[item_id]["count"];
        }
    }
    return bill_dict;
}

function prepareBillToPrint(order_details, sides) {
    console.log("order details inside prepareBillToPrint--------------------", order_details);
    var bill_items = [];
    for (var item_id in order_details) {
        bill_items.push({
            "name": order_details[item_id]["name"],
            "count": order_details[item_id]["count"],
            "amount": order_details[item_id]["price"],
            "side_order": order_details[item_id]["side_order"],
            "restaurant_id": order_details[item_id]["restaurant_details"]["id"],
            "tin_no": order_details[item_id]["restaurant_details"]["tin_no"],
            "st_no": order_details[item_id]["restaurant_details"]["st_no"],
            "cgst_percent": order_details[item_id]["restaurant_details"]["cgst_percent"],
            "sgst_percent": order_details[item_id]["restaurant_details"]["sgst_percent"],
            "entity": order_details[item_id]["restaurant_details"]["entity"],
            "address": order_details[item_id]["restaurant_details"]["address"],
            "restaurant_name": order_details[item_id]["restaurant_details"]["name"]
        });
    }
    if (sides) {
        for (var item_id in sides) {
            bill_items.push({
                "name": sides[item_id]["name"],
                "count": sides[item_id]["count"],
                "amount": sides[item_id]["price"],
                "side_order": sides[item_id]["side_order"],
                "restaurant_id": sides[item_id]["restaurant_details"]["id"],
                "tin_no": sides[item_id]["restaurant_details"]["tin_no"],
                "st_no": sides[item_id]["restaurant_details"]["st_no"],
                "cgst_percent": sides[item_id]["restaurant_details"]["cgst_percent"],
                "sgst_percent": sides[item_id]["restaurant_details"]["sgst_percent"],
                "entity": sides[item_id]["restaurant_details"]["entity"],
                "address": sides[item_id]["restaurant_details"]["address"],
                "restaurant_name": sides[item_id]["restaurant_details"]["name"]
            });
        }
    }
    // Grouping them by restaurant
    var return_dict = {}
    bill_items.map(function (item) {
        if (return_dict.hasOwnProperty(item.restaurant_id)) {
            return_dict[item.restaurant_id].push(item);
        } else {
            return_dict[item.restaurant_id] = [item];
        }
    });
    return return_dict;
}

function stringStartsWith(string, prefix) {
    return string.slice(0, prefix.length) == prefix;
}

function getItemId(barcode) {
    return parseInt(barcode.substr(8, 4), 36);
}

Number.prototype.pad = function (size) {
    var s = String(this);
    while (s.length < (size || 2)) {
        s = "0" + s;
    }
    return s;
}

//function created by peerbits for making bill info store on the local storage
// 22-Aug-2017
function bill_info_to_store(bill_to_print, bill_no, date, time, savings, mobile_num, results) {
    return bill_print_info = {
        "bill_to_print": JSON.stringify(bill_to_print),
        "bill_no": bill_no,
        "date": date,
        "time": time,
        "savings": savings,
        "mobile_num": mobile_num,
        "outlet_phone_no": results.outlet_phone_no,
    }
}

router.get('/getmenuitems', function (req, res, next) {
    // Getting the data from redis
    redisClient.get(helper.outlet_menu_items, function (err, reply) {
        if (err) {
            res.status(500).send("error while retreiving from redis- 12 {}".format(err));
            res.end();
            return;
        }
        res.type('application/json').send(reply);
        res.end();
        return;
    });
});


router.post("/refund_items/:order_id", function (req, res, next) {
    console.log("##############################");
    var order_id = req.params.order_id;
    var data = {};
    data["amount"] = req.body.amount;
    data["item_details"] = req.body.item_details;
    data["bill_no"] = req.body.bill_no;
    data["mobile_num"] = req.body.mobile_num;
    data["outlet_order_id"] = req.body.outlet_order_id;
    data["order_id"] = req.params.order_id;
    barcodes = Object.keys(req.body.item_details);
    data["food_count"] = data["item_details"][barcodes.join(",")];
    console.log('************************************************');
    console.log('data["item_details"]', data);
    console.log('************************************************');

    search_obj = {
        "order_id": order_id,
        "outlet_order_id": req.body.outlet_order_id
    };
    saveRefundData(data, function (error, reply) {
        if (error) {
            res.status(500).send("faliure");
            return;
        }
        internetAvailable({
            timeout: 1000,
            retries: 3,
        }).then(function () {
            search_order_item_by_order_id_barcode(search_obj, barcodes, function (
                error,
                order_items
            ) {
                order_items = JSON.parse(order_items);
                console.log('************************************************');
                console.log('order_items', order_items);
                console.log('************************************************');

                if (order_items.length > 0) {

                    offline_refund_data(order_id, barcodes, data, function (err, reply) {
                        console.log('************************************************');
                        console.log('barcodes', barcodes);
                        console.log('************************************************');

                        if (err) {
                            res.send(err);
                            return;
                        }

                        res.send(reply);
                        return;
                    });
                } else {
                    REFUND_ORDER_ITEMS_URL = process.env.HQ_URL + '/outlet/refund_items/' + order_id
                    requestretry({
                            url: REFUND_ORDER_ITEMS_URL,
                            json: data,
                            maxAttempts: 5,
                            _timeout: 1000,
                            method: "POST"
                        },
                        function (error, response, body) {
                            if (
                                error ||
                                (response && response.statusCode != 200)
                            ) {
                                console.log("outlet_app.js :: showorders " + "{}: errror = {} {}".format(REFUND_ORDER_ITEMS_URL, error, JSON.stringify(response)));
                                res.send(JSON.parse("[]"));
                                return;
                            }
                            res.send(body);
                            return;
                        }
                    );
                }
            });
        }).catch(function () {
            search_order_item_by_order_id(order_id, function (
                error,
                order_items
            ) {
                order_items = JSON.parse(order_items);
                if (order_items.length > 0) {
                    offline_refund_data(order_id, barcodes, data, function (err, reply) {
                        if (err) {
                            res.send(err);
                            return;
                        }
                        res.send(reply);
                        return;
                    });
                } else {
                    res.send(success);
                    return;
                }
            });
        });

    });


    //res.send("success");
});

function saveRefundData(data, callback) {
    redisClient.lpush(helper.refund_data_list_node, JSON.stringify(data), function (error, reply) {
        callback(null, reply);
    });
}

function offline_refund_data(order_id, barcodes, data, callback) {
    var ammount_deduct = 0;

    console.log('************************************************');
    console.log('order_id', order_id);
    console.log('************************************************');

    console.log('************************************************');
    console.log('barcodes', barcodes);
    console.log('************************************************');

    console.log('************************************************');
    console.log('data', data);
    console.log('************************************************');

    console.log('************************************************');
    console.log('callback', callback);
    console.log('************************************************');


    barcodes = Object.keys(data["item_details"]);
    if (barcodes.length > 1) {
        main_barcodes = barcodes.join(",");
    } else {
        main_barcodes = barcodes;
    }

    searchobj = {
        bill_no: data["bill_no"],
        outlet_order_id: data["outlet_order_id"]
    };
    console.log('************************************************');
    console.log('barcodes', barcodes);
    console.log('************************************************');

    search_order_item_by_order_id_barcode(searchobj, barcodes,
        function (err, orderitems_detail) {

            console.log('************************************************');
            console.log('orderitems_detail', orderitems_detail);
            console.log('************************************************');


            orderitems_detail = JSON.parse(orderitems_detail);

            console.log('************************************************');
            console.log('orderitems_detail', orderitems_detail);
            console.log('************************************************');
            //  process.exit();


            deduct_food_count = 0;
            orderitems_detail.forEach(function (orderitems) {
                ammount_deduct += orderitems.mrp;
                deduct_food_count++;
                orderitems.quantity = data["food_count"] * -1;
                orderitems.original_quantity = data["food_count"];
                orderitems.is_send_to_HQ = false;
                orderitems.barcode = main_barcodes;
                orderitemdetails = new OrderItemModel(orderitems);

                console.log('************************************************');
                console.log('orderitems_detail insert', orderitemdetails);
                console.log('************************************************');

                orderitemdetails.save();
            });

            deduct_food_count = data["food_count"];
            ammount_deduct = data.amount;

            console.log('************************************************');
            console.log('ammount_deduct insert', ammount_deduct);
            console.log('************************************************');


            subtract_ammount_deduct(ammount_deduct, deduct_food_count, {
                    outlet_order_id: data["outlet_order_id"]
                },
                function (error, reply) {
                    callback(err, reply);
                }
            );
        }
    );
}

function subtract_ammount_deduct(ammount_deduct, deduct_food_count, searchobj, callback) {
    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false
    };
    console.log('************************************************');
    console.log('searchobj', searchobj);
    console.log('************************************************');
    OrderModel.find(searchobj, fields, function (err, order) {
        console.log('************************************************');
        console.log('order', order);
        console.log('************************************************');
        //order = JSON.parse(order);
        order[0].amount_due = parseInt(order[0].amount_due) - ammount_deduct;
        neworder = Object.assign(order[0], OrderModel._doc);
        console.log('##############################');
        console.log("neworder", neworder);
        console.log('##############################');
        cashdetails.saveRefundDataOnCashDetailsLocal(ammount_deduct, deduct_food_count, order[0].method);
        OrderModel.findOneAndUpdate(
            searchobj,
            neworder, {
                upsert: true,
                new: true
            },
            function (error, reply) {
                callback(error, reply);
            }
        );
    });
}

function search_order_item_by_order_id_barcode(searchobj, barcode, callback) {
    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false
    };
    searchbarcodes = [];

    if (typeof barcode != "undefined" && barcode != "null") {
        for (var index = 0; index < barcode.length; index++) {
            var element = {
                "barcode": new RegExp(barcode[index], "i")
            };
            searchbarcodes.push(element);
        }
    }


    if (searchbarcodes.length > 0) {
        finddata = {
            $and: [{
                    $or: searchbarcodes
                },
                searchobj
            ]
        }
    } else {
        finddata = searchobj;
    }

    console.log('************************************************');
    // console.log('find data for refund', finddata);
    console.log('finddata data for refund', finddata);
    console.log('************************************************');


    OrderItemModel.find(finddata, fields, function (err, orderitems) {
        if (err) {
            console.log("##############################");
            console.log("error", err);
            console.log("##############################");
        }
        orderitems = JSON.stringify(orderitems);
        console.log('************************************************');
        console.log('order items', orderitems);
        console.log('************************************************');

        // object of all the users
        callback(null, orderitems);
    })
}

function search_order_item_detail(searchobj, callback) {
    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false
    };
    OrderItemModel.find(searchobj, fields, function (err, orderitems) {
        if (err) {
            console.log("##############################");
            console.log("error", err);
            console.log("##############################");
        }
        orderitems = JSON.stringify(orderitems);
        // object of all the users
        callback(null, orderitems);
    });
}

function search_order_item_by_order_id(order_id, callback) {
    obj = {
        order_id: parseInt(order_id)
    };

    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false
    };
    console.log("##############################");
    console.log("obj", obj);
    console.log("##############################");

    OrderItemModel.find(obj, fields, function (err, orderitems) {
        if (err) {
            console.log("##############################");
            console.log("error", err);
            console.log("##############################");
        }
        orderitems = JSON.stringify(orderitems);
        // object of all the users
        callback(null, orderitems);
    });
}

function search_order_item_by_order_id(order_id, callback) {
    obj = {
        order_id: parseInt(order_id)
    };

    var fields = {
        __v: false,
        _id: false,
        is_set_on_HQ: false
    };

    OrderItemModel.find(obj, fields, function (err, orderitems) {
        if (err) {
            console.log("##############################");
            console.log("error", err);
            console.log("##############################");
        }
        orderitems = JSON.stringify(orderitems);
        // object of all the users
        callback(null, orderitems);
    });
}


function checkIfTestMode(barcode) {
    if (barcode[0] == '9' && barcode[1] == '0') {
        return true;
    } else {
        return false;
    }
}

module.exports = router;