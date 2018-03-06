var redis = require("redis");
var format = require("string-format");
var helper = require('../routes/helper');
var moment = require('moment');
var async = require('async');
var request = require('request');
var requestretry = require('requestretry');
var requestpromise = require('request-promise');
var internetAvailable = require("internet-available");

format.extend(String.prototype);
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function(msg) {
    console.error(msg);
});

function sendingOfflinedetails() {
    console.log('##############################');
    console.log('send offline details called ');
    console.log('##############################');
    internetAvailable({
            timeout: 1000,
            retries: 3,
        })
        .then(function() {
            async.parallel({
                outlet_register_status: function (callback) {
                    redisClient.lrange(helper.outlet_register_status_node, 0, 50, function (err, reply) {
                        if (err) {
                            callback(err, null);
                            return;
                        }
                        data = [];
                        for (var index = 0; index < reply.length; index++) {
                            //var element = reply[index];
                            data.push(JSON.parse(reply[index]));
                        }
                        callback(null, data);
                    });
                },
                store_supplies_eod: function(callback) {
                    redisClient.lrange(helper.store_eod_supplies_node, 0, 50, function(err, reply) {
                        if (err) {
                            callback(err, null);
                            return;
                        }
                        data = [];
                        for (var index = 0; index < reply.length; index++) {
                            //var element = reply[index];
                            data.push(JSON.parse(reply[index]));
                        }
                        callback(null, data);
                    });
                },
                dispense_recovery_detail: function(callback) {
                    redisClient.lrange(helper.dispense_recovery_detail_node, 0, 50, function(err, reply) {
                        if (err) {
                            callback(err, null);
                            return;
                        }
                        callback(null, reply);
                    });
                },
                store_loading_issue_details: function(callback) {
                    redisClient.lrange(helper.loading_item_issue_node, 0, 50, function(err, reply) {
                        if (err) {
                            callback(err, null);
                            return;
                        }
                        callback(null, reply);
                    });
                },
                start_of_day_supplies: function(callback) {
                    redisClient.lrange(helper.supplies_detail_to_send_node, 0, 50, function(err, reply) {
                        if (err) {
                            callback(err, null);
                        }
                        callback(null, reply);
                    });
                },
                test_mode_issues: function(callback) {
                    redisClient.lrange(helper.test_mode_issues_node, 0, 50, function(err, reply) {
                        if (err) {
                            callback(err, null);
                        }
                        callback(null, reply);
                    });
                },
                test_mode_details_to_send: function(callback) {
                    redisClient.lrange(helper.test_mode_details_node, 0, 50, function(err, reply) {
                        if (err) {
                            callback(err, null);
                        }
                        callback(null, reply);
                    });
                },
                petty_cash_to_HQ: function(callback) {
                    redisClient.lrange(helper.petty_cash_to_HQ_node, 0, 50, function(err, reply) {
                        if (err) {
                            callback(err, null);
                        }
                        callback(null, reply);
                    });
                },
                checkonline: function(callback) {
                    internetAvailable({
                            timeout: 1000,
                            retries: 5,
                        })
                        .then(function() {
                            callback(null, true);

                        })
                        .catch(function(err) {
                            callback(null, false);
                        });

                },

            }, function(err, results) {
                if (err) {
                    console.error("error in the sendingOfflinedetails ", err);
                }
                console.log('************************************************');
                console.log('results.checkonline', results.checkonline);
                console.log('************************************************');
                
                // is_online({timeout:2000}).then(function(online){
                if (results.checkonline == "true") {
                //if(true){
                    /* ********* data send related to supplies eod ***********/
                    if (typeof results.outlet_register_status != "undefined" && results.outlet_register_status.length > 0 && results.outlet_register_status != null) {
                        console.log('************************************************');
                        console.log('out of the function');
                        console.log('************************************************');
                        outlete_register_status_function(results);
                    }
                    /* ********* end data send related to supplies eod ***********/
                    /* ********* data send related to supplies eod ***********/
                    if (typeof results.store_supplies_eod != "undefined" && results.store_supplies_eod.length > 0 && results.store_supplies_eod != null) {
                        supplies_eod(results);
                    }
                    /* ********* end data send related to supplies eod ***********/
                    /* ********* start dispense_recovery_detail_node  ***********/
                    if (typeof results.dispense_recovery_detail != "undefined" && results.dispense_recovery_detail.length > 0 && results.dispense_recovery_detail != null) {
                        dispense_recovery_detail_eod(results);
                    }
                    /* ********* end dispense_recovery_detail_node  ***********/
                    /* ********* start send offline detail issue  ***********/
                    if (typeof results.store_loading_issue_details != "undefined" && results.store_loading_issue_details.length > 0 && results.store_loading_issue_details != null) {
                        send_store_loading_issue_items(results);
                    }
                    /* ********* end send offline detail issue  ***********/
                    /* ********* start send start of the day supplies  ***********/
                    if (typeof results.start_of_day_supplies != "undefined" && results.start_of_day_supplies.length > 0 && results.start_of_day_supplies != null) {
                        send_strart_of_day_supplies(results);
                    }
                    /* ********* end send start of the day supplies  ***********/
                    /* ********* start send start of the day supplies  ***********/
                    if (typeof results.test_mode_issues != "undefined" && results.test_mode_issues.length > 0 && results.test_mode_issues != null) {
                        send_test_mode_issues(results);
                    }
                    /* ********* end send start of the day supplies  ***********/
                    /* ********* start send start of the day supplies  ***********/
                    if (typeof results.test_mode_details_to_send != "undefined" && results.test_mode_details_to_send.length > 0 && results.test_mode_details_to_send != null) {
                        send_test_mode_details(results);
                    }
                    /* ********* end send start of the day supplies  ***********/
                    /*********** start of petty cash details**************** */
                    if (typeof results.petty_cash_to_HQ != "undefined" && results.petty_cash_to_HQ.length > 0 && results.petty_cash_to_HQ != null) {
                        send_petty_cash_to_HQ_details(results);
                    }
                    /************ end of petty cash details******************* */

                    // if (typeof results.reconcile_to_HQ != "undefined" && results.reconcile_to_HQ.length > 0 && results.reconcile_to_HQ != null) {

                    //     send_reconcile_data_to_HQ(results); //rajesh code merge up

                    // }

                } else {
                    console.log('##############################');
                    console.log('no internet found on start and end of day siganal');
                    console.log('##############################');
                }
                // });
            });
        })
        .catch(function(err) {
            console.log('##############################');
            console.log('no internet found on start and end of day siganal');
            console.log('##############################');
        });
}


