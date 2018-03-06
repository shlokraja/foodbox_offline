var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var request = require('request');
var helper = require('../routes/helper');
var async = require('async');
var internetAvailable = require("internet-available"); /* peerbits, rajesh end*/
var _ = require('underscore');
format.extend(String.prototype);
/* peerbits, rajesh*/
var redis = require('redis');
// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });


redisClient.on('error', function(msg) {
    console.error(msg);
});


function offline_incomming_po() {

    /*now for the offline things i get the data from the redis and emit RESULT as above function */
    redisClient.get(helper.offline_po_request_node, function(err, reply) {
        if (err) {
            console.error(err);
            //NEED TO CHECK THAT WE GOT ERROR OR NOT
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;

        }
        data = JSON.parse(reply);

        var maindata = [];
        var index = 0;
        for (var key in data) {
            if (data.hasOwnProperty(key)) {
                for (var itemcount = 0; itemcount < data[key].length; itemcount++) {
                    var scheduled_date_time = new Date(data[key][itemcount]["scheduled_time"]);
                    var currentdatetime = new Date();
                    var endtime = new Date(currentdatetime);
                    var midnight = new Date(currentdatetime);
                    midnight.setHours(0, 0, 0, 0);
                    endtime.setHours(currentdatetime.getHours() + 2);
                    if ((scheduled_date_time.getTime() > midnight.getTime() && scheduled_date_time.getTime() < endtime.getTime()) || data[key][itemcount].is_offline_reconcile_done == 'n') {
                        if (typeof(data[key][itemcount].is_offline_reconcile_done) != 'undefined' && data[key][itemcount].is_offline_reconcile_done == 'n') {
                            maindata[index] = data[key][itemcount];
                            index++;
                        }
                        if (typeof(data[key][itemcount].is_offline_reconcile_done) == 'undefined') {
                            maindata[index] = data[key][itemcount];
                            index++;
                        }
                    }
                }
            }
        }
        
        io.emit('incoming_po', maindata);
    });

}

module.exports = offline_incomming_po;