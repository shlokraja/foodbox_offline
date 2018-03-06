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

var flag = true;

function callAllOfflineFunction() {
    console.log('##############################');
    console.log('in callAllOfflineFunction');
    console.log('##############################');
    internetAvailable({
            timeout: 1000,
            retries: 3,
        })
        .then(function() {
            if (flag) {
                console.log('##############################');
                console.log('in if of callAllOfflineFunction type of', typeof storeFoodItems);
                console.log('##############################');

                flag = false;
                async.parallel([
                    //storeFoodItems,
                    sendingOfflinedetails,
                    getStaffroasterdetails,
                    sendingOfflineFoodIssues,
                    sendStoredBillToHQ

                ], function(params) {
                    flag = true;
                });
            }
        })
        .catch(function(err) {
            console.log('##############################');
            console.log('internt is not availble or other funcitons cannot be called');
            console.log('##############################');
        });

}
//call all functions end
module.exports = callAllOfflineFunction;