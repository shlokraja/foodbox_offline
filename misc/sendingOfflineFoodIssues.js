var internetAvailable = require("internet-available");
var redis = require("redis");
var format = require("string-format");
var helper = require('../routes/helper');
var moment = require('moment');
var async = require('async');
var request = require('request');
var requestretry = require('requestretry');
var requestpromise = require('request-promise');
var NonFoodIssue = require("../models/non_food_issues");
var FoodIssue = require("../models/food_issues");
var format = require('string-format');
//Import the mongoose module
var mongoose = require('mongoose');
format.extend(String.prototype);

function sendingOfflineFoodIssues() {
    console.log('##############################');
    console.log('sendingofflinefoodissues');
    console.log('##############################');
    internetAvailable({
            timeout: 1000,
            retries: 3,
        })
        .then(function() {
            async.parallel({
                non_food_item_issues: function(callback) {
                    obj = { is_set_on_HQ: false };
                    console.log('##############################');
                    console.log('search non_food_item_issues', obj);
                    console.log('##############################');
                    NonFoodIssue.find(obj, function(err, issues) {
                        if (err) {
                            console.log("error", err);
                        }
                        callback(null, issues);
                    });
                },
                food_item_issues: function(callback) {
                    obj = { is_set_on_HQ: false };
                    console.log('##############################');
                    console.log('obj', obj);
                    console.log('##############################');
                    FoodIssue.find(obj, function(err, issues) {
                        if (err) {
                            console.log("error", err);
                        }
                        callback(null, issues);
                    });
                }
            }, function(err, results) {
                if (typeof results.non_food_item_issues != "undefined" && results.non_food_item_issues.length > 0) {
                    var hq_url = process.env.HQ_URL;
                    var UPDATE_ITEM_ISSUES_URL = '/outlet/update_item_issues/';
                    var outlet_id = process.env.OUTLET_ID;
                    var barcode_details = [];
                    results.non_food_item_issues.forEach(function(element) {
                        var non_food_issue = {};
                        non_food_issue.time = element.time;
                        non_food_issue.type = element.type;
                        non_food_issue.note = element.note;
                        non_food_issue.reporter = element.reporter;
                        requestretry({
                                url: hq_url + UPDATE_ITEM_ISSUES_URL + outlet_id,
                                method: "POST",
                                forever: true,
                                json: { "barcode_details": barcode_details, "non_food_issue": non_food_issue }
                            },
                            function(error, response, body) {
                                if (error || (response && response.statusCode != 200)) {
                                    console.error('{}: {} {}'.format(hq_url, error, body));
                                    res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                                    return;
                                }
                                console.log('************************************************');
                                console.log('body', body);
                                console.log('************************************************');
                                update_object = { "is_set_on_HQ": true };
                                update_object = Object.assign(update_object, NonFoodIssue._doc);
                                console.log('************************************************');
                                console.log('obje', obj);
                                console.log('************************************************');
                                options = { multi: true };
                                NonFoodIssue.update(obj, update_object, options, function(error, reply) {
                                    if (error) {
                                        console.log('##############################');
                                        console.log('error', error);
                                        console.log('##############################');
                                    }
                                    console.log('##############################');
                                    console.log('reply', reply);
                                    console.log('##############################');
                                });
                                //NonFoodIssue.find(obj).remove().exec();

                            });
                    }, this);
                }
                // process.exit();
                console.log('##############################');
                console.log('food_item_issues', results.food_item_issues);
                console.log('##############################');

                if (typeof results.food_item_issues != "undefined" && results.food_item_issues.length > 0) {
                    calls = [];
                    non_food_issue = {};
                    var barcode_details = [];
                    results.food_item_issues.forEach(function(element) {
                        barcode_details.push(element);
                    }, this);

                    sendFoodIssueTOHQ(barcode_details, non_food_issue);
                }
            });
        })
        .catch(function(err) {
            console.log('##############################');
            console.log('return internet is not present');
            console.log('##############################');
            return;
        });

}



sendFoodIssueTOHQ = function(barcode_details, non_food_issue) {
    var hq_url = process.env.HQ_URL;
    var UPDATE_ITEM_ISSUES_URL = '/outlet/update_item_issues/';
    var outlet_id = process.env.OUTLET_ID;
    console.log('************************************************');
    console.log('{ "barcode_details": barcode_details, "non_food_issue": non_food_issue }', { "barcode_details": barcode_details, "non_food_issue": non_food_issue });
    console.log('************************************************');
    requestretry({
            url: hq_url + UPDATE_ITEM_ISSUES_URL + outlet_id,
            method: "POST",
            forever: true,
            json: { "barcode_details": barcode_details, "non_food_issue": non_food_issue }
        },
        function(error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                console.log('##############################');
                console.log('error', error);
                console.log('##############################');
                // res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                // return;
            }
            console.log('##############################');
            console.log('body', body);
            console.log('##############################');
            var ObjectId = require('mongoose').Types.ObjectId;
            obj = { "_id": new ObjectId(barcode_details._id) };
            console.log('##############################');
            console.log('obj', obj);
            console.log('##############################');
            update_object = { "is_set_on_HQ": true };
            console.log('##############################');
            console.log('update_object', update_object);
            console.log('##############################');
            options = { multi: true };

            FoodIssue.update({}, update_object, options, function(error, reply) {
                if (error) {
                    console.log('##############################');
                    console.log('error', error);
                    console.log('##############################');
                }

                console.log('##############################');
                console.log('foode issues reply', reply);
                console.log('##############################');

            });
            // process.exit();
            //FoodIssue.find(obj).remove().exec();
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
    });
}

module.exports = sendingOfflineFoodIssues;