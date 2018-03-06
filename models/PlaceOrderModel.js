//Import the mongoose module
var mongoose = require('mongoose');
require('mongoose-long')(mongoose);

//Define a schema
var Schema = mongoose.Schema;
var SchemaTypes = mongoose.Schema.Types;

var PlaceOrderModelSchema = new Schema({
        name:String,
        order_details:Object,
        sides:Object,
        counter_code:String,
        payment_mode:String,
        outlet_id:Number,
        order_barcodes:String,
        mobile_num:String,
        credit_card_no:String,
        cardholder_name:String,
        bill_no:Number,
        food_details:Object,
        unique_Random_Id:String,
        is_mobile_order:Boolean,
        bill_time:String,
        bill_status:String,
        is_send_to_HQ:Boolean,
        current_time:String,
        userid:String,
        outlet_order_id: SchemaTypes.Long
        
});


// Compile model from schema
PlaceOrderModel = mongoose.model('place_order_details', PlaceOrderModelSchema);



// make this available to our users in our Node applications
module.exports = PlaceOrderModel;