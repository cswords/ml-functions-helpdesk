'use strict';

/*
Copyright 2017 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);
const Language = require('@google-cloud/language');
const language = Language({ apiVersion: 'v1beta2' });
const google = require('googleapis');
const jsforce = require('jsforce');

//[START model_configurations]
const MDL_PROJECT_NAME = <YOUR_PROJECT_HOSTING_MODELS>;
const RESOLUTION_TIME_MODEL_NAME = 'mdl_helpdesk_priority'; # Matches Notebook
const PRIORITY_MODEL_NAME = 'mdl_helpdesk_resolution_time'; # Matches Notebook
const SFDC_URL = <YOUR_SFDC_URL>;
const SFDC_LOGIN = <YOUR_SFDC_LOGIN>;
const SFDC_PASSWORD = <YOUR_SFDC_PASSWORD>;
const SFDC_TOKEN = <YOUR_SFDC_TOKEN>;
//[END model_configurations]

/*
 * PRIORITY
 * Priority prediction using a custom classifying model created in the ml folder
 * calling it through the ML engine API. Because there is no google-cloud nodejs
 * library for this yet, we need to do several steps before we can call it.
 * This write back the priority position in the array to Firebase
 * @params ml : an authenticated ML client
 */
exports.priority = functions.database.ref('/tickets/{ticketID}').onCreate((snapshot, context) => {

    console.log("Snapshot: ", snapshot);

    // const snapshot = event.data;
    const key = snapshot.key;
    const ticket = snapshot.val();

    if (ticket.hasOwnProperty("pred_priority")) {
        console.log("Priority has been done")
        return;
    }

    var returnValue = "f**ked";

    // Auth
    auth.getApplicationDefault(function(err, authClient) {
        if (err) {
            return cb(err);
        }

        //[START ml_engine_auth]
        // https://developers.google.com/identity/protocols/googlescopes#mlv1
        authClient.scopes = ['https://www.googleapis.com/auth/cloud-platform'];

        //Create authenticated ml engine client
        var ml = google.ml({
            version: 'v1',
            auth: authClient
        });
        //[END ml_engine_auth]

        // Prediction
        returnValue = ml.projects.predict({
            name: `projects/${MDL_PROJECT_NAME}/models/${PRIORITY_MODEL_NAME}`,
            resource: {
                instances: [
                    `${key},${ticket.seniority},${ticket.experience},${ticket.category},${ticket.type},${ticket.impact}`
                ]
            }
        }, function(err, resp) {
            if (err) {
                console.error('ERROR PRIORITY', err)
            }

            var result = resp.data;

            if (result.error) {
                console.error("Prediction error: ", result.error);
            } else {
                console.log("Predition result: ", result);
                if (result.predictions && result.predictions.length > 0 && result.predictions[0].predicted) {
                    admin.database().ref(`/tickets/${key}/pred_priority`).set(
                        result.predictions[0].predicted
                    );
                }

            }
        });
    });

    return returnValue;
});


/*
 * RESOLUTION TIME
 * Resolution time prediction using a custom regressive model created
 * calling it through the ML engine API. Because there is no google-cloud nodejs
 * library for this yet, we need to do several steps before we can call it.
 * This returns a float representing the amount of days that it will be open
 * @params ml : an authenticated ML client
 */
exports.resolutiontime = functions.database.ref('/tickets/{ticketID}').onCreate((snapshot, context) => {

    console.log("Snapshot: ", snapshot);

    // const snapshot = event.data;
    const key = snapshot.key;
    const ticket = snapshot.val();

    if (ticket.hasOwnProperty("pred_resolution_time")) {
        console.log("Resolution time has been done")
        return;
    }

    var returnValue = "f**ked";

    //[START ml_auth]
    auth.getApplicationDefault(function(err, authClient) {
        if (err) {
            return cb(err);
        }

        // Ml Engine does not have its own scope. Needs to use global
        // https://developers.google.com/identity/protocols/googlescopes#mlv1
        authClient.scopes = ['https://www.googleapis.com/auth/cloud-platform'];

        var ml = google.ml({
            version: 'v1',
            auth: authClient
        });
        //[END ml_auth]

        //[START resolution_prediction]
        returnValue = ml.projects.predict({
                name: `projects/${MDL_PROJECT_NAME}/models/${RESOLUTION_TIME_MODEL_NAME}`,
                resource: {
                    instances: [
                        `${key},${ticket.seniority},${ticket.experience},${ticket.category},${ticket.type},${ticket.impact}`
                    ]
                }
            },
            //[END resolution_prediction]
            function(err, resp) {
                if (err) {
                    console.error('ERROR RESOLUTION TIME', err)
                }

                var result = resp.data;

                if (result.error) {
                    console.error("Prediction error: ", result.error);
                } else {
                    console.log("Predition result: ", result);
                    if (result.predictions && result.predictions.length > 0 && result.predictions[0].predicted) {
                        admin.database().ref(`/tickets/${key}/pred_resolution_time`).set(
                            result.predictions[0].predicted
                        );
                    }
                }
            });
    });

    return returnValue;
});

