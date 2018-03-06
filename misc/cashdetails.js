//this file is responsible for cash related canges

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
var helper = require('../routes/helper');
var startPrint = require('../misc/printer').startPrint;
var sendUpdatedSMS = require('../misc/printer').sendUpdatedSMS;
var isForcePrintBill = require('../misc/isForcePrintBill');
var internetAvailable = require("internet-available");
var PlaceOrderModel = require("../models/PlaceOrderModel");
var OrderModel = require("../models/OrderModel");
var OrderItemModel = require("../models/OrderItemModel");
var CashDetailModel = require("../models/CashDetailModel");


function saveRefundDataOnCashDetailsLocal(ammount_deduct, food_count, method) {
    async.parallel({
        old_cash_details: function(callback) {
            var fields = {
                __v: false,
                _id: false,
                is_set_on_HQ: false,
            };
            CashDetailModel.findOne({ 'outlet_id': process.env.OUTLET_ID }, fields, function(error, cashdetials) {
                callback(error, cashdetials);
            });
        }
    }, function(err, results) {

        old_cash_details = results.old_cash_details;
        method = method.toLowerCase().split(/\s+/).join('');
        old_cash_details.dispenser_day_count = (old_cash_details.dispenser_day_count == null) ? 0 : old_cash_details.dispenser_day_count;
        old_cash_details.dispenser_month_count = (old_cash_details.dispenser_month_count == null) ? 0 : old_cash_details.dispenser_month_count;
        old_cash_details.dispenser_day_count = (parseInt(old_cash_details.dispenser_day_count) - food_count).toString();
        old_cash_details.dispenser_month_count = (parseInt(old_cash_details.dispenser_month_count) - food_count).toString();

        old_cash_details["day_" + method + "_amount"] -= ammount_deduct;
        old_cash_details["month_" + method + "_amount"] -= ammount_deduct;
        old_cash_details.day_total -= ammount_deduct;
        old_cash_details.month_total -= ammount_deduct;
        options = { multi: true };
        CashDetailModel.update({ 'outlet_id': parseInt(process.env.OUTLET_ID) }, old_cash_details, options, function(error, reply) {
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

function saveReplaceDataOnCashDetailsLocal(replace_data, order_details, order_item_details, data_replace_item_details, callback) {
    async.parallel({
        old_cash_details: function(callback2) {
            var fields = {
                __v: false,
                _id: false,
                is_set_on_HQ: false,
            };
            CashDetailModel.findOne({ 'outlet_id': process.env.OUTLET_ID }, fields, function(error, cashdetials) {
                callback2(error, cashdetials);
            });
        }
    }, function(err, results) {
        method = order_details[0].method;
        method = method.toLowerCase().split(/\s+/).join('');
        var count_replace = 0;

        console.log('************************************************');
        console.log('replace_data', replace_data);
        console.log('************************************************');

        for (var key in replace_data.item_details) {
            console.log('************************************************');
            console.log('replace_data', replace_data.item_details);
            console.log('************************************************');
            if (replace_data.item_details.hasOwnProperty(key)) {
                count_replace = replace_data.item_details[key];
            }
        }
        console.log('************************************************');
        console.log('replace_data', replace_data);
        console.log('************************************************');
        var count_add;
        for (var key2 in data_replace_item_details) {
            if (data_replace_item_details.hasOwnProperty(key2)) {
                count_add = data_replace_item_details[key2].count;
            }
        }

        var food_count_dedcuct = count_replace;
        var food_count_add = count_add;
        var ammount_add = replace_data.replaced_amount;
        var ammount_deduct = replace_data.amount;
        old_cash_details = results.old_cash_details;
        old_cash_details.dispenser_day_count = (old_cash_details.dispenser_day_count == null) ? 0 : old_cash_details.dispenser_day_count;
        old_cash_details.dispenser_month_count = (old_cash_details.dispenser_month_count == null) ? 0 : old_cash_details.dispenser_month_count;
        old_cash_details.dispenser_day_count = ((parseInt(old_cash_details.dispenser_day_count) - food_count_dedcuct) + food_count_add).toString();
        old_cash_details.dispenser_month_count = ((parseInt(old_cash_details.dispenser_month_count) - food_count_dedcuct) + food_count_add).toString();
        old_cash_details["day_" + method + "_amount"] = (old_cash_details["day_" + method + "_amount"] - ammount_deduct) + ammount_add;
        old_cash_details["month_" + method + "_amount"] = (old_cash_details["month_" + method + "_amount"] - ammount_deduct) + ammount_add;;
        old_cash_details.day_total = (old_cash_details.day_total - ammount_deduct) + ammount_add;
        old_cash_details.month_total = (old_cash_details.month_total - ammount_deduct) + ammount_add;;
        options = { multi: true };
        CashDetailModel.update({ 'outlet_id': parseInt(process.env.OUTLET_ID) }, old_cash_details, options, function(error, reply) {
            if (error) {
                console.log('##############################');
                console.log('error', error);
                console.log('##############################');
            }
            console.log('##############################');
            console.log('reply updated ', reply);
            console.log('##############################');
            callback(error, reply)
        });
    });
}

function stardofdaycount() {
    async.parallel({
        old_cash_details: function(callback2) {
            var fields = {
                __v: false,
                _id: false,
                is_set_on_HQ: false,
            };
            CashDetailModel.findOne({ 'outlet_id': process.env.OUTLET_ID }, fields, function(error, cashdetials) {
                callback2(error, cashdetials);
            });
        }
    }, function(err, results) {
        old_cash_details = results.old_cash_details;
        old_cash_details.dispenser_day_count = 0;
        old_cash_details.dispenser_outside_count = 0;
        old_cash_details.outside_day_count = 0;
        methods = ["cash",
            "card",
            "sodexocard",
            "sodexocoupon",
            "credit",
            "gprscard",
            "wallet",
        ];
        methods.map(function(method) {
            old_cash_details["day_" + method + "_amount"] = 0;
        })
        old_cash_details.day_total = 0;
        options = { multi: true };
        CashDetailModel.update({ 'outlet_id': parseInt(process.env.OUTLET_ID) }, old_cash_details, options, function(error, reply) {
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
var cashdetails = {
    saveRefundDataOnCashDetailsLocal: saveRefundDataOnCashDetailsLocal,
    saveReplaceDataOnCashDetailsLocal: saveReplaceDataOnCashDetailsLocal,
    stardofdaycount: stardofdaycount
}

module.exports = cashdetails;