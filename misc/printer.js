var request = require('requestretry');
var fs = require('fs');
var debug = require('debug')('outlet_app:server');
var cheerio = require('cheerio');
var path = require('path');
var redis = require('redis');
var format = require('string-format');
var toFixed = require('tofixed');
var helper = require('../routes/helper');
var outlet_id = process.env.OUTLET_ID;

format.extend(String.prototype);
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function(msg) {
    console.error(msg);
});

function startPrint(bill_dict, bill_no, date, time, savings, mobile_num, outlet_phone_no) {
    var outlet_id = process.env.OUTLET_ID;
    // Opening the html file
    console.log("startPrint-----------------", bill_dict);
    var filePath = path.join(__dirname, '/../');
    filePath = path.join(filePath, 'public/bill.html');
    var bill_text = '';
    var bill_total_amount = 0;
    for (restaurant_id in bill_dict) {
        var bill_item = bill_dict[restaurant_id];
        var html = fs.readFileSync(filePath, 'utf8');
        var $ = cheerio.load(html);
        // Updating the contents
        $("#date_time #date").text(' Date : ' + date);
        $("#date_time #time").text('-' + time);
        console.log('***************************************');
        console.log('here1');
        console.log('***************************************');

        $("#order_no").text(bill_no.toString());
        console.log('***************************************');
        console.log('here2');
        console.log('***************************************');

        $("#tin_no").text('GSTIN No: ' + bill_item[0]["tin_no"]);
        $("#rest_name").text(bill_item[0]["entity"]);
        $("#res_name").text('Name: ' + bill_item[0]["entity"]);
        
	$("#address").text(bill_item[0]["address"]);
        console.log('***************************************');
        console.log('here3');
        console.log('***************************************');

        $(".running_no").attr("outlet_id", outlet_id);
	$("#outlet_id").text(outlet_id.toString());
        console.log('***************************************');
        console.log('here3');
        console.log('***************************************');


        $(".running_no").attr("restaurant_id", restaurant_id);
	$("#restaurant_id").text(bill_item[0]["restaurant_id"].toString());
        console.log('***************************************');
        console.log('here4');
        console.log('***************************************');


        $("#address").text(bill_item[0]["address"].toString());
        console.log('***************************************');
        console.log('here5');
        console.log('***************************************');



        var quantity = 0;
        var gst_percent = 0;
        var selling_amt = 0;
      var sgst_percent = bill_item[0]["sgst_percent"]==undefined?0:bill_item[0]["sgst_percent"];
      var cgst_percent = bill_item[0]["cgst_percent"]==undefined?0:bill_item[0]["cgst_percent"];
      var total_amount=0;
        var total_gst_percent = sgst_percent + cgst_percent;
        var amount_val = 0;
        var round_off = 0;
        var mrp_per_item = 0;
        var rate_per_item = 0;
        for (var i = 0; i < bill_item.length; i++) {
            if (!bill_item[i]["side_order"]) {
                bill_item[i]["side_order"] = "";
            }
            quantity = bill_item[i]["count"];
            mrp_per_item = bill_item[i]["amount"] / quantity;
            gst_percent = bill_item[0]["sgst_percent"] + bill_item[0]["cgst_percent"] + 100;
            rate_per_item = (mrp_per_item * 100) / gst_percent;
            selling_amt = quantity * rate_per_item;
        $("#items tbody").prepend("<tr><td>"+(bill_item.length-i)+"</td><td>"+bill_item[i]["name"]+"<div class='side_order'>"+bill_item[i]["side_order"]+"</div></td>   <td>996334</td><td>"+ quantity +"</td><td>" + toFixed(rate_per_item,2) +" </td><td>"+total_gst_percent+"%</td><td>"+ toFixed(rate_per_item * quantity,2) +"</td></tr>");
            amount_val += selling_amt;
            round_off += toFixed(rate_per_item, 0) * quantity;
        total_amount += bill_item[i]["amount"];
        }
        $("#amount_val").text('' + toFixed(amount_val, 2));
        var gs = toFixed((amount_val * sgst_percent / 100), 2);
        var gc = toFixed((amount_val * cgst_percent / 100), 2);
      var roundoff_bill = toFixed(total_amount,2);
        $("#amount_cgst").text('' + gs);
        $("#amount_sgst").text('' + gc);
        console.log('***************************************');
        console.log('here6');
        console.log('***************************************');


        if (typeof cgst_percent != "undefined") {
            $("#cgstvalue").text(cgst_percent.toString() + "%");
        }
        console.log('***************************************');
        console.log('here7');
        console.log('***************************************');


        if (typeof sgst_percent != "undefined") {
            $("#sgstvalue").text(sgst_percent.toString() + "%");
        }
        console.log('***************************************');
        console.log('here7');
        console.log('***************************************');

        if (typeof roundoff_bill != "undefined") {
            $("#amount_num").text(roundoff_bill.toString());
        }
	bill_total_amount+= total_amount;
        console.log('***************************************');
        console.log('here8');
        console.log('***************************************');


        // Showing the savings if any
        if (savings != 0) {
            $("#savings").text("You have saved INR " + savings);
        } else { // else do not show
            $("#savings").css("display", "none");
        }

        bill_text += $.html() + '<br /><br />'
    }
    bill_total_amount=bill_total_amount.toFixed(0);
    var hq_url = process.env.HQ_URL;
    var CREATE_BILL_URL = hq_url + '/bill';
    console.log('***************************************');
    console.log('posting bill to HQ ', CREATE_BILL_URL);
    console.log('***************************************');

    // Posting the bill body to the HQ to create the pdf
    request({
        url: CREATE_BILL_URL,
        method: "POST",
        json: { "bill_text": bill_text }
    }, function(error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.log('************************************************');
            console.log('response.statusCode ====== from printer', error, body);
            console.log('************************************************');
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
        console.log('************************************************');
        //console.log('body');
        console.log('************************************************');

        var bill_location = body.bill_location;
        // send the SMS
        sendSMS(mobile_num, bill_no, bill_total_amount, bill_location, outlet_phone_no);
    });
}