function outlete_register_status_function(results){
    console.log('************************************************');
    console.log('out of the function', results.outlet_register_status);
    console.log('************************************************');
    var outlet_register_status = results.outlet_register_status;
    var calls = [];
    var hq_url = process.env.HQ_URL;
    var OUTLET_REGISTER_URL = hq_url + '/outlet_mobile/outlet_register_status';
    console.log('************************************************');
    console.log('OUTLET_REGISTER_URL', OUTLET_REGISTER_URL);
    console.log('************************************************');
    
    for (var index = 0; index < outlet_register_status.length; index++) {
        var data = JSON.parse(outlet_register_status[index]);
        var phase = data.phase;
        var outlet_id = data.outlet_id;
        var isautomaticEOD = data.isautomaticEOD;
        var time = data.time;
        var function_element = function (callback) {
            requestretry({
                url: OUTLET_REGISTER_URL,
                timeout: 3000,
                method: "POST",
                json: { "phase": phase, "outlet_id": outlet_id, "isautomaticEOD": true,"time":time }
            }, function (error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.log('************************************************');
                    console.log('error', error);
                    console.log('************************************************');
                    
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                //debug("Updated HQ with the recovery details");
                console.log('##############################');
                console.log('here in request');
                console.log('##############################');
                removeelementsfromlist(helper.outlet_register_status_node, JSON.stringify(data));
                callback(null, body);
            });
        };
        console.log('function_element' + function_element);
        calls.push(function_element);
    }

    callallfunctions(calls);
    return;
}
//funciton will send the details of end of the day supply details to the HQ
/* ********* data send related to supplies eod ***********/
function supplies_eod(results) {
    var store_supplies_eod = results.store_supplies_eod;
    var calls = [];
    var hq_url = process.env.HQ_URL;
    var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status?phase=end_of_day';
    //if(store_supplies_eod.length>0){
    for (var index = 0; index < store_supplies_eod.length; index++) {
        callSuppliesDetails(store_supplies_eod[index])
    }
    //}
    return;
}

/* ********* end data send related to supplies eod ***********/


//funciton will send the details of despense recovery to the HQ
/* ********* start dispense_recovery_detail_node  ***********/
function dispense_recovery_detail_eod(results) {
    var dispense_recovery_detail = results.dispense_recovery_detail;
    var calls = [];
    var hq_url = process.env.HQ_URL;
    var UPDATE_RECOVERY_DETAILS_URL = hq_url + '/outlet/update_recovery_details/' + process.env.OUTLET_ID;
    for (var index = 0; index < dispense_recovery_detail.length; index++) {
        var data = JSON.parse(dispense_recovery_detail[index]);
        var dispense_id = data.dispense_id;
        var bill_no = data.bill_no;
        var time = data.time;
        var function_element = function(callback) {
            requestretry({
                url: UPDATE_RECOVERY_DETAILS_URL,
                method: "POST",
                json: {
                    "bill_no": bill_no,
                    "dispense_id": dispense_id,
                    "time": time,
                }
            }, function(error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                //debug("Updated HQ with the recovery details");
                console.log('##############################');
                console.log('here in request');
                console.log('##############################');
                removeelementsfromlist(helper.dispense_recovery_detail_node, JSON.stringify(data));
                callback(null, body);
            });
        };
        calls.push(function_element);
    }

    callallfunctions(calls);
    return;
}
/* ********* end dispense_recovery_detail_node  ***********/

