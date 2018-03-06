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
var helper = require('../routes/helper');


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
format.extend(String.prototype);
// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });


redisClient.on('error', function(msg) {
    console.error(msg);
});


function savepettycashdata() {
    internetAvailable({
            timeout: 100,
            retries: 3,
        })
        .then(function() {
            console.log('************************************************');
            console.log('here', 1);
            console.log('************************************************');
            var hq_url = process.env.HQ_URL;
            var PETTY_CASH_URL = '/outlet/petty_cash_breakdown/' + process.env.OUTLET_ID;

            requestretry({
                    url: hq_url + PETTY_CASH_URL,
                    maxAttempts: 2,
                },
                function(error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                        return;
                    }
                    getPettyCashOfflinedata(body, true, function(err, reply) {});
                });
        })
        .catch(function(error) {
            console.log('************************************************');
            console.log('error', error);
            console.log('************************************************');

            console.log('##############################');
            console.log('in petty cash catch time internet not available', new Date());
            console.log('##############################');
        });
}


function getPettyCashOfflinedata(body, online, callback) {

    async.parallel({
        now_data_to_show: function(callback2) {
            if (typeof body != "undefined" && body != "") {
                redisClient.set(helper.petty_cash_node, body, function(err, reply) {
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
        offline_data_to_show: function(callback4) {
            redisClient.get(helper.petty_cash_node, function(err, reply) {
                if (err) {
                    console.log('##############################');
                    console.log('petty cash err', err);
                    console.log('##############################');
                    callback4(err, null);
                }
                callback4(null, reply);
            });
        },
        offline_data_stored_to_show: function(callback3) {
            redisClient.lrange(helper.petty_cash_to_HQ_node, 0, -1, function(err, reply) {
                if (err) {
                    console.log('##############################');
                    console.log('petty cash err', err);
                    console.log('##############################');
                }
                callback3(null, reply);
            });
        },

    }, function(err, results) {

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

module.exports = savepettycashdata;