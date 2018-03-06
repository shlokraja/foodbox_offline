var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var request = require('request');
var helper = require('../routes/helper');
var async = require('async');
var internetAvailable = require("internet-available"); /* peerbits, rajesh end*/
var offline_incomming_po = require('../misc/offline_incomming_po');
var _ = require('underscore');
format.extend(String.prototype);
/* peerbits, rajesh*/
var redis = require('redis');
// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });


redisClient.on('error', function(msg) {
    console.error(msg);
});
/* peerbits, rajesh end*/

// get all outstanding POs in the last 15mins
// get the dict of rest_id, po_id and batch_id from the HQ
// pass that along to the browser
// when the user click, store that item against the rest_id as the key in the outlet
/*
2. during unscanned items, show the list of item ids from what was selected for the incoming po button and is stored in redis
 let the user select what item id was unscanned and put the quantity

then get the barcodes from that po_id and batch_id

the query shall group by po-id, batch-id, rest-id and sum the items and qty
*/

function checkIncomingPO() {
    var outlet_host = process.env.OUTLET_HOST;
    var port = process.env.PORT;
    var outlet_url = outlet_host + port;

    var outlet_id = process.env.OUTLET_ID;
    var hq_url = process.env.HQ_URL;
    var GET_PO_URL = '/outlet/get_outstanding_po/';
    var GET_MENU_PLANS = '/outlet/menu_plans/';
    console.log('************************************************');
    console.log('in inccoming pos details');
    console.log('************************************************');

    internetAvailable({
            timeout: 1000,
            retries: 3,
        })
        .then(function() {
            async.waterfall([
                    function(callback) {
                        //get the reconsilde data from the Hq if present
                        redisClient.lrange(helper.reconcile_data_node, 0, -1, function(err, reply) {
                            if (err) {
                                callback(err, null);
                            }
                            callback(null, reply);
                        });
                    },
                    function(reconcile_data, callback) {
                        //send reconsile data to HQ 
                        if (reconcile_data != null) {
                            send_reconcile_data_to_HQ(reconcile_data, function(error, reply) {
                                // process.exit();
                                callback(null, reconcile_data);
                            });
                        } else {
                            callback(null, reconcile_data);
                        }

                    },
                    function(reconcile_data, callback) {
                        redisClient.lrange(helper.reconcile_data_last_load_node, 0, -1, function(error, reply) {
                            callback(error, reply)
                        })
                    },
                    function(lastloaddata, callback) {
                        //send lastloaddata to HQ 
                        if (lastloaddata != null) {
                            send_lastloaddata_to_HQ(lastloaddata, function(error, reply) {
                                // process.exit();
                                callback(null, lastloaddata);
                            });
                        } else {
                            callback(null, lastloaddata);
                        }

                    },
                    function(lastloaddata, callback) {
                        // Getting the response from HQ
                        request(hq_url + GET_MENU_PLANS + outlet_id,
			 { timeout: 30000 },
                            function(error, response, body) {
                                if (error || (response && response.statusCode != 200)) {
                                    console.error('{}: {} {}'.format(hq_url, error, body));
                                    callback(error, null);
                                    return;
                                }
                                redisClient.set(helper.menu_bands_node, body, function(error, reply) {
                                    callback(error, body);
                                });
                            });
                    },
                    function(data, callback) {
                        // Getting the response from HQ
                        request(hq_url + GET_PO_URL + outlet_id, { timeout: 10000 },
                            function(error, response, body) {
                                if (error || (response && response.statusCode != 200)) {
                                    console.error('{}: {} {}'.format(hq_url, error, body));
                                    callback(error, null);
                                    return;
                                }
                                console.log('************************************************');
                                //console.log('body', body);
                                console.log('************************************************');
                                var result_pos = _.groupBy(JSON.parse(body), "po_id");
                                callback(null, result_pos);
                            });
                    },
                    function(result_pos, callback) { // stetting the po details in local redis 
                        request({
                                url: outlet_url + '/outlet_app/store_po_details_in_redis',
                                method: "POST",
                                json: { "po_details": result_pos }
                            },
                            function(error, response, data) {

                                if (error || (response && response.statusCode != 200)) {
                                    console.error("store_po_details_in_redis failed: " + error);
                                    return;
                                }
                                console.log('************************************************');
                                console.log('data', data);
                                console.log('************************************************');

                                callback(null, result_pos);
                            });
                    },
                    function(result_pos, callback) { // getting the offline po key if not set then creating it 
                        redisClient.exists(helper.offline_po_request_node, function(err, reply) {
                            if (reply === 1) {
                                console.log('exists offline po existsts');
                                callback(null, result_pos);
                                return;
                            } else {
                                console.log(' offline po doesn\'t exist');
                                redisClient.set(helper.offline_po_request_node,
                                    JSON.stringify(result_pos),
                                    function(store_po_details_err, store_po_details_reply) {
                                        if (store_po_details_err) {
                                            console.error('error while inserting in redis- {}'.format(store_po_details_err));
                                        }
                                        callback(null, result_pos);
                                        return;
                                    });
                            }
                        });
                    },
                    function(result_pos, callback) { //getting the offline details and appending the key which does not have it
                        redisClient.get(helper.offline_po_request_node, function(err, offline_po_details) {
                            data = JSON.parse(offline_po_details);
                            if (data == null) {
                                //for storing data of latest merge
                                redisClient.set(helper.offline_po_request_node,
                                    JSON.stringify(result_pos),
                                    function(store_po_details_err, store_po_details_reply) {
                                        if (store_po_details_err) {
                                            console.error('error while inserting in redis- {}'.format(store_po_details_err));
                                        }
                                        callback(null, result_pos);
                                    });
                                /*end merging */
                            } else {
                                for (var key in data) {
                                    if (data.hasOwnProperty(key)) {
                                        for (var itemcount = 0; itemcount < data[key].length; itemcount++) {
                                            if (typeof(data[key][itemcount].is_offline_reconcile_done) != 'undefined' && data[key][itemcount].is_offline_reconcile_done == 'y') {
                                                data[key][itemcount].is_offline_reconcile_done = "y";
                                            } else {
                                                data[key][itemcount].is_offline_reconcile_done = "n";
                                            }
                                            if (typeof(data[key][itemcount].is_set_on_HQ) != 'undefined' && data[key][itemcount].is_set_on_HQ == 'y') {
                                                data[key][itemcount].is_set_on_HQ = "y";
                                            } else {
                                                data[key][itemcount].is_set_on_HQ = "n";
                                            }
                                            if (typeof data[key][itemcount].is_generated_from_scan == "undefined") {
                                                data[key][itemcount].is_generated_from_scan = false;
                                            }
                                        }
                                    }
                                }
                                /* merge the live data*/
                                for (var key2 in result_pos) {
                                    if (result_pos.hasOwnProperty(key2)) {
                                        // check if id is present in the local data
                                        if (typeof data[key2] != "undefined" && data[key2].length > 0) {
                                            //do what ever you wnat to do
                                        } else {
                                            data[key2] = result_pos[key2];
                                        }
                                    }
                                }
                                console.log('************************************************');
                                console.log('data', data);
                                console.log('************************************************');
                                //for storing data of latest merge
                                redisClient.set(helper.offline_po_request_node,
                                    JSON.stringify(data),
                                    function(store_po_details_err, store_po_details_reply) {
                                        if (store_po_details_err) {
                                            console.error('error while inserting in redis- {}'.format(store_po_details_err));
                                            console.error('rajesh there is eeror in inbiult funcion');
                                        }
                                        callback(null, result_pos);
                                    });
                                /*end merging */
                            }

                        })
                    },
                    function(result_pos, callback) { //deleting the details not present on HQ
                        if (result_pos!=null){
                            redisClient.get(helper.offline_po_request_node, function (err, reply) {
                                if (reply != null) {
                                    data = JSON.parse(reply);
                                    console.log('************************************************');
                                    console.log('typeof data', typeof data);
                                    console.log('************************************************');

                                    for (var key in data) {
                                        if ((data.hasOwnProperty(key) && result_pos.hasOwnProperty(key)) || (typeof data[key][0].is_generated_from_scan != "undefined" && data[key][0].is_generated_from_scan == true)) {

                                        } else {
                                            delete data[key];
                                        }
                                    }
                                    redisClient.set(helper.offline_po_request_node, JSON.stringify(data), function (error, reply) {
                                        callback(null, data);
                                    });
                                }

                            });
                        }else{
                            callback(null, data);
                        }
                       
                    }

                ],
                function(error, reply) {
                    if (error) {
                        console.log('************************************************');
                        console.log('error in incomming po', error);
                        console.log('************************************************');
                        offline_incomming_po();
                        return;
                    } else {

                        offline_incomming_po();

                    }
                })
        })
        .catch(function(err) {
            offline_incomming_po();
        });
}