//funciton will send the end of the day loading issue to the HQ
/* ********* start dispense_recovery_detail_node  ***********/
function send_store_loading_issue_items(results) {
    var loading_item_issue = results.store_loading_issue_details;
    var calls = [];
    var hq_url = process.env.HQ_URL;
    var STORE_LOADING_ISSUE_ITEMS_URL = hq_url + '/outlet/report_loading_issue/' + process.env.OUTLET_ID;
    for (var index = 0; index < loading_item_issue.length; index++) {
        var data = JSON.parse(loading_item_issue[index]);
        item_id_info = JSON.parse(data.item_id_info);
        time = data.time;
        var function_element = function(callback) {
            requestretry({
                url: STORE_LOADING_ISSUE_ITEMS_URL,
                method: "POST",
                json: { "item_id_info": item_id_info, "time": time }
            }, function(error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                removeelementsfromlist(helper.loading_item_issue_node, JSON.stringify(data));
            });
        };
        calls.push(function_element);
    }
    callallfunctions(calls);
    return;
}
/* ********* end dispense_recovery_detail_node  ***********/


/* ********* strat start_of_day_supplies  ***********/
function send_strart_of_day_supplies(results) {
    sod_supplies = results.start_of_day_supplies;
    var calls = [];
    var hq_url = process.env.HQ_URL;
    var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status_offline?phase=start_of_day';
    for (var index = 0; index < sod_supplies.length; index++) {
        var data = JSON.parse(sod_supplies[index]);
        var supplies = data.supplies;
        var time = JSON.parse(JSON.stringify(data.time));
        console.log('##############################');
        console.log('supplies', supplies);
        console.log('time', time);
        console.log('##############################');

        function_element = function(callback) {
            requestretry({
                url: SUPPLIES_STATUS_URL,
                method: "POST",
                json: { "supplies": supplies, "time": time }
            }, function(error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.log('##############################');
                    console.log('error', error);
                    console.log('##############################');

                    console.error('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                removeelementsfromlist(helper.supplies_detail_to_send_node, JSON.stringify(data));
                // debug(body);
            });

        };
        calls.push(function_element);
    }
    callallfunctions(calls);
}
/* ********* end start_of_day_supplies  ***********/

/* ********* send test mod issues start  ***********/
function send_test_mode_issues(results) {
    test_mode_issues = results.test_mode_issues;

    TEST_MODE_ISSUES_URL = '/outlet/test_mode_issue_offline/';
    testmodeurl = process.env.HQ_URL + TEST_MODE_ISSUES_URL + process.env.OUTLET_ID;
    calls = [];
    console.log('##############################');
    console.log('test_mode_issues.length', test_mode_issues.length);
    console.log('##############################');

    for (var index = 0; index < test_mode_issues.length; index++) {
        test_mode_data = JSON.parse(test_mode_issues[index]);
        calls.push(test_mode_data);
    }

    function_element = function(data, callback) {
        var issue_text = data.issue_text;
        var time = JSON.parse(JSON.stringify(data.time));
        console.log('##############################');
        console.log('in the funciton issue_text', issue_text, time);
        console.log('##############################');
        requestretry({
                url: testmodeurl,
                method: "POST",
                json: { "text": issue_text, "time": time }
            },
            function(error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                callback(error, body);
                removeelementsfromlist(helper.test_mode_issues_node, JSON.stringify(data));
            });
    };

    callallfunctionsinloop(calls, function_element);
    //callallfunctions(calls);
    // process.exit();
    return;
}
/* ********* end test mod issues end  ***********/

function send_test_mode_details(results) {
    var test_mode_details = results.test_mode_details_to_send;
    var hq_url = process.env.HQ_URL;
    var TEST_MODE_TIME_URL = '/outlet/new_test_mode_time/';
    var outlet_id = process.env.OUTLET_ID;
    calls = [];
    for (var index = 0; index < test_mode_details.length; index++) {
        data = JSON.parse(test_mode_details[index]);
        var obj = data.obj;
        var function_element = function(callback) {
            requestretry({
                url: hq_url + TEST_MODE_TIME_URL + outlet_id,
                method: "POST",
                maxAttempts: 10,
                json: obj
            }, function(error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                console.log('##############################');
                console.log('in functon ', body);
                console.log('##############################');
                removeelementsfromlist(helper.test_mode_details_node, JSON.stringify(data));
                callback(null, body);
            });
        };
        calls.push(function_element);
    }
    callallfunctions(calls);
    return;
}

function send_petty_cash_to_HQ_details(results) {
    var send_petty_cash_to_HQ_details = results.petty_cash_to_HQ;
    var hq_url = process.env.HQ_URL;
    var PETTY_EXPENDITURE_URL = '/outlet/petty_expenditure/';
    var outlet_id = process.env.OUTLET_ID;
    calls = [];
    var function_element;
    for (var index = 0; index < send_petty_cash_to_HQ_details.length; index++) {
        data = JSON.parse(send_petty_cash_to_HQ_details[index]);
        calls.push(data);
    }
    callallfunctionsinloop(calls, sendPettyCashInfo)
    return;
}

function sendPettyCashInfo(data, callback) {
    var hq_url = process.env.HQ_URL;
    var PETTY_EXPENDITURE_URL = '/outlet/petty_expenditure/';
    var outlet_id = process.env.OUTLET_ID;
    requestretry({
            url: hq_url + PETTY_EXPENDITURE_URL + outlet_id,
            forever: true,
            method: "POST",
            json: { "data": data }
        },
        function(error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            console.log('##############################');
            console.log('in request', data);
            console.log('##############################');
            removeelementsfromlistfunction(helper.petty_cash_to_HQ_node, JSON.stringify(data), callback);
        });
}

function callallfunctionsinloop(data, callfunction) {
    async.map(data, callfunction, function(err, reply) {
        if (err) {
            console.log(err);
        }
        console.log('##############################');
        console.log('reply', reply);
        console.log('##############################');
        return;
    });
}
//if call stack of all the calles parrallely
//call all functions start
function callallfunctions(calls) {
    console.log('##############################');
    console.log('calls', calls);
    console.log('##############################');
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
        return;
    });
}

