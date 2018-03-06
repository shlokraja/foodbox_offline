body {
  font-family: 'AzoSans-Regular';
  background: none;
}

@font-face {
  font-family: 'AzoSans-Bold';
  src: url('../fonts/AzoSans-Bold.otf')  format('opentype');
}

@font-face {
  font-family: 'AzoSans-Regular';
  src: url('../fonts/AzoSans-Regular.otf')  format('opentype');
}

h2 {
  font-size: 42px;
  font-family: inherit;
}

h3 {
  font-size: 34px;
  font-family: inherit;
}

h4 {
  font-size: 26px;
  font-family: inherit;
}

thead {
  background-color: #CCCCCC;
}

.modal img, .modal-header h4 {
  display: inline-block;
  vertical-align: middle;
}

#main_content {
  overflow: auto;
}

/*Orders section */
#orders table td:hover{
  cursor: pointer;
}

#orders .panel_header {
  padding: 0px;
  padding-left: 10px;
  background: none;
}

#orders h4 {
  margin-top: 15px;
}

#orders .stop_order {
  margin-left: 100px;
  width: 150px;
}

#orders .dispenser_queue {
  margin-left: 75px;
  padding-left: 5px;
  padding-right: 5px;
  padding-top: 10px;
  padding-bottom: 10px;
}

#footer {
  background: #eee;
  width: 100%;
  border-top: 1px solid #CCCCCC;
  overflow: auto;
  position: absolute;
  bottom: 0px;
  z-index: 5;
}

#footer .logo {
  float: left;
  margin-left: 15px;
  margin-top: 20px;
}

#footer #staff_roster {
  float: left;
  margin-left: 10px;
  margin-top: 15px;
}

#footer #beverage_control {
  float: left;
  margin-left: 10px;
  margin-top: 15px;
}

#footer #do_eod {
  float: left;
  margin-left: 150px;
  margin-top: 15px;
}

#footer #force_failure {
  float: left;
  margin-left: 50px;
  margin-top: 15px;
}

#footer #load_items {
  float: right;
  margin-right: 20px;
  width: 200px;
  color: white;
  font-weight: bold;
}

#footer #load_items img{
  margin-right: 4px;
}

.panel {
  background: #FFFFFF;
  border: 1px solid #CCCCCC;
  box-shadow: 0px 2px 4px 2px rgba(0,174,239,0.16);
  border-radius: 6px;
  /* padding: 10px; */
  overflow: auto;
}

.panel_header {
  padding: 10px;
  background: #eee;
}

.panel_header img {
  display: inline-block;
  width: 30px;
}

.panel_header .new_link {
  width: inherit;
  vertical-align: text-bottom;
  margin-left: 5px;
}

.table img {
  width: 20px;
}

.rupee-img {
  height: 15px;
}

.panel_header h4 {
  display: inline-block;
  /* margin-top: 0px; */
  /* margin-bottom: 0px; */
  vertical-align: middle;
  line-height: 20px;
}

#right_pane {
  float: left;
  margin: 10px;
  width: 46%;
}

#left_pane {
  margin: 10px;
  float: left;
  width: 50%;
}

/*Purchase orders section */
#purchase_orders .incoming_pos {
  display: inline-block;
  cursor: pointer;
  margin-left: 170px;
  width: 200px;
  height: 50px;
}

#purchase_orders .num {
  font-size: 45px;
  line-height: normal;
}

#purchase_orders .live .live_text {
  text-align: center;
  margin-top: -10px;
}

#purchase_orders .incoming_pos img{
  margin-top: -5px;
  display: inline-block;
  vertical-align: middle;
  text-transform: capitalize;
}

#purchase_orders .incoming_pos .text {
  display: inline-block;
  vertical-align: middle;
  text-transform: capitalize;
  margin-left: 10px;
}

#purchase_orders .incoming_pos .num {
  font-size: 18px;
  font-weight: bold;
  text-align: left;
}

#purchase_orders .incoming_pos .text .incoming_text {
  margin-top: -2px;
}

#purchase_orders .live {
  display: inline-block;
  margin-left: 100px;
  vertical-align: middle;
}

#incoming-po-dialog .modal-body {
  max-height: 400px;
  overflow: auto;
}

/*Collect cash section */
#collect_cash_body {
  height: 200px;
}

#collect_cash {
  max-height: 203px;
  overflow: auto;
}

#collect_cash .cash_notification {
  padding-left: 10px;
  border-bottom: 1px solid #CCCCCC;
}

#collect_cash .cash_notification img, #orders .stop_order img{
  width: 25px;
  margin-right: 5px;
}

#collect_cash .cash_notification .done {
  margin-left: 200px;
}

/*Notifications section */
#notifications_body {
  height: 244px;
}

#notifications {
  max-height: 306px;
  overflow: auto;
}

#notifications .notification div {
  display: inline-block;
}

#notifications .notification {
  cursor: pointer;
}

/*Sales and cash section */
#sales_cash .cash_label {
  font-weight: bold;
  margin-left: 45px;
  background-color: #999999;
  padding: 10px;
}