/*
 * SENTIMENT
 * NLP Enrichment. This is calling directly the nlp API which has a google-cloud
 * nodeJS library so the authentication is quite straight forward.
 * It writes back to Firebase the tags.
 */
exports.sentiment = functions.database.ref('/tickets/{ticketID}').onCreate((snapshot, context) => {

    console.log("Snapshot: ", snapshot);

    //const snapshot = event.data;
    const key = snapshot.key;
    const ticket = snapshot.val();

    // Make sure that after we write, it does not call the function again
    if (!ticket) {
        console.log("No ticket yet")
        return;
    }
    if (ticket.hasOwnProperty("pred_sentiment")) {
        console.log("Sentiment has been done")
        return;
    }

    const client = new language.LanguageServiceClient();

    //[START nlp_prediction]
    const text = ticket.description;
    const document = {
        content: text,
        type: 'PLAIN_TEXT',
    };

    return client
        .analyzeSentiment({ document: document })
        .then((results) => {

            console.log("Result: ", results);
            const sentiment = results[0].documentSentiment;

            admin.database().ref(`/tickets/${key}/pred_sentiment`).set(sentiment.score);
        })
        .catch((err) => {
            console.error('ERROR detectSentiment:', err);
        });
    //[END nlp_prediction]

});

/*
 * TAGS
 * NLP Enrichment. This is calling directly the nlp API which has a google-cloud
 * nodeJS library so the authentication is quite straight forward.
 * It writes back to Firebase the tags.
 */
exports.tags = functions.database.ref('/tickets/{ticketID}').onCreate((snapshot, context) => {

    console.log("Snapshot: ", snapshot);

    //const snapshot = event.data;
    const key = snapshot.key;
    const ticket = snapshot.val();

    // Make sure that after we write, it does not call the function again
    if (ticket.hasOwnProperty("tags")) {
        console.log("Tagging has been done")
        return;
    }

    const client = new language.LanguageServiceClient();

    const text = ticket.description;
    const document = {
        content: text,
        type: 'PLAIN_TEXT',
    };

    return client
        .analyzeEntities({ document: document })
        .then((results) => {

            console.log("Result: ", results);
            const entities = results[0].entities;

            const writeEntities = [];
            if (entities.length > 0) {
                entities.forEach((entity) => {
                    writeEntities.push(entity.name)
                    //admin.database().ref(`/tickets/${key}/tags`).push(entity.name);
                });
            } else {
                console.log("No entity was returned.");
            }
            // We overwrite the whole thing to prevent duplicates mentioned above
            admin.database().ref(`/tickets/${key}`).update({ 'tags': writeEntities });
        })
        .catch((err) => {
            console.error('ERROR detectEntities:', err);
        });
});

/*
 * UPDATESFDC
 * Write to Salesforce some of the ticket data that was created in Firebase and
 * enriched using machine learning.
 */
exports.updateSFDC = functions.database.ref('/tickets/{ticketID}').onWrite(event => {
  const snapshot = event.data;
  const key = snapshot.key;
  const ticket = snapshot.val();

  if (ticket.hasOwnProperty("sfdc_key")){
    console.log("Ticket has been created already");
    return;
  }

  // Makes sure that we do not try to write to Salesforce before the enrichment
  if ((!ticket.pred_priority) || (!ticket.pred_sentiment) || (!ticket.pred_resolution_time)){
    console.log("Still waiting for some values");;
    return;
  }

  var jsforce = require('jsforce');
  var conn = new jsforce.Connection();

  //[START conn_sfdc]
  conn = new jsforce.Connection({
    loginUrl : SFDC_URL
  });
  conn.login(SFDC_LOGIN, SFDC_PASSWORD + SFDC_TOKEN, function(err, res) {
  //[END conn_sfdc]
    if (err) {
      return console.error('SFDC ERROR', err);
    }
    //[START create_ticket_sfdc]
    conn.sobject("Case").create({
      SuppliedEmail: 'user@example.com',
      Description: ticket.description,
      Type: ticket.type,
      Reason: ticket.category,
      Priority: ticket.priority,
      ResolutionTime__c: ticket.t_resolution
    }, function(err, ret) {
    //[END create_ticket_sfdc]
      if (err || !ret.success) {
        return console.error(err, ret);
      }
      admin.database().ref(`/tickets/${key}/sfdc_key`).set(ret.id);
    });
  });
});











