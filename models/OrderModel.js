//Import the mongoose module
var mongoose = require('mongoose');
require('mongoose-long')(mongoose);
//Define a schema
var Schema = mongoose.Schema;
var SchemaTypes = mongoose.Schema.Types;



var OrderModelSchema = new Schema({
    id: Number,
    time: String,
    method: String,
    amount_due: Number,
    dispense_status: String,
    bill_nos: Array,
    mobile_num: String,
    is_set_on_HQ: Boolean,
    order_barcodes: String,
    userid:String,
    outlet_order_id: SchemaTypes.Long
});


// Compile model from schema
OrderModel = mongoose.model('order_details', OrderModelSchema);



// make this available to our users in our Node applications
module.exports = OrderModel;