#sales_cash .panel_header {
  height: 65px;
  padding-top: 0px;
  padding-bottom: 0px;
}

#sales_cash .cash_value img {
  height: 12px;
  width: 12px;
}

#sales_cash .spends {
  margin-left: 40px;
  margin-top: 8px;
  background-color: white;
  width: 150px;
}

#sales_cash .nos {
  padding: 10px;
  margin: 0 auto;
  width: 220px;
}

#sales_cash .nos .num {
  font-size: 33px;
  color: #333 !important;
}

#sales_cash .month .num, #sales_cash .day .num {
  color: #333 !important;
}

#sales_cash .month img, #sales_cash .day img {
  height: 12px;
  display: inline-block;
}

#sales_cash .month .month_text, #sales_cash .day .text {
  background-color: #999999;
  font-size: 22px;
  font-weight: bold;
  color: #333 !important;
}

#sales_cash .month {
  padding: 10px;
  margin: 0 auto;
  width: 300px;
  float: left;
}

#sales_cash .day {
  padding: 10px;
  margin: 0 auto;
  width: 285px;
  float: left;
}

#sales_cash .food, #sales_cash .others, #sales_cash .month .month_text, #sales_cash .day .text {
  display: inline-block;
  color: #999999;
  margin: 10px;
  vertical-align: middle;
}

#sales_cash .month .month_text, #sales_cash .day .text {
  padding: 10px;
  margin-left: 0px;
}

#unscanned-items-dialog .unscanned_slot_item {
  display: inline-block;
  width: 50px;
}

#expiry-items-dialog .modal-body .expiry_image, #unscanned-items-dialog .modal-body .expiry_image {
  display: inline-block;
}

#expiry-items-dialog .modal-body .expiry_details, #unscanned-items-dialog .modal-body .expiry_details {
  display: inline-block;
  vertical-align: top;
  width: 60%;
}

#expiry-items-dialog .modal-body .expiry_details .slot_ids {
  word-break: break-word;
  word-wrap: break-word;
}

#expiry-items-dialog .modal-body .expiry_details .text, #unscanned-items-dialog .modal-body .expiry_details .text {
  border-bottom: 1px solid #CCCCCC;
}

/*Message center section */
#message_center .num_threads{
  cursor: pointer;
  display: inline-block;
  margin-left: 80px;
  vertical-align: middle;
  color: #2196f3;
  visibility: hidden;
}

#message_center .num_threads .num {
  font-size: 20px;
  text-align: center;
}

#message_center .compose_message {
  margin-left: 151px;
  width: 150px;
  visibility: hidden;
}

#message_center .panel_header {
  padding: 0px;
  padding-left: 10px;
  background: none;
}

#message_center .panel_header h4{
  margin-left: 3px;
}

/*Message threads section*/
#message-threads-dialog .modal-header .compose_message {
  margin-left: 200px;
}

#message-threads-dialog .modal-body {
  margin-top: 10px;
}

#message-threads-dialog .modal-body .message_thread {
  margin-bottom: 5px;
  font-size: 18px;
}

#message-threads-dialog .modal-body .message_thread img {
  height: 15px;
}

#message-threads-dialog .modal-body .message_thread .unread_image {
  width: 25px;
  margin-top: -3px;
  display: inline-block;
}

#message-threads-dialog .modal-body .message_thread .thread_text {
  width: 500px;
  display: inline-block;
  border-bottom: 1px solid #CCCCCC;
}

#message-threads-dialog .modal-body .message_thread .last_updated {
  float: right;
  font-size: 12px;
  margin-top: 4px;
}

#message-threads-dialog .modal-body .threads{
  color: #2196f3;
}

/*Message comments section*/
#message-comments-dialog .modal-header .back_to_threads {
  color: #2196f3;
  margin-left: 20px;
}

#message-comments-dialog .modal-header .compose_message {
  margin-left: 150px;
}

#message-comments-dialog .modal-body .thread_title {
  background-color: #999999;
  font-size: 25px;
  font-weight: bold;
}

#message-comments-dialog .modal-body .comments {
  overflow: auto;
  margin-top: 10px;
}

#message-comments-dialog .modal-body .comments .source{
  font-weight: bold;
}

#message-comments-dialog .modal-body .comments .comment {
  clear: both;
}

#message-comments-dialog .modal-body .comments .hq_comment {
  float: left;
  margin-bottom: 10px;
}

#message-comments-dialog .modal-body .comments .outlet_comment {
  float: right;
  margin-bottom: 10px;
}

#message-comments-dialog .modal-body .comments .timestamp {
  margin-top: 5px;
}

#message-comments-dialog .modal-body .reply {
  margin-top: 10px;
}

/* Compose message section*/
#compose-message-dialog .modal-body .subject {
  margin-top: 10px;
}

#compose-message-dialog .modal-body .col-lg-10 {
  padding: 0px;
  margin-top: 10px;
}