function callSuppliesDetails(store_supplies_eod) {
    var hq_url = process.env.HQ_URL;
    var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status?phase=start_of_day';
    var supplies = store_supplies_eod.supplies;
    var time = store_supplies_eod.time;
    requestpromise({
        url: SUPPLIES_STATUS_URL,
        method: "POST",
        json: true,
        body: { "supplies": supplies, "time": time }
    }).then(function(htmlString) {
        if (htmlString == "success") {
            removeelementsfromlist(helper.store_eod_supplies_node, JSON.stringify(store_supplies_eod));
        }
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


function removeelementsfromlist(node, string) {
    redisClient.lrem(node, 0, string, function(err, reply) {
        if (err) {
            console.error("data not deleted form sending cron");
        }
        console.log('##############################');
        console.log('removed item node', reply, node, string);
        console.log('##############################');
    });
}




function send_reconcile_data_to_HQ(reconcile_data) {
    var hq_url = process.env.HQ_URL;
    var save_reconcile_data_url = hq_url + '/outlet/save_reconcile_data/';
    var outlet_id = process.env.OUTLET_ID;
    calls = [];
    var function_element;
    for (var index = 0; index < reconcile_data.reconcile_to_HQ.length; index++) {
        data = JSON.parse(reconcile_data.reconcile_to_HQ[index]);
        if (data[index].is_set_on_HQ == 'n') {
            calls.push(data[index]);
        } else {
            redisClient.lrem(helper.reconcile_data_node, 1, main_data, function(error, reply) {});
        }
    }
    var function_element = function(data, callback) {
        main_data = [];
        main_data.push(data);
        console.log('##############################');
        console.log('main_data', main_data);
        console.log('##############################');
        // process.exit();
        request({
            url: save_reconcile_data_url,
            method: "POST",
            json: { "reconcile_items": main_data }
        }, function(error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(save_reconcile_data_url, error, ""));
                console.log('##############################');
                console.log('error', error);
                console.log('##############################');
                console.log('************************************************');
                console.log('maindata', maindata);
                console.log('************************************************');
                // process.exit();
                main_data.is_set_on_HQ = 'y';
                redisClient.lset(helper.reconcile_data_node, 1, JSON.stringify(main_data), function(error, reply) {
                    //hold on check
                    //process.exit();
                })
                return;
                // res.status(500).send('{}: {} {}'.format(save_reconcile_data_url, error, ""));
                //return;
                //hold on check
            } else {
                console.log(body);
                callback(null, "success");
                main_data.is_set_on_HQ = 'y';
                redisClient.lset(helper.reconcile_data_node, 1, JSON.stringify(main_data), function(error, reply) {
                    //hold on check
                    // process.exit();
                });
            }
        });
    }
    callallfunctionsinloop(calls, function_element);
    return;
    //need to remove the data from the reddis from offline po node
    //will do in next phase

    //code to reset data to redis with is set on hq=y or remove the data and set to redis




}



//call all functions end
module.exports = sendingOfflinedetails;