function sendSMS(mobile_num, bill_no, amount, bill_location, outlet_phone_no) {
    // Send the bill sms
    debug("Mobile num for place order is " + mobile_num);
    // Getting the outlet config first
    redisClient.get(helper.outlet_config_node, function(err, reply) {
        if (err) {
            console.error('error while retreiving from redis- {}'.format(err));
            return;
        }
        var outlet_config = JSON.parse(reply);
        var outlet_name = outlet_config.name;

        var sms_details = {
            'bill_no': bill_no,
            'amount': amount,
            'outlet_name': outlet_name,
            'hq_url': process.env.HQ_URL,
            'bill_url': bill_location,
            'outlet_phone_no': outlet_phone_no
        }
        var sms_message = 'Thanks for Order #{bill_no} \nRs. {amount} at {outlet_name} \nView your bill at {hq_url}{bill_url} \nCall us at {outlet_phone_no} \nEnjoy your meal!'.format(sms_details);
        var queryString = {
            UserName: process.env.SMS_USERNAME,
            password: process.env.SMS_PASSWORD,
            MobileNo: mobile_num,
            SenderID: 'FRSHLY',
            CDMAHeader: 'FRSHLY',
            Message: sms_message
        };
        request({
            url: process.env.SMS_URL,
            qs: queryString
        }, function(sms_error, sms_response, sms_body) {
            if (sms_error || (sms_response && sms_response.statusCode != 200)) {
                console.error('{}: {} {}'.format(process.env.HQ_URL, sms_error, sms_body));
                return;
            }
            debug(sms_body);
        });
    });
}

function sendUpdatedSMS(item_name, bill_no, mobile_num) {
    var sms_details = {
        'bill_no': bill_no,
        'item_name': item_name
    };
    var sms_message = 'Item- {item_name} has been cancelled from order #{bill_no}\nPlease contact outlet staff.'.format(sms_details);
    debug("Resending updated sms as - ", sms_message);
    var queryString = {
        UserName: process.env.SMS_USERNAME,
        password: process.env.SMS_PASSWORD,
        MobileNo: mobile_num,
        SenderID: 'FRSHLY',
        CDMAHeader: 'FRSHLY',
        Message: sms_message
    };
    request({
        url: process.env.SMS_URL,
        qs: queryString
    }, function(sms_error, sms_response, sms_body) {
        if (sms_error || (sms_response && sms_response.statusCode != 200)) {
            console.error('{}: {} {}'.format(process.env.HQ_URL, sms_error, sms_body));
            return;
        }
        debug(sms_body);
    });
}


module.exports = { startPrint: startPrint, sendUpdatedSMS: sendUpdatedSMS };