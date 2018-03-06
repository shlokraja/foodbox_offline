//Import the mongoose module
var mongoose = require('mongoose');

//Define a schema
var Schema = mongoose.Schema;



var FoodItemSchema = new Schema({
    id: Number,
    name: String,
    item_tag: String,
    veg: Boolean,
    location: String,
    side_order: String,
    master_id: Number,
    mrp: Number,
    cgst_percent: Number,
    sgst_percent: Number,
    service_tax_percent: Number,
    vat_percent: Number,
    heating_required: Boolean,
    heating_reduction: Boolean,
    condiment_slot: Number,
    abatement_percent: Number,
    expiry_time: String,
    r_id: Number,
    r_name: String,
    r_short_name:String,
    r_address: String,
    r_tin_no: String,
    r_st_no: String,
    r_pan_no: String,
    r_entity: String,
    r_cgst_percent: Number,
    r_sgst_percent: Number,
    r_sender_email: String,
    discount_percent: Number,
    b_r_id: Number,
    b_r_name: String,
    b_r_cgst_percent: Number,
    b_r_sgst_percent: Number,
    b_r_address: String,
    b_r_tin_no: Number,
    b_id: Number,
    b_name: String,
    b_mrp: Number,
    b_service_tax_percent: Number,
    b_abatement_percent: Number,
    b_vat_percent: Number,
    vending: String,
    subitem_id: String
});


// Compile model from schema
FoodItemModel = mongoose.model('food_items', FoodItemSchema);



// make this available to our users in our Node applications
module.exports = FoodItemModel;