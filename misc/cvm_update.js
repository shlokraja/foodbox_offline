var requestretry = require('requestretry');
var redis = require('redis');
var format = require('string-format');
var request = require('request');
var express = require('express');
// var helper = require('./routes/helper');
var helper = require('../routes/helper');
var async = require('async');
var _ = require('underscore');
var debug = require('debug')('automaticEOD:server');

format.extend(String.prototype);

var food_item_data = {};

setInterval(updateCvmDispensingStatus  , 20000);


var redisClient = redis.createClient({
    connect_timeout: 2000,
    retry_max_delay: 5000
});
redisClient.on("error", function(msg) {
    console.error(msg);
});

var hq_url = process.env.HQ_URL;
var outlet_id = process.env.OUTLET_ID;
var outlet_host = process.env.OUTLET_HOST;
var port = process.env.PORT;
var outlet_url = outlet_host + port;
var pflag = false;


//cron for updating cvm delivery status
function updateCvmDispensingStatus () {

    redisClient.get(helper.plc_config_node, function (err, reply) {
        if (err) {
            callback('error while retreiving from redis- {}'.format(err), null);
            return;
        }
        var num_lanes = JSON.parse(reply);
        // callback(null, plc_config.lane_count);
        // request start
        var CVM_URL = "http://{}:{}/cvm/get_item_details".format(num_lanes.cvm_plc_ip, num_lanes.cvm_plc_port)
        //var CVM_URL = process.env.CVM_URL.format(results.num_lanes.cvm_plc_ip,results.num_lanes.cvm_plc_port)
        request({
            url: CVM_URL,
            method: "GET"
        }, function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            console.log("response++++++++++++++++++++++++");
            console.log(body);
            if (body) {
                var items = JSON.parse(body);
                var updatedItems=[];
                console.log(body);
                if (items) {
                    items.forEach(function (item, index) {
                        if (item.status!="pending" )
                        {
                        console.log(item);
                        var dispense_status_data = {};
                        dispense_status_data[item.bill_no] = item.status;
                        console.log(dispense_status_data);
                        if (item.status=="delivered")
                        {
                        updatedItems.push({"bill_no":item.bill_no,"item_id":item.item_id});
                        }
                        var ref = new Firebase(process.env.FIREBASE_QUEUE);
                        ref.child('tasks').push({
                            "name": "DISPENSE_STATUS_UPDATE",
                            "outlet_id": process.env.OUTLET_ID,
                            "data": dispense_status_data
                        });
                    }
                    
                    });
                }
                var CVM_Update_URL = "http://{}:{}/cvm/update_item_details".format(num_lanes.cvm_plc_ip, num_lanes.cvm_plc_port)
                    request({
                        url: CVM_Update_URL,
                        method: "POST",
                        json:updatedItems

                    }, function (error, response, body) {

                    });
            }

        });
        // request end
    });
}