//Import the mongoose module
var mongoose = require('mongoose');

//Define a schema
var Schema = mongoose.Schema;



var CashDetailModelSchema = new Schema({
    outlet_id: Number,
    month_total: Number,
    day_total: Number,
    month_cash_amount: Number,
    month_card_amount: Number,
    month_sodexocard_amount: Number,
    month_sodexocoupon_amount: Number,
    month_credit_amount: Number,
    month_gprscard_amount: Number,
    month_wallet_amount: Number,
    day_cash_amount: Number,
    day_card_amount: Number,
    day_sodexocard_amount: Number,
    day_sodexocoupon_amount: Number,
    day_credit_amount: Number,
    day_gprscard_amount: Number,
    day_wallet_amount: Number,
    dispenser_month_count: String,
    outside_month_count: String,
    dispenser_month_amount: Number,
    outside_month_amount: Number,
    dispenser_day_count: String,
    outside_day_count: String,
    dispenser_day_amount: Number,
    outside_day_amount: Number,
    is_set_on_HQ: Boolean,
    time: String
});


// Compile model from schema
CashDetailModel = mongoose.model('cash_detail', CashDetailModelSchema);



// make this available to our users in our Node applications
module.exports = CashDetailModel;