#compose-message-dialog .modal-header {
  margin-bottom: 10px;
}

#loading-issue-dialog .modal-header, #expiry-items-dialog .modal-header, #unscanned-items-dialog .modal-header {
  border-bottom: 1px solid #CCCCCC;
  text-align: center;
}

#loading-issue-dialog .modal-dialog {
  width: 850px;
}

#loading-issue-dialog .modal-body .qty {
  width: 20px;
}

#loading-issue-dialog .modal-body table thead {
  background: none;
}

#loading-issue-dialog .modal-body .title, #expiry-items-dialog .modal-body .title, #unscanned-items-dialog .modal-body .title{
  background-color: #CCCCCC;
  text-align: center;
  font-size: 20px;
  margin-top: 10px;
  margin-bottom: 10px;
}

#loading-issue-dialog .modal-body .loading_add_btn, #loading-issue-dialog .modal-body .unscanned_add_btn, #report-issues-dialog .modal-body .add_btn {
  background-color: #CCCCCC;
  padding: 5px;
  text-align: center;
  cursor: pointer;
  font-size: 17px;
}

#loading-issue-dialog .modal-body .note {
  width: 170px;
}

#loading-issue-dialog .modal-body .loading_issue_item_id_list, #loading-issue-dialog .modal-body .unscanned_item_id_list {
  max-height: 150px;
  overflow: auto;
}

#loading-issue-dialog .modal-body .food_item {
  width: 200px;
  max-width: 200px;
}

#loading-issue-dialog .modal-body .problem {
  width: 200px;
}

#loading-issue-dialog .modal-body .trash, #report-issues-dialog .modal-body .trash {
  cursor: pointer;
}

#loading-issue-dialog .modal-body .unscanned_add_btn img, #loading-issue-dialog .modal-body .loading_add_btn img, #report-issues-dialog .modal-body .add_btn img{
  margin-right: 5px;
}

#loading-issue-dialog .modal-body .sub_title {
  font-weight: bold;
  text-align: center;
}

#issues .issue .problem {
  font-weight: bold;
}

#issues .issue .note {
  color: #666666;
}

#issues .issue span {
  margin-right: 20px;
}

#issues .report_issues {
  margin-left: 320px;
  width: 150px;
}

#issues .panel_header {
  padding: 0px;
  padding-left: 10px;
  background: none;
}

#report-issues-dialog .modal-content {
  width: 850px;
  left: -150px;
}

#report-issues-dialog .modal-body .final_status {
  width: 170px;
  display: inline-block;
}

#report-issues-dialog .modal-body .count {
  width: 20px;
}

#report-issues-dialog .modal-body .food_issue_entry {
  border-bottom: 1px solid #CCCCCC;
  padding-bottom: 10px;
  padding-top: 10px;
   color: #666666;
}

#report-issues-dialog .modal-body #food_issue tbody .note {
  width: 120px;
}

#report-issues-dialog .modal-body #food_issue tbody .qty {
  width: 20px;
}

#report-issues-dialog .modal-body #non_food_issue {
  margin-top: 10px;
}

#report-issues-dialog .modal-body .food_issue_entry span {
  color: black;
}

/*Staff roster dialog properties */
#staff-roster-dialog {
  top: auto;
  right: auto;
  bottom: 70px;
}

#staff-roster-dialog .modal-dialog {
  width: 210px;
  margin-bottom: 0px;
}

#staff-roster-dialog .shift_start {
  width: 100px;
  display: inline-table;
}

#staff-roster-dialog .shift_end {
  width: 100px;
  display: inline-table;
}

/*Beverage dialog properties */
#beverage-control-dialog {
  top: auto;
  right: auto;
  left: 219px;
  bottom: 70px;
}

#beverage-control-dialog .modal-dialog {
  width: 350px;
  margin-bottom: 0px;
}

#beverage-control-dialog .beverage_item {
  width: 250px;
  display: inline-table;
}

/*Beverage dialog properties */
#force-failure-dialog {
  top: auto;
  right: auto;
  left: 794px;
  bottom: 70px;
}

#force-failure-dialog .modal-dialog {
  width: 350px;
  margin-bottom: 0px;
}

#petty_cash-dialog .modal-body table {
  margin-bottom: 5px;
}

#petty_cash-dialog .modal-body .modal_header_rupee {
  height: 12px;
}

#petty_cash-dialog .modal-body .petty-table {
  max-height: 300px;
  overflow: auto;
  margin-bottom: 5px;
}

#petty_cash-dialog .modal-body .enter_petty_cash {
  margin-top: 10px;
}

.cash_change {
  display: none;
  position: absolute;
  background-color: #999999;
  z-index: 2;
}

.sales-cash-table tr th {
    background-color: #F05A25;
    color: #ffffff;
    font-weight: bold;
}
.sales-cash-table tr td {
    font-size: 14px;
    color: #333333;
}
td.sidemenu {
    background-color: #EEEEEE;
    border-right: 1px solid #CCCCCC;
font-weight:bold;
}