function send_reconcile_data_to_HQ(reconcile_data, callback) {
    var hq_url = process.env.HQ_URL;
    var save_reconcile_data_url = hq_url + '/outlet/save_reconcile_data/';
    var outlet_id = process.env.OUTLET_ID;
    calls = [];
    maindataloop = [];
    for (var index = 0; index < reconcile_data.length; index++) {
        po_main_data = JSON.parse(reconcile_data[index]);
        if (typeof po_main_data[0] != "undefined" && (po_main_data[0].is_set_on_HQ == 'n' || po_main_data[0].is_set_on_HQ == false)) {
            calls.push(po_main_data);
            maindataloop.push(po_main_data);
        } else {

        }
    }

    var function_element = function(datatosend, callback) {
        console.log('************************************************');
        console.log('datatosend', datatosend);
        console.log('************************************************');
        request({
            url: save_reconcile_data_url,
            method: "POST",
            json: { "reconcile_items": datatosend }
        }, function(error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.log('************************************************');
                console.log('error', error);
                console.log('************************************************');
                callback(error, null);
                return;
            }
            console.log('************************************************');
            console.log('response from HQ callback sending last lod info', body);
            console.log('************************************************');

            callback(null, body);
            return;
        });

    };
    console.log('************************************************');
    console.log('calls.length', calls.length);
    console.log('************************************************');

    if (calls.length > 0) {
        callallfunctionsinloop(calls, function_element, function(error, reply) {
            console.log('************************************************');
            console.log('maindataloop', maindataloop);
            console.log('************************************************');
            for (var index = 0; index < maindataloop.length; index++) {
                element = maindataloop[index];
                for (var index2 = 0; index2 < element.length; index2++) {
                    var element2 = element[index2];
                    element[index2].is_set_on_HQ = "y";
                }
                if(typeof element == "object"){
                    redisClient.lset(helper.reconcile_data_node, index, JSON.stringify(element),
                        function (set_err, set_reply) {
                            console.log('************************************************');
                            console.log('index element', index, element);
                            console.log('************************************************');
                        });
                }
            }
            callback(error, reply);
        });
    } else {
        callback(null, "success");
    }

}


