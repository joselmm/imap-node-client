import { MailListener } from "mail-listener5";   // NOTE: A FUTURE VERSION (release date TBA) will not require ES6 destructuring or referring to the class after the require statement (i.e. require('mail-listener5').MailListener). At this stage, this is necessary because index.js exports the MailListener class as a property of module.exports.
import { sendMessage, connectToWhatsApp } from "./whatsapp.js";
import { getFormattedDate } from "./getFomattedDate.js"
import { config } from "dotenv";
config();


export var mailListener = new MailListener({
  username: process.env.EMAIL,
  password: process.env.EMAIL_PASS,
  host: "imap.gmail.com",
  port: 993, // imap port
  tls: true,
  connTimeout: 10000, // Default by node-imap
  authTimeout: 5000, // Default by node-imap,
  debug: console.log, // Or your custom function with only one incoming argument. Default: null
  autotls: 'never', // default by node-imap
  tlsOptions: { rejectUnauthorized: false },
  mailbox: "INBOX", // mailbox to monitor,
  markSeen: true,
  fetchUnreadOnStart: false, // use it only if you want to get all unread email on lib start. Default is `false`,
  searchFilter: [/* ["SINCE", getFormattedDate()], */ "UNSEEN"], // the search filter being used after an IDLE notification has been retrieved
  attachments: false, // download attachments as they are encountered to the project directory
  // attachmentOptions: { directory: "attachments/" } // specify a download directory for attachments
});

mailListener.on("server:connected", function () {
  console.log("imapConnected");
});

mailListener.on("mailbox", function (mailbox) {
  console.log("Total number of mails: ", mailbox.messages.total); // this field in mailbox gives the total number of emails
});

mailListener.on("server:disconnected", function () {
  console.log("imapDisconnected");
});

mailListener.on("error", function (err) {
  console.log("HUbo un error")
  console.error(err);
});