function send_lastloaddata_to_HQ(lastloaddata, callback) {
    // update HQ that this batch has been received
    var hq_url = process.env.HQ_URL;
    var UPDATE_RECEIVED_TIME_URL = hq_url + '/outlet/update_received_time/' + process.env.OUTLET_ID;
    var outlet_id = process.env.OUTLET_ID;
    calls = [];
    maindataloop = [];
    if (lastloaddata.length > 0) {
        for (var index = 0; index < lastloaddata.length; index++) {
            last_load_maindaata = JSON.parse(lastloaddata[index]);
            //if (po_main_data[0].is_set_on_HQ == 'n' || po_main_data[0].is_set_on_HQ == false) {
            calls.push(last_load_maindaata);
            maindataloop.push(last_load_maindaata);
            ///} else {
            //}
        }
    }

    console.log('************************************************');
    console.log('calls from last load info', calls.length);
    console.log('************************************************');

    var function_element = function(datatosend, callback) {
        console.log('************************************************');
        console.log('datatosend from last load info', datatosend);
        console.log('************************************************');
        request({
            url: UPDATE_RECEIVED_TIME_URL,
            method: "POST",
            json: datatosend
        }, function(error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.log('************************************************');
                console.log('error', error);
                console.log('************************************************');
                callback(error, null);
                return;
            }
            console.log('************************************************');
            console.log('response from data from last load info', body);
            console.log('************************************************');
            redisClient.lrem(helper.reconcile_data_last_load_node, 0, JSON.stringify(datatosend), function(errr, reply) {
                if (error) {
                    console.log('************************************************');
                    console.log('error', error);
                    console.log('************************************************');
                    callback(error, null);
                    return;
                }
                console.log('************************************************');
                console.log('data deleted from incomming po of last load info', body);
                console.log('************************************************');
                callback(null, body);
            })
            return;
        });

    };

    if (calls.length > 0) {
        callallfunctionsinloop(calls, function_element, function(error, reply) {
            callback(error, reply);
        });
    } else {
        callback(null, "success");
    }

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

module.exports = checkIncomingPO;